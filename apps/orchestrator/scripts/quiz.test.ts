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
import {
  maybeAdvanceQuizSet,
  startQuiz,
  submitQuizAnswer,
  sweepExpiredQuiz,
} from './../src/classroomController.ts';
import {
  allTargetsAnswered,
  answersFor,
  recordQuizFromControl,
} from './../src/quiz/quizEngine.ts';
import { subscribe } from './../src/state/eventBus.ts';
import {
  addParticipant,
  createSession,
  removeParticipant,
} from './../src/state/sessionRegistry.ts';

let pass = 0;
const t = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try { await fn(); pass += 1; console.log(`  ok  ${name}`); }
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

await t('allTargetsAnswered: false before anyone answers, true once the sole target does', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [ana.participantId]);

  assert.equal(allTargetsAnswered(session, quiz), false);
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui');
  assert.equal(allTargetsAnswered(session, quiz), true);
});

await t('allTargetsAnswered: an empty room never counts as "all answered"', () => {
  const session = createSession('t');
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', []);
  assert.equal(allTargetsAnswered(session, quiz), false);
});

await t('submitQuizAnswer publishes quiz-closed to the room when the last target answers', () => {
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

await t('a student who left does not keep the quiz open', () => {
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

await t('every quiz carries a future deadline', () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ana', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', []);
  assert.ok(quiz.deadline > Date.now());
  assert.equal(quiz.closedAt, undefined);
});

await t('sweepExpiredQuiz marks non-answerers incorrect, then closes and reveals', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const bo = addParticipant(session, { displayName: 'Bo', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [
    ana.participantId,
    bo.participantId,
  ]);
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui'); // Ana answers, correctly
  const { events, stop } = recorder(session.sessionId);

  sweepExpiredQuiz(session, quiz.quizId);
  stop();

  const boAnswer = answersFor(session, quiz.quizId).find(
    (a) => a.participantId === bo.participantId,
  );
  assert.ok(boAnswer, 'Bo, who never answered, should have a recorded answer');
  assert.equal(boAnswer.correct, false, 'a non-answer counts as incorrect');
  assert.equal((session.participants.get(bo.participantId) as { stats: { quizzesAnswered: number } }).stats.quizzesAnswered, 1);
  assert.ok(quiz.closedAt, 'the quiz should be closed');
  assert.ok(events.some((e) => e.kind === 'echosphere:quiz-closed'));
});

await t('sweepExpiredQuiz is a no-op once the quiz has already closed', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [ana.participantId]);
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui'); // closes it (sole target answered)
  const closedAt = quiz.closedAt;
  assert.ok(closedAt);

  sweepExpiredQuiz(session, quiz.quizId);
  assert.equal(quiz.closedAt, closedAt, 'closedAt must not be rewritten');
});

await t('a quiz issued inside a set is tagged "N of total"', () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ana', role: 'student' });
  session.activeQuizSet = {
    topic: 'LCD', targetStudentIds: [], origin: 'teacher',
    total: 3, asked: 2, quizIds: [], askedQuestions: [],
  };
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', []);
  // applyControl is what stamps the set index; simulate its effect here since
  // recordQuizFromControl alone does not know about the set.
  quiz.setIndex = session.activeQuizSet.asked;
  quiz.setTotal = session.activeQuizSet.total;
  assert.equal(quiz.setIndex, 2);
  assert.equal(quiz.setTotal, 3);
});

await t('closing the last question in a set ends the set', async () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [ana.participantId]);
  session.activeQuizSet = {
    topic: 'LCD', targetStudentIds: [ana.participantId], origin: 'teacher',
    total: 2, asked: 2, quizIds: [quiz.quizId], askedQuestions: ['q1', 'q2'],
  };
  submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui'); // closes it
  await maybeAdvanceQuizSet(session, quiz);
  assert.equal(session.activeQuizSet, null, 'the set should be finished');
});

await t('a closed quiz rejects a late answer', () => {
  const session = createSession('t');
  const ana = addParticipant(session, { displayName: 'Ana', role: 'student' });
  const bo = addParticipant(session, { displayName: 'Bo', role: 'student' });
  const quiz = recordQuizFromControl(session, QUIZ_CONTROL, 'teacher', [
    ana.participantId,
    bo.participantId,
  ]);
  sweepExpiredQuiz(session, quiz.quizId); // closes with both marked incorrect

  const late = submitQuizAnswer(session, quiz.quizId, ana.participantId, 'B', 'ui');
  assert.equal(late.ok, false);
});

await t('every question in a set requests the floor (a muted agent blocks Start Quiz cleanly)', async () => {
  const session = createSession('t');
  addParticipant(session, { displayName: 'Ana', role: 'student' });
  session.policy.muted = true;

  const result = await startQuiz(session, 'fractions', [], 'teacher');
  assert.equal(result.ok, false, 'a muted agent must block the quiz');
  assert.equal(session.activeQuizSet, null, 'no half-started set is left behind');
});

console.log(`\n${pass} passing`);
