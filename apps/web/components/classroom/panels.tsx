/**
 * Presentational panels shared by the student classroom and the teacher
 * dashboard. All state arrives as props from `useClassroom` — nothing here
 * derives classroom truth locally.
 */

'use client';

import { useEffect, useRef } from 'react';
import type {
  AgentPolicy,
  FloorSnapshot,
  LearningGap,
  PublicParticipant,
  TranscriptSegment,
} from '@echosphere/shared-types';
import type { BlockedAttempt, QuizCardState } from '@/hooks/useClassroom';
import { seatColorVar } from '@/lib/seatColor';

/** Below this, a spoken-attribution guess is a close call, not a fact. */
const UNCERTAIN_ATTRIBUTION_THRESHOLD = 0.62;

// ─── Floor indicator (§3.3) — the on-air lamp ────────────────────────────────

const FLOOR_LABEL: Record<FloorSnapshot['state'], string> = {
  TEACHER_HOLDS_FLOOR: 'Teacher is speaking',
  OPEN_FLOOR: 'Open floor',
  AGENT_SPEAKING: 'Athena is speaking',
  STUDENT_QUESTION_PENDING: 'Waiting on Athena',
};

const FLOOR_LAMP: Record<FloorSnapshot['state'], string> = {
  TEACHER_HOLDS_FLOOR: 'eco-lamp-amber',
  OPEN_FLOOR: 'eco-lamp-off',
  AGENT_SPEAKING: 'eco-lamp-glow eco-pulse',
  STUDENT_QUESTION_PENDING: 'eco-lamp-amber eco-pulse',
};

export function FloorIndicator({
  floor,
  policy,
}: {
  floor: FloorSnapshot | null;
  policy: AgentPolicy | null;
}) {
  if (!floor) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eco-panel-sunken flex items-center gap-2 px-3 py-1.5">
        <span className={`eco-lamp ${FLOOR_LAMP[floor.state]}`} />
        <span className="text-xs font-medium text-[var(--eco-cream)]">
          {FLOOR_LABEL[floor.state]}
        </span>
      </span>
      {policy && !policy.studentsMayInvoke && !policy.muted && (
        <span className="eco-panel-sunken px-3 py-1.5 text-xs font-medium text-[var(--eco-cream-dim)]">
          Listening only
        </span>
      )}
      {policy?.muted && (
        <span
          className="flex items-center gap-1.5 rounded-[0.625rem] border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: 'var(--eco-red)',
            background: 'var(--eco-red-dim)',
            color: 'var(--eco-red)',
          }}
        >
          <span className="eco-lamp eco-lamp-red" />
          AI muted
        </span>
      )}
      {policy && policy.verbosity !== 'normal' && (
        <span className="eco-panel-sunken px-3 py-1.5 text-xs capitalize text-[var(--eco-cream-dim)]">
          {policy.verbosity}
        </span>
      )}
    </div>
  );
}

// ─── Roster (§3.2, §3.5) ─────────────────────────────────────────────────────

