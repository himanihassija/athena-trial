/**
 * Tests for turn-taking enforcement (see classroomController.ts).
 *
 * The case that matters most here is the bug a live session actually hit: a
 * legitimate, permitted answer that ran long — ASR settle + LLM generation +
 * a genuinely long spoken response can easily exceed the permit's TTL — was
 * being cut off mid-sentence because enforcement re-validated the permit's
 * timestamp on every state-change event, including ones that happen well
 * after the turn has already, correctly, begun.
 *
 * Time is faked by rewinding `speakPermit.grantedAt` rather than sleeping;
 * these run in milliseconds and still exercise real elapsed-time logic.
 *
 * Run with: node --import tsx scripts/floor.test.ts
 */

import assert from 'node:assert/strict';
import {
  clearSpeakPermit,
  grantSpeakPermit,
  handleAgentState,
  hasSpeakPermit,
  ingestTranscript,
} from './../src/classroomController.ts';
import { addParticipant, createSession } from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

const rewind = (session: ReturnType<typeof createSession>, ms: number) => {
  if (session.speakPermit) session.speakPermit.grantedAt -= ms;
};

await t('no permit: a turn starting is interrupted', async () => {
  const session = createSession('test');
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true);
});

await t('valid permit: a turn is allowed to start', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, false);
  assert.equal(session.authorizedTurnInProgress, true);
});

await t(
  'the exact regression: a turn already authorized is NOT re-cut by a later, stale-looking check',
  async () => {
    const session = createSession('test');
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

    const started = await handleAgentState(session, 'thinking');
    assert.equal(started.interrupted, false);

    // Simulate real-world latency: generation + a long spoken answer running
    // well past the permit's original TTL, all within one continuous turn.
    rewind(session, 20_000);
    assert.equal(hasSpeakPermit(session), false, 'sanity: the permit itself has expired');

    const midSpeech = await handleAgentState(session, 'speaking');
    assert.equal(
      midSpeech.interrupted,
      false,
      'a turn already under way must not be cut off by a stale TTL check',
    );
  },
);

await t('a turn ending resets authorization for the next one', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'speaking');

  await handleAgentState(session, 'silent');
  assert.equal(session.authorizedTurnInProgress, false);

  // No fresh permit was granted — the next turn must be authorized on its
  // own, not inherit the previous turn's clearance.
  const nextTurn = await handleAgentState(session, 'thinking');
  assert.equal(nextTurn.interrupted, true);
});

await t('mute blocks a turn that has not started yet, even with a valid permit', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  session.policy.muted = true;
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true);
});

await t('clearSpeakPermit revokes both the standing permit and an in-progress turn', () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'TEACHER_INVOKED');
  session.authorizedTurnInProgress = true;
  clearSpeakPermit(session);
  assert.equal(session.speakPermit, null);
  assert.equal(session.authorizedTurnInProgress, false);
});

await t(
  'the other regression: the teacher can address the agent by name even with the floor closed to students',
  () => {
    const session = createSession('test');
    const teacher = addParticipant(session, {
      displayName: 'Ms Rao',
      role: 'teacher',
    });
    // Explicit, even though this is the default — the floor gate exists to
    // control STUDENT access, and must never block the teacher's own.
    session.policy.studentsMayInvoke = false;

    ingestTranscript(session, {
      uid: teacher.uid,
      text: 'Athena, can you hear me?',
      isFinal: true,
    });

    assert.equal(
      session.speakPermit?.reason,
      'DIRECTLY_ADDRESSED',
      'the teacher addressing her by name must grant a permit',
    );
    assert.equal(session.activeQuestionerId, teacher.participantId);
  },
);

await t('the gate still blocks a STUDENT addressing her while the floor is closed', () => {
  const session = createSession('test');
  const student = addParticipant(session, {
    displayName: 'Ana',
    role: 'student',
  });
  session.policy.studentsMayInvoke = false;

  ingestTranscript(session, {
    uid: student.uid,
    text: 'Hey Athena, what is a fraction?',
    isFinal: true,
  });

  assert.equal(
    session.speakPermit,
    null,
    'a student must not be able to summon her while the floor is closed',
  );
});

await t('a student CAN address her once the teacher opens the floor', () => {
  const session = createSession('test');
  const student = addParticipant(session, {
    displayName: 'Ana',
    role: 'student',
  });
  session.policy.studentsMayInvoke = true;

  ingestTranscript(session, {
    uid: student.uid,
    text: 'Hey Athena, what is a fraction?',
    isFinal: true,
  });

  assert.equal(session.speakPermit?.reason, 'DIRECTLY_ADDRESSED');
  assert.equal(session.activeQuestionerId, student.participantId);
});

// ─── Restraint meter reflects real floor decisions (Phase 3 wiring) ──────────

await t('a blocked student invocation drives the restraint meter to held-back', async () => {
  const session = createSession('test');
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  session.policy.studentsMayInvoke = false;

  await ingestTranscript(session, {
    uid: student.uid,
    text: 'Athena, can you continue?',
    isFinal: true,
  });

  assert.equal(session.speakPermit, null, 'no permit for a blocked student');
  assert.equal(session.restraintMeterState, 'held-back');
});

await t('an authorised turn beginning drives the meter to speaking', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  assert.equal(session.restraintMeterState, 'speaking');
});

await t('a turn ending returns the meter to listening', async () => {
  const session = createSession('test');
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'silent');
  assert.equal(session.restraintMeterState, 'listening');
});

await t('an un-permitted autonomous turn being cut drives the meter to held-back', async () => {
  const session = createSession('test');
  const result = await handleAgentState(session, 'thinking');
  assert.equal(result.interrupted, true);
  assert.equal(session.restraintMeterState, 'held-back');
});

/**
 * The live failure this pins: the teacher addressed Athena by name, the floor
 * was granted, and she was cut off mid-word — "I can't draw a".
 *
 * A turn is authorised on its first state change, which consumes the standing
 * permit and sets authorizedTurnInProgress. Any non-starting state clears that
 * flag. So one stray or out-of-order 'listening' between 'thinking' and
 * 'speaking' left the turn with neither flag nor permit, and the next
 * 'speaking' was interrupted as un-permitted. Agent state arrives over RTM and
 * is not guaranteed ordered or complete, so this is reachable in normal use.
 */
await t('a stray state mid-turn does not cut off an authorised turn', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  const started = await handleAgentState(session, 'thinking');
  assert.equal(started.interrupted, false, 'a granted turn must be allowed to start');

  // The engine reports a momentary non-speaking state mid-turn.
  await handleAgentState(session, 'listening');

  const resumed = await handleAgentState(session, 'speaking');
  assert.equal(
    resumed.interrupted,
    false,
    'she must not be cut off partway through a turn she was granted',
  );
});

await t('a genuinely new turn after one ends still needs its own permit', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');

  await handleAgentState(session, 'thinking');
  await handleAgentState(session, 'silent');

  // Well past any continuation window: an unrelated later turn must not ride
  // on the invitation meant for the finished one.
  session.lastAuthorisedTurnAt = Date.now() - 60_000;
  const next = await handleAgentState(session, 'speaking');
  assert.equal(next.interrupted, true, 'an unrelated later turn must be interrupted');
});

console.log(`\n${pass} passing`);
