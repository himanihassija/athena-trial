/**
 * Tests for quiz resolution (see quiz/quizEngine.ts, classroomController.ts).
 *
 * The gap this locks down: a quiz used to hang open forever once everyone had
 * answered. Students saw their own result but the card never revealed the
 * correct answer, and nothing signalled the question was done. `quiz-closed`
 * now fires to the whole room the moment the last active target answers.
 *
 * Run with: node --import tsx scripts/quiz.test.ts
 */

import assert from 'node:assert/strict';
import type { ClassroomEvent } from '@echosphere/shared-types';
import { submitQuizAnswer } from './../src/classroomController.ts';
import {
  allTargetsAnswered,
  recordQuizFromControl,
} from './../src/quiz/quizEngine.ts';
import { subscribe } from './../src/state/eventBus.ts';
import {
  addParticipant,
  createSession,
  removeParticipant,
} from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

const QUIZ_CONTROL = {
  topic: 'LCD',
  question: 'What is the first step to add 1/3 and 1/4?',
  options: ['Add the denominators', 'Find the least common denominator'],
  answer: 'B',
} as const;

/** Collects every event published to a room, in order. */
function recorder(sessionId: string): { events: ClassroomEvent[]; stop: () => void } {
  const events: ClassroomEvent[] = [];
  const stop = subscribe(sessionId, {
    subscriberId: 'test',
    participantId: 'test',
    role: 'teacher',
    send: (e) => events.push(e),
    close: () => undefined,
  });
  return { events, stop };
}

t('allTargetsAnswered: false before anyone answers, true once the sole target does', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [ana.participantId]);

  assert.equal(allTargetsAnswered(session, quiz), false);
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui');
  assert.equal(allTargetsAnswered(session, quiz), true);
});

t('allTargetsAnswered: an empty room never counts as "all answered"', () => {
  const session = createSession('t');
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', []);
  assert.equal(allTargetsAnswered(session, quiz), false);
});

t('submitQuizAnswer publishes quiz-closed to the room when the last target answers', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const bo = addParticipant(session, { displayName: 'Bo', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [
    ana.participantId,
    bo.participantId,
  ]);
  const { events, stop } = recorder(session.sessionId);

  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'A', 'ui');
  assert.equal(
    events.some((e) => e.kind === 'echosphere:quiz-closed'),
    false,
    'must not close while a target still has not answered',
  );

  submitQuizAnswer(session, quiz.quizId, bo.participantId, 'B', 'ui');
  const closed = events.find((e) => e.kind === 'echosphere:quiz-closed');
  stop();
  assert.ok(closed, 'quiz-closed should fire once everyone has answered');
  assert.equal(
    (closed as { correctAnswer: string }).correctAnswer,
    'Find the least common denominator',
  );
});

t('a student who left does not keep the quiz open', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const bo = addParticipant(session, { displayName: 'Bo', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [
    ana.participantId,
    bo.participantId,
  ]);

  removeParticipant(session, bo.participantId);
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui');
  assert.equal(allTargetsAnswered(session, quiz), true);
});

console.log(`\n${pass} passing`);
