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

// ─── Floor indicator (§3.3) ──────────────────────────────────────────────────

const FLOOR_LABEL: Record<FloorSnapshot['state'], string> = {
  TEACHER_HOLDS_FLOOR: 'Teacher is speaking',
  OPEN_FLOOR: 'Open floor',
  AGENT_SPEAKING: 'Athena is speaking',
  STUDENT_QUESTION_PENDING: 'Waiting on Athena',
};

const FLOOR_TONE: Record<FloorSnapshot['state'], string> = {
  TEACHER_HOLDS_FLOOR: 'bg-blue-100 text-blue-900 border-blue-300',
  OPEN_FLOOR: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  AGENT_SPEAKING: 'bg-violet-100 text-violet-900 border-violet-300',
  STUDENT_QUESTION_PENDING: 'bg-amber-100 text-amber-900 border-amber-300',
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
    <div className="flex items-center gap-2">
      <span
        className={`rounded-full border px-3 py-1 text-xs font-medium ${FLOOR_TONE[floor.state]}`}
      >
        {FLOOR_LABEL[floor.state]}
      </span>
      {policy && !policy.studentsMayInvoke && !policy.muted && (
        <span className="rounded-full border border-neutral-300 bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
          Listening only
        </span>
      )}
      {policy?.muted && (
        <span className="rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-medium text-red-900">
          AI muted
        </span>
      )}
      {policy && policy.verbosity !== 'normal' && (
        <span className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600">
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
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">In the room</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {teacher && (
          <li className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            {teacher.displayName}
            <span className="text-xs text-neutral-500">teacher</span>
          </li>
        )}
        <li className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${agentPresent ? 'bg-violet-500' : 'bg-neutral-300'}`}
          />
          Athena
          <span className="text-xs text-neutral-500">
            {agentPresent ? 'AI co-teacher' : 'not started'}
          </span>
        </li>
        {students.map((student) => (
          <li key={student.participantId} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-neutral-400" />
            {student.displayName}
            {onSetProficiency ? (
              <select
                aria-label={`Explanation level for ${student.displayName}`}
                className="ml-auto rounded border border-neutral-300 px-1 py-0.5 text-xs"
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
              <span className="ml-auto text-xs text-neutral-500">
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
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <strong>Athena is not in the room yet.</strong>{' '}
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

  // `min-h-0` at every level of the flex chain is what actually lets the scroll
  // area own the leftover height. Without it a flex child refuses to shrink
  // below its content and the transcript collapses to a sliver no matter how
  // tall the window is.
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Live transcript</h2>
        {transcript.length > 0 && (
          <span className="text-xs text-neutral-400">
            {transcript.length} turn{transcript.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
        {transcript.length === 0 ? (
          <p className="text-sm text-neutral-400">
            {agentPresent
              ? 'Nothing spoken yet. The transcript fills in as people talk.'
              : 'Transcription starts when Athena joins the room.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {transcript.map((segment) => (
              <li key={segment.segmentId} className="flex flex-col gap-0.5">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    segment.speaker === 'agent'
                      ? 'text-violet-600'
                      : segment.speaker === 'teacher'
                        ? 'text-blue-600'
                        : 'text-neutral-500'
                  }`}
                >
                  {nameOf(segment)}
                </span>
                <span className="text-[15px] leading-relaxed text-neutral-800">
                  {segment.text}
                </span>
              </li>
            ))}
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
      <h2 className="text-sm font-semibold">Quiz</h2>
      {quizzes.slice(-3).map(({ quiz, myAnswer, myResult, correctAnswer, results }) => (
        <article
          key={quiz.quizId}
          className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
        >
          <p className="text-sm font-medium">{quiz.question}</p>
          <ul className="flex flex-col gap-1">
            {(quiz.options ?? []).map((option) => {
              const chosen = myAnswer === option;
              const isCorrect = correctAnswer === option;
              return (
                <li key={option}>
                  <button
                    type="button"
                    disabled={!canAnswer || myAnswer !== undefined}
                    onClick={() => onAnswer(quiz.quizId, option)}
                    className={`w-full rounded border px-3 py-1.5 text-left text-sm disabled:cursor-default ${
                      correctAnswer && isCorrect
                        ? 'border-green-400 bg-green-50'
                        : chosen
                          ? myResult === 'correct'
                            ? 'border-green-400 bg-green-50'
                            : 'border-red-400 bg-red-50'
                          : 'border-neutral-300'
                    }`}
                  >
                    {option}
                  </button>
                </li>
              );
            })}
          </ul>
          {myResult && (
            <p className="text-xs text-neutral-600">
              {myResult === 'correct' ? 'Correct.' : 'Not quite.'}
            </p>
          )}
          {Object.keys(results).length > 0 && (
            <p className="text-xs text-neutral-500">
              {Object.values(results).filter(Boolean).length} of{' '}
              {Object.keys(results).length} answered correctly
            </p>
          )}
          <p className="text-xs text-neutral-400">
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
      <h2 className="text-sm font-semibold">Who needs help</h2>
      {gaps.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No repeated misconceptions detected yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gaps.map((gap) => {
            const count = gap.affectedStudentIds.length;
            const tone =
              count >= 3
                ? 'border-red-300 bg-red-50'
                : count === 2
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-neutral-200';
            return (
              <li
                key={gap.gapId}
                className={`flex flex-col gap-1 rounded-md border p-3 ${tone}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{gap.topic}</p>
                  <span className="text-xs text-neutral-600">
                    {count} student{count === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  {gap.affectedStudentIds.map(nameOf).join(', ')}
                </p>
                {gap.addressedAt && (
                  <p className="text-xs text-neutral-500">
                    Athena has addressed this.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onQuiz(gap.topic, gap.affectedStudentIds)}
                  className="self-start rounded border border-neutral-400 px-2 py-1 text-xs"
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
      <h2 className="text-sm font-semibold">AI held back</h2>
      <ul className="flex flex-col gap-0.5 text-xs text-neutral-600">
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
