# Echosphere — PS31 Voice AI Co-Teacher

An audio-only live classroom where a teacher, multiple students, and an AI
co-teacher share one Agora voice channel. Built against
[`docs/PS31-ai-co-teacher-implementation-plan.md`](docs/PS31-ai-co-teacher-implementation-plan.md).

This file is the reference for how the system works today. For the story of
how it got there — every bug found, its root cause, and the fix — see
[`docs/BUILD-LOG.md`](docs/BUILD-LOG.md).

There is no video anywhere in this app. The surface area is an Agora RTC audio
channel, a control/data path, and a web dashboard.

**No API keys beyond Agora.** Speech recognition, the model and the voice are
all resold through the Agora project — Deepgram, gpt-4o-mini and MiniMax behind
one agent. Nothing here calls OpenAI directly.

## Layout

```
apps/web           Next.js frontend (from the official Agora ConvoAI quickstart)
apps/orchestrator  Long-lived Node service: roles, floor state machine, lesson
                   material, quiz engine, gap detector, reports
packages/shared-types  Domain types shared by both
```

## Running it

```bash
pnpm install

# Terminal 1 — orchestration backend on :8787
pnpm --filter @echosphere/orchestrator dev

# Terminal 2 — web app on :3000
pnpm --filter @echosphere/web dev
```

Open <http://localhost:3000/join>. Join as a teacher in one browser profile and
as students in others, then press **Bring Athena in** on the teacher dashboard.

### Environment

`apps/web/.env.local` and `apps/orchestrator/.env` both need the Agora project
credentials, and nothing else:

```bash
agora project use athena-echosphere
agora project env write apps/web/.env.local
```

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_AGORA_APP_ID` | both | Agora project App ID |
| `NEXT_AGORA_APP_CERTIFICATE` | both | Server-side only; mints tokens |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | web | Defaults to `http://localhost:8787` |
| `LLM_MODEL` | orchestrator | Must be a model Agora resells; defaults to `gpt-4o-mini` |

## How it works without a second vendor key

The plan assumed a custom LLM endpoint — the orchestrator sitting in the middle
of every turn, injecting lesson material and student profiles. That needs an
OpenAI key and a publicly reachable server. Neither exists here, so two
mechanisms replace it.

**Everything the agent needs to know lives in the system prompt**, and the
orchestrator re-pushes it with `session.update()` whenever the classroom
changes: a student joins, the teacher retags someone's level, material is
uploaded, verbosity or a topic ban moves. §3.5 works because the roster block
lists every student with their level, and the model matches depth to whoever it
is answering. See [`agent/prompt.ts`](apps/orchestrator/src/agent/prompt.ts).

**Structured data comes back out through the braces.** The agent runs with
MiniMax `skipPatterns: [5]`, so the engine strips curly-brace content before
speech synthesis while the RTM transcript still restores the full text. A JSON
object appended to a turn is therefore inaudible to the room and visible to the
orchestrator — one model, one call, one round trip, no classifier.

```
Agent turn:  "Quick check. A: add the denominators. B: find the LCD.
              {"quiz":{"topic":"LCD","question":"…","options":[…],"answer":"B"}}"

Room hears:  "Quick check. A: add the denominators. B: find the LCD."
App parses:  the payload, and renders the quiz card
```

That carries quiz questions (§3.6), agent-noticed learning gaps (§3.9), and who
the agent is answering (§3.5). Contract at the bottom of
[`agent/prompt.ts`](apps/orchestrator/src/agent/prompt.ts), reader in
[`agent/control.ts`](apps/orchestrator/src/agent/control.ts), tests in
[`scripts/control.test.ts`](apps/orchestrator/scripts/control.test.ts).

This mirrors the approach in the sibling Athena project, where the same channel
drives a live understanding map.

Inspect the composed prompt at any time with
`GET /api/sessions/:id/prompt` — the fastest way to confirm a proficiency change
or a lesson upload actually reached the agent.

## Notes on the plan

Three things were verified against the Agora skill and the official quickstart
rather than assumed, and they change §2 and §7 of the plan:

**RTM cannot carry the control path.** Agora's RTM is a client-side-only SDK;
there is no server variant, and the skill's guidance for backend-to-channel
messaging is to use the ConvoAI REST API or build your own signalling layer. The
orchestrator therefore fans classroom events out over **SSE**
(`/api/sessions/:id/events`) and takes commands back over plain HTTP. RTM is
still used for what it is good at — the agent's transcripts and state reach the
browser over RTM directly from Agora's engine.

A consequence: because only browsers can see the RTM transcript stream, **every
browser relays** finalised segments back to the orchestrator, and the server
de-duplicates by `(uid, turnId)`. Relaying from the teacher's tab alone would be
one fewer request per turn, but it made the transcript depend on a single tab
being open — so the redundancy is deliberate.

**The pipeline is cascading, not GPT-4o Realtime.** Realtime runs as an MLLM —
audio in, audio out — which supports neither a custom LLM nor `/speak`, so the
brace channel and the teacher's forced-speech control would both be lost.
Deepgram → gpt-4o-mini → MiniMax keeps them. Deepgram's `multi` language mode
covers code-switching (§3.7).

**Barge-in and forced speech are real APIs**, not something to build:
`session.interrupt()`, `session.say(text, { priority })`, and
`session.think(instruction)` on the `agora-agents` SDK. §7.1 resolved.

## Turn-taking

The rule the plan cares most about — *no code path should be able to let the
agent speak while muted* — is enforced structurally, not by convention:

- `decideSpeak` in [`floor/floorMachine.ts`](apps/orchestrator/src/floor/floorMachine.ts)
  is the only function that grants permission, it checks `policy.muted` first,
  and it returns a discriminated union rather than a boolean.
