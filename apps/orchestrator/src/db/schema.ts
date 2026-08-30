/**
 * Persistence schema — PS31 §4 (Postgres for session logs, profiles, quiz
 * results, transcripts).
 *
 * `sessionRegistry.ts`'s own header comment already states the design this
 * implements: the in-memory `ClassroomSession` stays the single source of
 * truth for the whole live session (the floor state machine needs one
 * long-lived writer), and is flushed here once, at session end — see
 * `report/persist.ts`. Nothing in the hot turn-taking path touches this
 * schema; it exists purely for after-the-fact durability and querying.
 *
 * `SessionReport` (the generated post-class report) is stored as a single
 * JSONB blob in `reports` rather than fully normalized — it's write-once,
 * read-whole, and its shape already has a canonical source of truth (the
 * `SessionReport` TS type in packages/shared-types). Everything upstream of
 * the report — participants, transcript, quizzes, gaps — is normalized,
 * since those are the tables a teacher-analytics query would actually join
 * across later.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  channel: text('channel').notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const participants = pgTable(
  'participants',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    uid: text('uid').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['teacher', 'student'] }).notNull(),
    /** Null for teachers — only students carry a proficiency tag. */
    proficiency: text('proficiency'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [index('participants_session_idx').on(table.sessionId)],
);

export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    participantId: text('participant_id'),
    uid: text('uid').notNull(),
    speaker: text('speaker', { enum: ['teacher', 'student', 'agent'] }).notNull(),
    text: text('text').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    language: text('language'),
    turnId: integer('turn_id'),
    attributionConfidence: real('attribution_confidence'),
  },
  (table) => [index('transcript_session_idx').on(table.sessionId)],
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    quizId: text('quiz_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    question: text('question').notNull(),
    options: jsonb('options').$type<string[] | null>(),
    correctAnswer: text('correct_answer').notNull(),
    difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }).notNull(),
    targetStudentIds: jsonb('target_student_ids').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    origin: text('origin', { enum: ['teacher', 'gap-detector'] }).notNull(),
  },
  (table) => [index('quiz_questions_session_idx').on(table.sessionId)],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizQuestions.quizId, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    answer: text('answer').notNull(),
    correct: boolean('correct').notNull(),
    via: text('via', { enum: ['ui', 'voice'] }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (table) => [index('quiz_answers_session_idx').on(table.sessionId)],
);

export const learningGaps = pgTable(
  'learning_gaps',
  {
    gapId: text('gap_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    description: text('description').notNull(),
    affectedStudentIds: jsonb('affected_student_ids').$type<string[]>().notNull(),
    evidence: jsonb('evidence').$type<
      Array<{ kind: string; participantId: string; text: string; at: number }>
    >().notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    addressedAt: timestamp('addressed_at', { withTimezone: true }),
  },
  (table) => [index('learning_gaps_session_idx').on(table.sessionId)],
);

export const reports = pgTable('reports', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.sessionId, { onDelete: 'cascade' }),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
  narrative: text('narrative').notNull(),
  /** The full generated SessionReport (packages/shared-types) — see file header. */
  report: jsonb('report').notNull(),
});

export const sessionsRelations = relations(sessions, ({ many, one }) => ({
  participants: many(participants),
  transcriptSegments: many(transcriptSegments),
  quizQuestions: many(quizQuestions),
  quizAnswers: many(quizAnswers),
  learningGaps: many(learningGaps),
  report: one(reports, { fields: [sessions.sessionId], references: [reports.sessionId] }),
}));