export function RosterPanel({
  participants,
  agentPresent,
  onSetProficiency,
}: {
  participants: PublicParticipant[];
  agentPresent: boolean;
  onSetProficiency?: (participantId: string, proficiency: string) => void;
}) {
  const teacher = participants.find((p) => p.role === 'teacher');
  const students = participants.filter((p) => p.role === 'student');

  return (
    <section className="eco-panel flex flex-col gap-3 p-4">
      <h2 className="eco-label">In the room</h2>
      <ul className="flex flex-col gap-2.5 text-sm">
        {teacher && (
          <li className="flex items-center gap-2.5">
            <span
              className="eco-seat-dot"
              style={{ background: seatColorVar(teacher.participantId) }}
            />
            <span className="text-[var(--eco-cream)]">{teacher.displayName}</span>
            <span className="text-xs text-[var(--eco-cream-faint)]">teacher</span>
          </li>
        )}
        <li className="flex items-center gap-2.5">
          <span
            className={`eco-lamp ${agentPresent ? 'eco-lamp-glow' : 'eco-lamp-off'}`}
          />
          <span className="text-[var(--eco-cream)]">Athena</span>
          <span className="text-xs text-[var(--eco-cream-faint)]">
            {agentPresent ? 'AI co-teacher' : 'not started'}
          </span>
        </li>
        {students.map((student) => (
          <li key={student.participantId} className="flex items-center gap-2.5">
            <span
              className="eco-seat-dot"
              style={{ background: seatColorVar(student.participantId) }}
            />
            <span className="text-[var(--eco-cream)]">{student.displayName}</span>
            {onSetProficiency ? (
              <select
                aria-label={`Explanation level for ${student.displayName}`}
                className="ml-auto rounded-md border px-1.5 py-0.5 text-xs"
                style={{
                  borderColor: 'var(--eco-rule)',
                  background: 'var(--eco-ink-sunken)',
                  color: 'var(--eco-cream)',
                }}
                value={student.proficiency ?? 'intermediate'}
                onChange={(e) =>
                  onSetProficiency(student.participantId, e.target.value)
                }
              >
                <option value="beginner">beginner</option>
                <option value="intermediate">intermediate</option>
                <option value="advanced">advanced</option>
              </select>
            ) : (
              <span className="ml-auto text-xs text-[var(--eco-cream-faint)]">
                {student.proficiency}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Explains an empty room when the AI is not in it.
 *
 * Agora's ConvoAI agent owns the whole ASR path, so with no agent in the channel
 * nobody gets a transcript however much they talk — the audio still flows
 * between people, but nothing transcribes it. Without this notice the transcript
 * panel's "nothing spoken yet" reads as a bug rather than a missing step.
 */
export function AgentAbsentNotice({
  isTeacher,
}: {
  isTeacher: boolean;
}) {
  return (
    <div
      className="rounded-[0.625rem] border px-4 py-3 text-sm"
      style={{
        borderColor: 'var(--eco-amber)',
        background: 'var(--eco-amber-dim)',
        color: 'var(--eco-cream)',
      }}
    >
      <strong style={{ color: 'var(--eco-amber)' }}>
        Athena is not in the room yet.
      </strong>{' '}
      {isTeacher
        ? 'Press "Bring Athena in" above to start her. Live transcription runs through her, so nothing will be transcribed until she joins.'
        : 'Live transcription runs through her, so nothing will appear here until your teacher brings her in. You can still be heard by everyone.'}
    </div>
  );
}

// ─── Transcript (§3.4) ───────────────────────────────────────────────────────

export function TranscriptFeed({
  transcript,
  participants,
  agentPresent = true,
}: {
  transcript: TranscriptSegment[];
  participants: PublicParticipant[];
  /** When false, an empty transcript is expected rather than surprising. */
  agentPresent?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript.length]);

  const nameOf = (segment: TranscriptSegment) => {
    if (segment.speaker === 'agent') return 'Athena';
    const match = participants.find(
      (p) => p.participantId === segment.participantId,
    );
    return match?.displayName ?? `Participant ${segment.uid}`;
  };

  const seatOf = (segment: TranscriptSegment): string =>
    segment.speaker === 'agent'
      ? 'var(--eco-glow)'
      : seatColorVar(segment.participantId ?? segment.uid);

  // `min-h-0` at every level of the flex chain is what actually lets the scroll
  // area own the leftover height. Without it a flex child refuses to shrink
  // below its content and the transcript collapses to a sliver no matter how
  // tall the window is.
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="eco-label">Live transcript</h2>
        {transcript.length > 0 && (
          <span className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
            {transcript.length} turn{transcript.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="eco-panel min-h-0 flex-1 overflow-y-auto p-4">
        {transcript.length === 0 ? (
          <p className="text-sm text-[var(--eco-cream-faint)]">
            {agentPresent
              ? 'Nothing spoken yet. The transcript fills in as people talk.'
              : 'Transcription starts when Athena joins the room.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3.5">
            {transcript.map((segment) => {
              const uncertain =
                segment.attributionConfidence !== undefined &&
                segment.attributionConfidence < UNCERTAIN_ATTRIBUTION_THRESHOLD;
              return (
                <li
                  key={segment.segmentId}
                  className="flex gap-3 border-l-2 pl-3"
                  style={{ borderColor: seatOf(segment) }}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color: seatOf(segment) }}
                      >
                        {nameOf(segment)}
                      </span>
                      {uncertain && (
                        <span
                          className="rounded px-1 text-[0.625rem] font-medium uppercase tracking-wide"
                          style={{
                            background: 'var(--eco-amber-dim)',
                            color: 'var(--eco-amber)',
                          }}
                          title="Two people were speaking at close to the same volume — this attribution is a best guess, not a fact."
                        >
                          unclear who
                        </span>
                      )}
                    </span>
                    <span className="text-[15px] leading-relaxed text-[var(--eco-cream)]">
                      {segment.text}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

// ─── Quiz cards (§3.6) ───────────────────────────────────────────────────────

export function QuizCards({
  quizzes,
  canAnswer,
  onAnswer,
}: {
  quizzes: QuizCardState[];
  canAnswer: boolean;
  onAnswer: (quizId: string, answer: string) => void;
}) {
  if (quizzes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="eco-label">Quiz</h2>
      {quizzes.slice(-3).map(({ quiz, myAnswer, myResult, correctAnswer, results }) => (
        <article key={quiz.quizId} className="eco-panel flex flex-col gap-2 p-3.5">
          <p className="text-sm font-medium text-[var(--eco-cream)]">
            {quiz.question}
          </p>
          <ul className="flex flex-col gap-1.5">
            {(quiz.options ?? []).map((option) => {
              const chosen = myAnswer === option;
              const isCorrect = correctAnswer === option;
              const revealed = correctAnswer && isCorrect;
              const wrongChoice = chosen && myResult === 'incorrect';
              return (
                <li key={option}>
                  <button
                    type="button"
                    disabled={!canAnswer || myAnswer !== undefined}
                    onClick={() => onAnswer(quiz.quizId, option)}
                    className="w-full rounded-lg border px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-default"
                    style={{
                      borderColor: revealed
                        ? 'var(--eco-green)'
                        : wrongChoice
                          ? 'var(--eco-red)'
                          : 'var(--eco-rule)',
                      background: revealed
                        ? 'var(--eco-green-dim)'
                        : wrongChoice
                          ? 'var(--eco-red-dim)'
                          : 'var(--eco-ink-sunken)',
                      color: 'var(--eco-cream)',
                    }}
                  >
                    {option}
                  </button>
                </li>
              );
            })}
          </ul>
          {myResult && (
            <p
              className="text-xs font-medium"
              style={{
                color: myResult === 'correct' ? 'var(--eco-green)' : 'var(--eco-red)',
              }}
            >
              {myResult === 'correct' ? 'Correct.' : 'Not quite.'}
            </p>
          )}
          {Object.keys(results).length > 0 && (
            <p className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
              {Object.values(results).filter(Boolean).length} of{' '}
              {Object.keys(results).length} answered correctly
            </p>
          )}
          <p className="text-xs text-[var(--eco-cream-faint)]">
            You can also answer out loud — say the option or its letter.
          </p>
        </article>
      ))}
    </section>
  );
}

// ─── Gap dashboard, teacher-only (§3.9) ──────────────────────────────────────

export function GapPanel({
  gaps,
  participants,
  onQuiz,
}: {
  gaps: LearningGap[];
  participants: PublicParticipant[];
  onQuiz: (topic: string, studentIds: string[]) => void;
}) {
  const nameOf = (id: string) =>
    participants.find((p) => p.participantId === id)?.displayName ?? 'someone';

  return (
    <section className="flex flex-col gap-2">
      <h2 className="eco-label">Who needs help</h2>
      {gaps.length === 0 ? (
        <p className="text-sm text-[var(--eco-cream-faint)]">
          No repeated misconceptions detected yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gaps.map((gap) => {
            const count = gap.affectedStudentIds.length;
            const severe = count >= 3;
            const moderate = count === 2;
            return (
              <li
                key={gap.gapId}
                className="flex flex-col gap-1 rounded-[0.625rem] border p-3"
                style={{
                  borderColor: severe
                    ? 'var(--eco-red)'
                    : moderate
                      ? 'var(--eco-amber)'
                      : 'var(--eco-rule)',
                  background: severe
                    ? 'var(--eco-red-dim)'
                    : moderate
                      ? 'var(--eco-amber-dim)'
                      : 'var(--eco-ink-sunken)',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--eco-cream)]">
                    {gap.topic}
                  </p>
                  <span className="eco-numerals text-xs text-[var(--eco-cream-dim)]">
                    {count} student{count === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-xs text-[var(--eco-cream-dim)]">
                  {gap.affectedStudentIds.map(nameOf).join(', ')}
                </p>
                {gap.addressedAt && (
                  <p className="text-xs text-[var(--eco-cream-faint)]">
                    Athena has addressed this.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onQuiz(gap.topic, gap.affectedStudentIds)}
                  className="self-start rounded-md border px-2 py-1 text-xs text-[var(--eco-cream)]"
                  style={{ borderColor: 'var(--eco-rule)' }}
                >
                  Quiz these students
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Blocked-attempt audit trail (§3.10) ─────────────────────────────────────

const DENIAL_LABEL: Record<string, string> = {
  AGENT_MUTED: 'blocked — you muted the AI',
  STUDENT_INVOCATION_DISABLED:
    'a student called her — floor is closed to students',
  TEACHER_HOLDS_FLOOR: 'blocked — you had the floor',
  AGENT_ALREADY_SPEAKING: 'blocked — already speaking',
  TOPIC_DISABLED: 'blocked — topic disabled',
  SILENCE_GAP_TOO_SHORT: 'blocked — no natural pause yet',
  NO_SESSION: 'blocked — session not found',
};

export function BlockedAttempts({ attempts }: { attempts: BlockedAttempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="eco-label">AI held back</h2>
      <ul className="eco-numerals flex flex-col gap-0.5 text-xs text-[var(--eco-cream-dim)]">
        {attempts
          .slice(-5)
          .reverse()
          .map((attempt) => (
            <li key={`${attempt.at}-${attempt.reason}`}>
              {new Date(attempt.at).toLocaleTimeString()} ·{' '}
              {DENIAL_LABEL[attempt.reason] ?? attempt.reason}
            </li>
          ))}
      </ul>
    </section>
  );
}