- `requestFloor` in [`classroomController.ts`](apps/orchestrator/src/classroomController.ts)
  is the only caller of `decideSpeak`. Every path that can make the agent talk
  goes through that one door.
- Denials are broadcast to the teacher panel, so "the AI tried to speak and was
  blocked because you muted it" is visible during a demo.

The floor machine is pure — every transition is a function of
`(snapshot, policy, input)` — so the rules are testable without an Agora
connection.

### A turn, once authorized, runs to completion

ConvoAI answers every addressed turn on its own initiative — it never asks the
orchestrator first. That means the orchestrator's only lever is *after the
fact*: the browser relays `AGENT_STATE_CHANGED`, and
[`handleAgentState`](apps/orchestrator/src/classroomController.ts) decides
whether that turn was authorized (§3.3's floor rules) or gets cut off.

The first version of this re-checked a permit's TTL on every state event,
including ones mid-turn. A real answer — ASR settle, LLM generation, then
several seconds of speech — routinely outlives a short permit window, so a
legitimate answer got interrupted mid-sentence for no visible reason. Fixed by
separating "may this turn *begin*" (bounded by the TTL) from "is this turn
*already running*" (`authorizedTurnInProgress`, which nothing but an explicit
mute/barge-in/floor-close can revoke). Covered in
[`scripts/floor.test.ts`](apps/orchestrator/scripts/floor.test.ts), including
the regression itself: a permit rewound 20 seconds into the past does not
interrupt a turn already under way.

The same file also caught a second, unrelated bug in the same area: the
teacher's own "address the agent by name" path only ever ran inside a
`role === 'student'` branch, so `studentsMayInvoke` — which is meant to gate
*student* self-service access to the floor — was silently gating the
*teacher's* as well. The teacher can now always call on the agent by name,
regardless of that setting; the gate still applies only to students.

### Engine-level barge-in cannot be scoped to one speaker

Verified against Agora's live REST docs, not assumed:
`start_of_speech.interrupt_duration_ms` triggers whenever *any* subscribed
remote uid speaks past the threshold, with no participant-level scoping in the
API. Since a multi-party classroom needs `remoteUids: ['*']`, this means a
student's stray "okay" mid-answer is indistinguishable, at the engine level,
from a teacher actually barging in. Both `interrupt_duration_ms` and
`end_of_speech.silence_duration_ms` are set to the documented ceiling
(`1200`/`2000`) in [`agentLifecycle.ts`](apps/orchestrator/src/agent/agentLifecycle.ts)
to make that misfire rarer — this is a mitigation of a platform limitation, not
a fix, and is documented as such there. The orchestrator's own
`interruptAgent()` call, gated to the teacher's role in `onTeacherBargeIn`,
remains the one barge-in path that is actually speaker-scoped.

### Speaker attribution needs faster polling than Agora's default

Human turns carry no speaker id of their own — attribution comes from
whichever participant's mic was loudest right before their turn began. Agora's
built-in `volume-indicator` event is fixed by the SDK at a 2-second reporting
interval (confirmed in the SDK's own typings; there is no parameter to change
it), which is slower than a fast handoff between speakers. `ClassroomAudio`
instead polls each track's own `getVolumeLevel()` — real-time by the SDK's own
recommendation — at 150ms, checking the local mic alongside every remote
track so a stale reading can't misattribute the *local* participant's own next
turn to whoever spoke last.

## Verification

```bash
pnpm -r typecheck
pnpm --filter @echosphere/orchestrator test     # control-channel parser + floor/permit enforcement
pnpm --filter @echosphere/web lint
pnpm --filter @echosphere/web build
pnpm --filter @echosphere/web test:e2e          # real browser, both servers must be up
pnpm --filter @echosphere/web test:e2e:agent    # also starts a live agent (Agora minutes)
pnpm --filter @echosphere/web test:roundtrip    # agent speaks -> words come back (Agora minutes)
```

`test:e2e` drives Chromium with a fake microphone: two browser contexts join as
teacher and student, RTC connects for real, and the run fails on duplicate RTM
instances, CORS-refused SSE, or a missing control panel.

`test:roundtrip` is the one that matters most. It puts a **student** in the room
before starting the agent, then makes the agent speak and asserts its words come
back through RTM. Both halves are deliberate: the student join is what triggers
`session.update()`, and driving speech from the agent side takes speech
recognition out of the picture, so a failure is unambiguously the relay. Every
serious bug in this project so far — a missing `subscribeMessage`, a transcript
frozen at its first fragment, an `llm.params` update that erased the model —
passed typecheck, lint and the API tests, and only showed up here.

## Known gaps

- **State is in-process.** The plan's §4 lists Postgres. Sessions live in the
  orchestrator's memory and are lost on restart; a second replica would need
  sticky routing by `sessionId`.
- **The post-class narrative is computed, not written.** Everything a teacher
  acts on is already structured data by the time the lesson ends, so the report
  is derived from the log rather than generated. The numbers cannot be wrong,
  but the prose is templated.
- **Retrieval is keyword overlap, not embeddings** — there is no key to call for
  a vector. It only matters when uploaded material exceeds the prompt budget;
  below that, the whole lesson goes in.
- **The floor machine has no unit tests yet.** It is pure and is the next thing
  that should get them; the control-channel parser has ten, and the browser
  harness covers the connection-level failures.
- **Transcription quality is unverified.** The browser test uses a fake
  microphone emitting a tone, so it proves the ASR pipeline connects but says
  nothing about how well Deepgram's `multi` mode handles real speech.
- **The quickstart's original routes** (`app/api/invite-agent`, etc.) are still
  present and still work, but are no longer wired to any page. They start a 1:1
  agent, not a classroom one. Kept as the proven baseline reference.
