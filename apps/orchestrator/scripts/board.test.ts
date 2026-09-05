/**
 * Tests for the shared-board scene merge (see whiteboard/boardSession.ts).
 *
 * The failure this guards against: a client posting a scene it drew before it
 * saw someone else's edit. Replacing the stored scene wholesale would erase
 * that edit; merging per element by Excalidraw's own `version` counter cannot.
 *
 * Run with: node --import tsx scripts/board.test.ts
 */

import assert from 'node:assert/strict';
import type { BoardElement } from '@echosphere/shared-types';
import { mergeSceneElements } from './../src/whiteboard/boardSession.ts';
import { createSession } from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = (name: string, fn: () => void): void => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

const el = (id: string, version: number, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, version, ...extra });

t('an empty board takes everything it is given', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1), el('b', 1)]);
  assert.equal(s.whiteboard.scene.length, 2);
});

t('a newer version of an element replaces the older one', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1, { x: 10 })]);
  mergeSceneElements(s, [el('a', 2, { x: 99 })]);
  assert.equal(s.whiteboard.scene.length, 1, 'must not duplicate the element');
  assert.equal(s.whiteboard.scene[0]?.x, 99);
});

t('a stale version is ignored rather than overwriting newer work', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 5, { x: 99 })]);
  mergeSceneElements(s, [el('a', 2, { x: 10 })]);
  assert.equal(s.whiteboard.scene[0]?.x, 99, 'the newer edit must survive');
});

t('a partial post does not delete elements it never mentioned', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1), el('b', 1), el('c', 1)]);
  // A client sends only the element it just moved.
  mergeSceneElements(s, [el('b', 2)]);
  assert.deepEqual(
    s.whiteboard.scene.map((e) => e.id).sort(),
    ['a', 'b', 'c'],
    'the other two strokes must still be on the board',
  );
});

t('a deletion is just another versioned change', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 1)]);
  mergeSceneElements(s, [el('a', 2, { isDeleted: true })]);
  assert.equal(s.whiteboard.scene[0]?.isDeleted, true);
});

t('an equal version still applies, since Excalidraw reuses it on no-op edits', () => {
  const s = createSession('t');
  mergeSceneElements(s, [el('a', 3, { x: 1 })]);
  mergeSceneElements(s, [el('a', 3, { x: 2 })]);
  assert.equal(s.whiteboard.scene[0]?.x, 2);
});

t('the board starts empty and not presenting', () => {
  const s = createSession('t');
  assert.deepEqual(s.whiteboard.scene, []);
  assert.equal(s.whiteboard.presenting, null);
});

console.log(`\n${pass} passing`);
