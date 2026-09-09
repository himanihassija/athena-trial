/**
 * Athena's "draw me a diagram" path.
 *
 * Topic in, Excalidraw elements out. Deliberately pure in that sense: this
 * module never touches the SSE bus, the session's scene, or the floor. The
 * caller (`classroomController.applyControl`) owns the merge and the broadcast,
 * which is what makes generation independently testable without standing up a
 * classroom.
 *
 * Two stages, and they use different things. Deciding *what* to draw is a
 * language problem, so it goes through `tryComplete` on whatever provider the
 * deployment has configured. Deciding *where the boxes and arrows go* is a
 * layout problem, and that is what Excalidraw+ is for — `create_diagram`
 * measures labels, routes elbow arrows and reserves room for edge labels far
 * better than geometry we would hand-roll here.
 *
 * **Why a scratch scene.** `create_diagram` writes into a scene on Excalidraw's
 * side; we read it back and copy the elements onto the classroom board. The
 * scratch scene is a workbench, not the thing students look at.
 *
 * **Why the diff.** A scratch scene is reused, so the second read returns the
 * first diagram's elements too. Copying that wholesale would re-paste every
 * earlier diagram on every request, so ids already taken from a scene are
 * remembered and only genuinely new elements are returned.
 *
 * **Why the per-session lock.** That diff is a read-modify-write against
 * remembered state; two requests in flight at once would each read the same
 * "seen" set and both claim the other's elements. Requests are serialised per
 * session instead.
 */

import type { BoardElement } from '@echosphere/shared-types';
import { config } from '../config.js';
import { tryComplete } from '../llm/complete.js';
import { excalidrawConfigured, withExcalidraw, type ToolCaller } from './excalidrawMcp.js';

/** Whether both halves of this feature — a model and Excalidraw+ — are present. */
export function illustrationConfigured(): boolean {
  return excalidrawConfigured();
}

interface IllustrationState {
  /** The scratch scene this session draws into, once one exists. */
  sceneId: string | null;
  /** Element ids already copied onto the classroom board from that scene. */
  seen: Set<string>;
  /** Tail of the serialisation chain, so requests queue rather than race. */
  queue: Promise<unknown>;
}

const states = new Map<string, IllustrationState>();

function stateFor(sessionId: string): IllustrationState {
  let state = states.get(sessionId);
  if (!state) {
    state = {
      sceneId: config.excalidrawScratchSceneId.trim() || null,
      seen: new Set(),
      queue: Promise.resolve(),
    };
    states.set(sessionId, state);
  }
  return state;
}

/** Drops remembered scratch-scene state. Called when a session ends. */
export function forgetIllustrations(sessionId: string): void {
  states.delete(sessionId);
}

