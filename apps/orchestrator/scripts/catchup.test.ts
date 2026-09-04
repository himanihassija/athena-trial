import assert from 'node:assert/strict';
import { answerCatchup } from '../src/catchup/answer.ts';
import {
  addParticipant,
  AGENT_UID,
  appendTranscript,
  createSession,
} from '../src/state/sessionRegistry.ts';
import { seedUnlikeFractionsLesson } from '../src/lesson/demoUnlikeFractions.ts';

let pass = 0;
const t = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

await t('supports teachers as pedagogical copilot', async () => {
  const session = createSession('Catch-up test');
  const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  const result = await answerCatchup(session, teacher.participantId, 'Suggest a check-in question for fractions');
  assert.ok(result.reply.length > 10, result.reply);
  assert.equal(result.history[0]?.role, 'teacher');
  assert.equal(result.history[1]?.role, 'athena');
});

await t('recaps a missed lesson from notes and transcript', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  appendTranscript(session, {
    participantId: null,
    uid: AGENT_UID,
    speaker: 'agent',
    text: 'The LCD of 2 and 3 is 6.',
    at: Date.now(),
  });

  const result = await answerCatchup(
    session,
    student.participantId,
    'I missed the start — what did we cover?',
  );
  assert.ok(result.reply.length > 20, result.reply);
  assert.ok(
    /LCD|denominator|fraction|6/i.test(result.reply),
    result.reply,
  );
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0]?.role, 'student');
  assert.equal(result.history[1]?.role, 'athena');
  assert.ok(result.sources.some((s) => s.kind === 'lesson' || s.kind === 'transcript'));
});

await t('keeps the thread on a second question', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  await answerCatchup(session, student.participantId, 'What is the LCD rule?');
  const second = await answerCatchup(session, student.participantId, 'Give the 1/2 plus 1/3 example');
  assert.equal(second.history.length, 4);
  assert.match(second.reply, /6|LCD|1\/2|fraction/i);
});

console.log(`\n${pass} passing`);
if (process.exitCode) process.exit(process.exitCode);
