/**
 * Tests for self-echo filtering (see src/agent/echo.ts).
 *
 * The case that matters most is the mixed turn: a student answers WHILE
 * Athena's TTS is still leaking into the room from a shared speaker, and both
 * land in one ASR turn. A naive boolean "is this an echo" throws the whole
 * turn away — the real answer is lost with it, silently. These tests prove the
 * remainder survives.
 *
 * Run with: node --import tsx scripts/echo.test.ts
 */

import assert from 'node:assert/strict';
import { rememberAgentUtterance, stripSelfEcho } from '../src/agent/echo.ts';
import { createSession } from '../src/state/sessionRegistry.ts';

let pass = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

t('unrelated speech passes through untouched', () => {
  const session = createSession('test');
  rememberAgentUtterance(session, 'A common denominator is a shared multiple.');
  const result = stripSelfEcho(session, 'Can you explain that again please');
  assert.equal(result, 'Can you explain that again please');
});

t('an exact echo is dropped entirely', () => {
  const session = createSession('test');
  rememberAgentUtterance(
    session,
    'A common denominator is a shared multiple of the denominators.',
  );
  const result = stripSelfEcho(
    session,
    'A common denominator is a shared multiple of the denominators.',
  );
  assert.equal(result, '');
});

t('a fuzzy echo (ASR mangled it slightly) is still dropped', () => {
  const session = createSession('test');
  rememberAgentUtterance(
    session,
    'A common denominator is a shared multiple of the denominators.',
  );
  const result = stripSelfEcho(
    session,
    'a common denominator is a shared multiple of the denominator',
  );
  assert.equal(result, '');
});

t('the exact regression: a real answer spoken over the tail of her sentence survives', () => {
  const session = createSession('test');
  rememberAgentUtterance(
    session,
    'so the least common denominator here is six',
  );
  // One mixed ASR turn: her tail end, followed by a genuine student answer.
  const result = stripSelfEcho(
    session,
    'so the least common denominator here is six I think the answer is six',
  );
  assert.ok(
    result.length > 0,
    'the real answer must not be thrown away with the echo',
  );
  assert.ok(
    result.includes('six'),
    `expected the surviving remainder to contain the answer, got ${JSON.stringify(result)}`,
  );
});

t('very short utterances are never filtered, even if they overlap', () => {
  const session = createSession('test');
  rememberAgentUtterance(session, 'is six');
  const result = stripSelfEcho(session, 'yes');
  assert.equal(result, 'yes');
});

t('an utterance older than the echo window is not matched', () => {
  const session = createSession('test');
  const t0 = 1_000_000;
  rememberAgentUtterance(session, 'A common denominator is a shared multiple.', t0);

  // Well past the 10s window: the same words, spoken for real minutes later,
  // must not be silently treated as an echo of something long gone.
  const result = stripSelfEcho(
    session,
    'A common denominator is a shared multiple.',
    t0 + 5 * 60_000,
  );
  assert.equal(result, 'A common denominator is a shared multiple.');
});

t('still within the window, the same match is caught', () => {
  const session = createSession('test');
  const t0 = 1_000_000;
  rememberAgentUtterance(session, 'A common denominator is a shared multiple.', t0);

  const result = stripSelfEcho(
    session,
    'A common denominator is a shared multiple.',
    t0 + 3000,
  );
  assert.equal(result, '');
});

t('no agent speech recorded yet: everything passes through', () => {
  const session = createSession('test');
  const result = stripSelfEcho(session, 'Hello, can everyone hear me?');
  assert.equal(result, 'Hello, can everyone hear me?');
});

console.log(`\n${pass} passing`);