/** One node in the diagram the model proposes. */
export interface DiagramSpec {
  title: string;
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

const SPEC_SYSTEM = `You turn a lesson topic into a small diagram specification for a classroom whiteboard.

Reply with ONLY a JSON object, no prose and no code fence:
{"title":"...","nodes":[{"id":"n1","label":"..."}],"edges":[{"from":"n1","to":"n2","label":"..."}]}

Rules:
- Between three and eight nodes. A student reads this off a shared board while a lesson continues around them, so a few clearly-labelled boxes beat a complete map of the subject.
- Labels are real words from the topic, at most four words each. Never placeholders.
- Every edge's "from" and "to" must be ids that exist in "nodes".
- "label" on an edge is optional and should be one or two words when present.
- Prefer the shape the topic actually has: a sequence for a process, a tree for a hierarchy, a cycle for something that repeats.`;

/**
 * Asks the model for a diagram specification.
 *
 * Exported so the parsing and validation can be tested without a model call.
 */
export function parseDiagramSpec(raw: string | null): DiagramSpec | null {
  if (!raw) return null;

  // Models fence JSON even when told not to, and some prepend a sentence.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const nodes: DiagramSpec['nodes'] = [];
  if (!Array.isArray(record.nodes)) return null;
  // Maps the model's raw id to the sanitised one, so edges can follow it.
  const renamed = new Map<string, string>();
  for (const item of record.nodes) {
    if (!item || typeof item !== 'object') continue;
    const node = item as Record<string, unknown>;
    if (typeof node.id !== 'string' || typeof node.label !== 'string') continue;
    const raw = node.id.trim();
    const label = node.label.trim();
    if (!raw || !label) continue;
    const id = safeNodeId(raw, renamed.size);
    if (renamed.has(raw)) continue;
    renamed.set(raw, id);
    // create_diagram caps labels at 300 characters and rejects longer ones.
    nodes.push({ id, label: label.slice(0, 300) });
  }
  if (nodes.length < 2) return null;

  const ids = new Set(nodes.map((n) => n.id));
  const edges: DiagramSpec['edges'] = [];
  if (Array.isArray(record.edges)) {
    for (const item of record.edges) {
      if (!item || typeof item !== 'object') continue;
      const edge = item as Record<string, unknown>;
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
      const from = renamed.get(edge.from.trim()) ?? edge.from.trim();
      const to = renamed.get(edge.to.trim()) ?? edge.to.trim();
      // An edge to a node the model never defined would be a dangling arrow.
      if (!ids.has(from) || !ids.has(to)) continue;
      const label =
        typeof edge.label === 'string' && edge.label.trim()
          ? edge.label.trim().slice(0, 120)
          : undefined;
      edges.push({ from, to, label });
    }
  }

  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Diagram';
  return { title, nodes, edges };
}

/**
 * Forces a node id into the shape `create_diagram` accepts.
 *
 * Its schema pins ids to `^[A-Za-z0-9_.:-]+$`, and a model told to invent ids
 * happily returns "water vapour" — which the tool rejects outright, losing the
 * whole diagram rather than one node. Sanitising is safe because the ids are
 * internal: only the edges reference them, and they are rewritten to match.
 */
function safeNodeId(raw: string, index: number): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || `n${index + 1}`;
}

/**
 * Generates a diagram for `topic` and returns the elements to add to the board.
 *
 * Returns an empty array on every failure — no key, no model, a timeout, a tool
 * error, a model that drew nothing. A lesson continues without the picture; it
 * must never stop because of one.
 */
export async function generateIllustration(
  sessionId: string,
  topic: string,
): Promise<BoardElement[]> {
  if (!illustrationConfigured()) return [];
  const clean = topic.trim();
  if (!clean) return [];

  const state = stateFor(sessionId);
  const run = state.queue.then(() => illustrate(state, clean));
  // The chain must survive a rejection, or one failure wedges the session.
  state.queue = run.catch(() => undefined);
  return run;
}

async function illustrate(
  state: IllustrationState,
  topic: string,
): Promise<BoardElement[]> {
  const spec = parseDiagramSpec(
    await tryComplete(
      [
        { role: 'system', content: SPEC_SYSTEM },
        { role: 'user', content: `Topic: ${topic}` },
      ],
      { temperature: 0.3, maxTokens: 700 },
    ),
  );
  if (!spec) {
    console.error(`[illustrate] no usable diagram spec for "${topic}"`);
    return [];
  }

  const elements = await withExcalidraw(async (call) => {
    const sceneId = state.sceneId ?? (await createScratchScene(call));
    if (!sceneId) throw new Error('no scratch scene available');
    state.sceneId = sceneId;

    // Excalidraw's docs ask for the matching format guide before the first
    // scene write. It is cheap and it is what makes create_diagram's own
    // schema authoritative rather than guessed at.
    await call('read_diagram_format', {}).catch(() => undefined);

    await call('create_diagram', {
      sceneId,
      title: spec.title,
      // The classroom board is wider than it is tall, and it sits beside a
      // participant strip, so a left-to-right diagram fits without scrolling.
      direction: 'RIGHT',
      nodes: spec.nodes.map((n) => ({ id: n.id, label: n.label })),
      edges: spec.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    });

    return findElements(await call('get_scene_content', { sceneId }));
  });

  if (!elements) return [];

  const fresh = elements.filter((el) => !state.seen.has(el.id));
  for (const el of fresh) state.seen.add(el.id);
  if (fresh.length === 0) {
    console.error(`[illustrate] scene read returned no new elements for "${topic}"`);
  }
  return fresh;
}

/**
 * Creates the scratch scene this session lays diagrams out in.
 *
 * `create_scene` requires `name`, `pinned` and `collectionId` — all three, none
 * defaulted — and `collectionId` is where the two kinds of Excalidraw+ key
 * diverge. The schema says a personal key may pass the literal `'private'` for
 * the owner's virtual collection; a workspace key cannot reach private
 * collections at all and answers `{"error":"Collection not found"}` to exactly
 * that value. Since nothing in the key itself says which kind it is, the
 * collection is looked up rather than assumed: the workspace's default
 * collection is the right home for a scratch scene either way.
 * `EXCALIDRAW_COLLECTION_ID` overrides it.
 */
async function createScratchScene(call: ToolCaller): Promise<string | null> {
  const collectionId = await resolveCollection(call);
  if (!collectionId) throw new Error('no Excalidraw collection available to create a scene in');

  const created = await call('create_scene', {
    name: 'Athena classroom board',
    pinned: false,
    collectionId,
  });
  return findSceneId(created);
}

/** Cached for the process: the workspace's collections do not move mid-lesson. */
let cachedCollectionId: string | null = null;

async function resolveCollection(call: ToolCaller): Promise<string | null> {
  const configured = config.excalidrawCollectionId.trim();
  if (configured) return configured;
  if (cachedCollectionId) return cachedCollectionId;

  const listed = await call('list_collections', {});
  const rows = collectionRows(listed);
  // The default collection first, then simply the first one that exists.
  const chosen = rows.find((row) => row.isDefault === true) ?? rows[0];
  cachedCollectionId = typeof chosen?.id === 'string' ? chosen.id : null;
  return cachedCollectionId;
}

function collectionRows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object',
  );
}

/** Depth-first hunt for a scene id, since the wrapper shape is beta. */
function findSceneId(value: unknown, depth = 0): string | null {
  if (depth > 6 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'sceneId', 'scene_id']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  for (const nested of Object.values(record)) {
    const found = findSceneId(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Depth-first hunt for the element array, for the same reason.
 *
 * An Excalidraw element is recognised by carrying both an `id` and a `type`,
 * which is specific enough not to match the wrapper objects around it.
 */
export function findElements(value: unknown, depth = 0): BoardElement[] {
  if (depth > 6 || !value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    const elements = value.filter(isElementLike);
    if (elements.length > 0) return elements.map(normalise);
    for (const item of value) {
      const found = findElements(item, depth + 1);
      if (found.length > 0) return found;
    }
    return [];
  }

  const record = value as Record<string, unknown>;
  // Prefer the conventionally-named field before searching blindly.
  for (const key of ['elements', 'sceneElements']) {
    const found = findElements(record[key], depth + 1);
    if (found.length > 0) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findElements(nested, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function isElementLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.type === 'string';
}

/**
 * Makes an incoming element safe for the scene merge.
 *
 * `mergeSceneElements` keys on `id` and compares `version`, so both must be
 * present and the right type — an element arriving without a numeric version
 * would compare as `undefined >= undefined`, which is false, and silently
 * refuse to update. The `athena` flag matches what `athenaTextElement` already
 * sets, so her drawings and her written lines are marked the same way.
 */
function normalise(element: Record<string, unknown>): BoardElement {
  return {
    ...element,
    id: String(element.id),
    version: typeof element.version === 'number' ? element.version : 1,
    isDeleted: element.isDeleted === true,
    athena: true,
  } as BoardElement;
}

/**
 * Shifts a diagram clear of what is already on the board.
 *
 * Excalidraw+ lays every diagram out from its own origin, so two diagrams would
 * land on top of each other and on top of anything the teacher had drawn.
 * Exported separately from generation so the placement rule can be tested
 * without an Excalidraw call.
 */
export function placeBeside(
  existing: BoardElement[],
  incoming: BoardElement[],
): BoardElement[] {
  if (incoming.length === 0) return [];

  const right = existing.reduce((max, el) => {
    if (el.isDeleted === true) return max;
    const x = numberAt(el, 'x');
    return Math.max(max, x + numberAt(el, 'width'));
  }, Number.NEGATIVE_INFINITY);

  // Nothing on the board yet: leave Excalidraw's own layout alone.
  if (!Number.isFinite(right)) return incoming;

  const left = incoming.reduce((min, el) => Math.min(min, numberAt(el, 'x')), Number.POSITIVE_INFINITY);
  const shift = right + 80 - left;
  if (shift <= 0) return incoming;

  return incoming.map((el) => ({ ...el, x: numberAt(el, 'x') + shift }));
}

function numberAt(element: BoardElement, key: string): number {
  const value = (element as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}
