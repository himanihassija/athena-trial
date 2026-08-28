/**
 * Classroom controller — the seam where PS31's separate mechanisms meet.
 *
 * Transcript in -> speaker attribution (§3.8) -> floor transition (§3.3) ->
 * confusion detection (§3.9) -> a decision about whether the agent may speak.
 * Agent turns out -> control-channel parse (§3.6, §3.9) -> quiz cards and gaps.
 *
 * Every path that can make the agent talk goes through `requestFloor`, which is
 * the only caller of `decideSpeak`. That is what makes the teacher's mute an
 * absolute veto in practice rather than just in intent: there is one door.
 */

import type {
  ProficiencyTag,
  SpeakTrigger,
  TeacherCommand,
  TranscriptSegment,
} from '@echosphere/shared-types';
import {
  decideSpeak,
  isAddressedToAgent,
  onAgentSpeechEnd,
  onAgentSpeechStart,
  onHumanSpeechEnd,
  onHumanSpeechStart,
  onAddressedAgent,
  onTeacherBargeIn,
  stripWakePhrase,
} from './floor/floorMachine.js';
import {
  interruptAgent,
  pushInstructions,
  think,
} from './agent/agentLifecycle.js';
import {
  matchParticipantByName,
  parseAgentTurn,
  type CoTeacherControl,
} from './agent/control.js';
import {
  markGapAddressed,
  pendingClassWideGap,
  recordConfusedQuestion,
  recordReportedGap,
  recordWrongAnswer,
} from './gaps/gapDetector.js';
import {
  SYSTEM_PREFIX,
  forceSpeakDirective,
  gapInterjectionDirective,
  quizDirective,
} from './agent/prompt.js';
import {
  broadcastQuiz,
  normaliseAnswer,
  openQuizFor,
  recordAnswer,
  recordQuizFromControl,
} from './quiz/quizEngine.js';
import { rememberAgentUtterance, stripSelfEcho } from './agent/echo.js';
import { publish, publishTo, publishToTeachers } from './state/eventBus.js';
import {
  AGENT_UID,
  activeStudents,
  appendTranscript,
  participantByUid,
  setProficiency,
  toPublicParticipant,
  type ClassroomSession,
} from './state/sessionRegistry.js';

/**
 * How close together two identical utterances must be to count as one.
 *
 * Only relevant for segments with no turnId, where text is the sole identity.
 * Wide enough to absorb a slow relay, far short of how long it takes someone to
 * repeat themselves.
 */
const DUPLICATE_WINDOW_MS = 4000;

/** A quiz request the agent never answered is abandoned after this long. */
const PENDING_QUIZ_TTL_MS = 30_000;

/**
 * The single gate for agent speech. Everything that wants the agent to talk
 * calls this; nothing calls `decideSpeak` directly.
 */
export function requestFloor(
  session: ClassroomSession,
  trigger: SpeakTrigger,
  topic?: string,
): boolean {
  const decision = decideSpeak(session.floor, session.policy, trigger, {
    hasUnaddressedGap: pendingClassWideGap(session) !== undefined,
    topic,
    now: Date.now(),
  });

  if (!decision.allowed) {
    // Denials are surfaced to the teacher panel: "the agent tried to speak and
    // was blocked because you muted it" is exactly what makes the override
    // mechanism legible during a demo (§3.10).
    publishToTeachers(session.sessionId, {
      kind: 'echosphere:agent-blocked',
      reason: decision.reason,
      at: Date.now(),
    });
    return false;
  }

  session.floor = onAgentSpeechStart(session.floor, Date.now());
  grantSpeakPermit(session, decision.trigger);
  broadcastFloor(session);
  return true;
}

/**
 * How long a permit stays valid before the agent must actually BEGIN a turn.
 *
 * This only bounds the gap between being addressed and the engine's first
 * thinking/speaking transition — not how long she may then keep talking.
 * Once a turn starts, `authorizedTurnInProgress` takes over and this TTL is
 * irrelevant until the next turn. Long enough to cover ASR settle + LLM
 * generation latency; short enough that being addressed once does not
 * license an unrelated reply minutes later.
 */
const SPEAK_PERMIT_TTL_MS = 15_000;

export function grantSpeakPermit(
  session: ClassroomSession,
  reason: SpeakTrigger,
): void {
  session.speakPermit = { grantedAt: Date.now(), reason };
}

export function hasSpeakPermit(session: ClassroomSession): boolean {
  const permit = session.speakPermit;
  if (!permit) return false;
  return Date.now() - permit.grantedAt <= SPEAK_PERMIT_TTL_MS;
}

/**
 * Revokes everything that would let the agent speak: any standing invitation
 * to start a new turn, and authorization for a turn already under way. This
 * is the single function every override (mute, teacher barge-in, floor
 * closed) calls, so "the agent may not speak" always means the same thing.
 */
export function clearSpeakPermit(session: ClassroomSession): void {
  session.speakPermit = null;
  session.authorizedTurnInProgress = false;
}

/**
 * Enforcement for autonomous agent turns — the hard half of §3.3.
 *
 * The browser relays the engine's own state changes here. When the agent starts
 * thinking or speaking without a permit, it is interrupted at once. The prompt
 * asks her to stay quiet and usually succeeds; this is what makes it a rule
 * rather than a request, and it is the only thing that stops her answering a
 * teacher who was talking to the class.
 */
export async function handleAgentState(
  session: ClassroomSession,
  state: string,
): Promise<{ interrupted: boolean }> {
  const starting = state === 'thinking' || state === 'speaking';

  if (!starting) {
    // The turn has ended (silent/listening/idle). Authorization does not
    // carry over: the next turn, whatever prompts it, needs its own permit.
    session.authorizedTurnInProgress = false;
    if (session.restraintMeterState === 'speaking') {
      session.restraintMeterState = 'listening';
      publish(session.sessionId, {
        kind: 'echosphere:restraint-meter-changed',
        state: 'listening',
      });
    }
    return { interrupted: false };
  }

  // Already cleared to run. This is what makes authorization cover the whole
  // turn rather than a snapshot in time: once granted, nothing here can
  // revoke it mid-sentence — only an explicit action (mute, teacher barge-in,
  // floor closed) can, and each of those calls interruptAgent directly rather
  // than waiting for this function to notice on its next poll.
  if (session.authorizedTurnInProgress) return { interrupted: false };

  if (session.policy.muted || !hasSpeakPermit(session)) {
    await interruptAgent(session.sessionId).catch(() => undefined);
    releaseFloor(session);
    clearSpeakPermit(session);
    publishToTeachers(session.sessionId, {
      kind: 'echosphere:agent-blocked',
      reason: session.policy.muted ? 'AGENT_MUTED' : 'TEACHER_HOLDS_FLOOR',
      at: Date.now(),
    });
    return { interrupted: true };
  }

  // First valid check for this turn: authorize it for its full duration and
  // consume the standing permit, so a later, unrelated turn cannot ride on an
  // invitation meant for this one.
  session.authorizedTurnInProgress = true;
  session.speakPermit = null;
  return { interrupted: false };
}

export function releaseFloor(session: ClassroomSession): void {
  if (session.floor.state !== 'AGENT_SPEAKING') return;
  session.floor = onAgentSpeechEnd(session.floor, Date.now());
  session.activeQuestionerId = null;
  broadcastFloor(session);
}

// ─── Transcript ingestion (§3.4, §3.8, §3.9) ─────────────────────────────────

export interface IngestOptions {
  uid: string;
  text: string;
  /** Partial transcripts update the floor but are not logged or analysed. */
  isFinal: boolean;
  turnId?: number;
  language?: string;
  /** How sure the relaying client was about `uid` — see TranscriptSegment. */
  attributionConfidence?: number;
}

export async function ingestTranscript(
  session: ClassroomSession,
  { uid, text, isFinal, turnId, language, attributionConfidence }: IngestOptions,
): Promise<void> {
  const now = Date.now();

  // Every browser in the room sees the same RTM transcript stream, and any of
  // them may relay it, so (uid, turnId) identifies one utterance across relays.
  //
  // A repeat is not always noise: the toolkit re-emits a turn as more of it
  // arrives, so the same turnId legitimately comes back longer. Identical text
  // is dropped; a grown version replaces what is stored.
  if (isFinal && turnId !== undefined) {
    const outcome = upsertByTurn(session, uid, text, turnId);
    if (outcome === 'unchanged') return;
    if (outcome === 'updated') {
      // The stored segment was rewritten in place; re-publish so clients that
      // already rendered the fragment replace it rather than showing both.
      republishTurn(session, uid, turnId);
      return;
    }
  } else if (isFinal && isDuplicateSegment(session, uid, text, turnId)) {
    return;
  }

  if (uid === AGENT_UID) {
    if (isFinal) ingestAgentTurn(session, text, now, turnId, language);
    return;
  }

  // Instructions injected with `think` come back through the transcript stream
  // as though a human had said them, because the engine treats the injected
  // text as user input. They are orchestrator plumbing, not classroom speech:
  // logging them would put "[classroom:system] The teacher has asked you to…"
  // in front of the students and feed it to the gap detector as a confused
  // question.
  if (text.trimStart().startsWith(SYSTEM_PREFIX)) return;

  const participant = participantByUid(session, uid);
  if (!participant) return; // Unknown uid — not a registered classroom member.

  // Floor transition first, so a teacher's barge-in cuts the agent off before
  // any of the slower analysis below runs.
  if (participant.role === 'teacher') {
    const { floor, mustInterruptAgent } = onTeacherBargeIn(
      session.floor,
      participant.participantId,
      now,
    );
    session.floor = floor;
    // The teacher taking the floor revokes any outstanding permission, so a
    // reply that was about to start is stopped rather than merely queued.
    clearSpeakPermit(session);
    if (mustInterruptAgent) {
      await interruptAgent(session.sessionId).catch(() => undefined);
      session.activeQuestionerId = null;
    }
  } else {
    session.floor = onHumanSpeechStart(
      session.floor,
      'student',
      participant.participantId,
      now,
    );
  }
  broadcastFloor(session);

  if (!isFinal) return;

  // Athena's own TTS, played out of a shared speaker, can be picked up by
  // anyone's open mic and come back looking exactly like a human turn — most
  // plausibly in the common setup this project targets: a teacher and students
  // in the same room on laptop speakers rather than headphones. Stripped before
  // any of it is stored or analysed, so an echo can neither pollute the
  // transcript nor coincidentally contain her own name and make her answer
  // herself.
  const spokenText = stripSelfEcho(session, text);
  if (spokenText.length === 0) {
    broadcastFloor(session);
    return;
  }

  const segment = appendTranscript(session, {
    participantId: participant.participantId,
    uid,
    speaker: participant.role,
    text: spokenText,
    at: now,
    language,
    turnId,
    attributionConfidence,
  });
  publish(session.sessionId, { kind: 'echosphere:transcript', segment });

  session.floor = onHumanSpeechEnd(session.floor, now);

  // Whoever spoke, check whether they addressed the agent by name. This is
  // deliberately NOT gated to students: the teacher owns the room and must be
  // able to call on their own co-teacher exactly as freely as a student can.
  // `studentsMayInvoke` governs student self-service access to the floor —
  // it was being read as "can anyone address her", which meant a teacher
  // saying "Athena, can you hear me?" with the floor open still got no
  // response, because this whole check used to live inside a
  // role==='student'-only branch below.
  const addressed = isAddressedToAgent(spokenText, session.policy.wakePhrase);
  const studentInvocationBlocked =
    addressed && participant.role === 'student' && !session.policy.studentsMayInvoke;

  if (studentInvocationBlocked) {
    // Heard, understood, and deliberately not acted on. Surfaced so the
    // teacher can see that a student tried to reach her and decide whether to
    // open the floor.
    publishToTeachers(session.sessionId, {
      kind: 'echosphere:agent-blocked',
      reason: 'STUDENT_INVOCATION_DISABLED',
      at: now,
    });
  } else if (addressed) {
    session.activeQuestionerId = participant.participantId;
    // The engine will now answer on its own. This is the permit that makes that
    // answer legitimate; without it the enforcement path would cut her off.
    grantSpeakPermit(session, 'DIRECTLY_ADDRESSED');
    session.floor = onAddressedAgent(session.floor, participant.participantId, now);
  }

  if (participant.role !== 'student') {
    broadcastFloor(session);
    return;
  }

  // A student finished speaking. Two more things can follow beyond the
  // addressing check above: they answered an open quiz, or they said
  // something confused.
  maybeScoreVoiceAnswer(session, participant.participantId, spokenText);

  if (addressed) {
    const stats = (participant as { stats?: { questionsAsked: number } }).stats;
    if (stats) stats.questionsAsked += 1;
  }

  // Analysed without the wake phrase: "Hey Athena, I don't get denominators"
  // is confusion about denominators, not about Athena.
  recordConfusedQuestion(
    session,
    participant.participantId,
    addressed ? stripWakePhrase(spokenText, session.policy.wakePhrase) : spokenText,
  );
  broadcastFloor(session);

  // The ConvoAI engine answers a directly-addressed question on its own. The
  // orchestrator does not push it; it only needs the room state to be current
  // by the time that turn is generated, which the system prompt already carries.
}

/**
 * Handles one finished agent turn: strips the control payload, logs the spoken
 * remainder, and applies whatever the agent reported.
 */
function ingestAgentTurn(
  session: ClassroomSession,
  text: string,
  now: number,
  turnId: number | undefined,
  language: string | undefined,
): void {
  const { spoken, control } = parseAgentTurn(text);

  // Only the spoken half is stored. The control object never reached the room's
  // ears, so it must not appear in the transcript the room can read either.
  if (spoken.length > 0) {
    // Recorded so a later human turn that is actually this speech leaking back
    // in through an open mic can be recognised and stripped.
    rememberAgentUtterance(session, spoken);

    const segment = appendTranscript(session, {
      participantId: null,
      uid: AGENT_UID,
      speaker: 'agent',
      text: spoken,
      at: now,
      language,
      turnId,
    });
    publish(session.sessionId, { kind: 'echosphere:transcript', segment });
  }

  if (control) applyControl(session, control);

  // The permit is deliberately not cleared here. A turn's transcript arrives
  // after the next turn may already have been authorised, so clearing on
  // completion revoked permission for a reply that had only just been granted —
  // the teacher pressed Explain and the engine was cut off mid-sentence.
  // Expiry and explicit revocation (teacher takes the floor, floor closes,
  // mute) are what bound a permit instead.
  releaseFloor(session);
}

/** Applies a parsed control payload (§3.5 attribution, §3.6 quiz, §3.9 gap). */
function applyControl(
  session: ClassroomSession,
  control: CoTeacherControl,
): void {
  const roster = activeStudents(session).map((s) => ({
    participantId: s.participantId,
    displayName: s.displayName,
  }));

  if (control.to) {
    const id = matchParticipantByName(roster, control.to);
    if (id) session.activeQuestionerId = id;
  }

  if (control.gap) {
    const ids = control.gap.students
      .map((name) => matchParticipantByName(roster, name))
      .filter((id): id is string => id !== undefined);
    if (ids.length > 0) {
      recordReportedGap(session, control.gap.topic, ids);
    }
  }

  if (control.quiz) {
    const pending = takePendingQuiz(session);
    const quiz = recordQuizFromControl(
      session,
      control.quiz,
      pending?.origin ?? 'teacher',
      pending?.targetStudentIds ?? [],
    );
    broadcastQuiz(session, quiz);
  }
}

function takePendingQuiz(session: ClassroomSession) {
  const pending = session.pendingQuiz;
  session.pendingQuiz = null;
  if (!pending) return null;
  // A stale request means the agent is answering a much older prompt; treating
  // it as the trigger for this quiz would mis-target the card.
  if (Date.now() - pending.requestedAt > PENDING_QUIZ_TTL_MS) return null;
  return pending;
}

/**
 * Scores a spoken quiz answer (§3.6).
 *
 * Only counts when the utterance resolves to an actual option — otherwise every
 * sentence a student says while a quiz is open would be recorded as an attempt.
 */
function maybeScoreVoiceAnswer(
  session: ClassroomSession,
  participantId: string,
  text: string,
): void {
  const quiz = openQuizFor(session, participantId);
  if (!quiz?.options || quiz.options.length === 0) return;

  const resolved = normaliseAnswer(text, quiz);
  if (!quiz.options.includes(resolved)) return;

  submitQuizAnswer(session, quiz.quizId, participantId, resolved, 'voice');
}

/**
 * Polled from the server tick. Handles §3.3(b): a real silence gap plus an
 * unaddressed class-wide misconception is the only condition under which the
 * agent speaks unprompted.
 */
export async function considerSilenceInterjection(
  session: ClassroomSession,
): Promise<boolean> {
  if (session.endedAt !== null) return false;

  const gap = pendingClassWideGap(session);
  if (!gap) return false;

  if (!requestFloor(session, 'GAP_DETECTED_IN_SILENCE', gap.topic)) return false;

  markGapAddressed(session, gap.gapId);
  const ok = await think(
    session.sessionId,
    gapInterjectionDirective(gap.topic, gap.affectedStudentIds.length),
  );
  if (!ok) releaseFloor(session);
  return ok;
}

// ─── Teacher commands (§3.10) ────────────────────────────────────────────────

export interface CommandResult {
  ok: boolean;
  detail?: string;
}

export async function applyTeacherCommand(
  session: ClassroomSession,
  command: TeacherCommand,
  issuedBy: string,
): Promise<CommandResult> {
  publish(session.sessionId, {
    kind: 'echosphere:command',
    command,
    issuedBy,
  });

  switch (command.type) {
    case 'MUTE_AGENT': {
      session.policy.muted = true;
      // Muting must take effect mid-sentence, not at the next turn boundary —
      // this is the moment the plan calls out as worth demoing (§3.10).
      await interruptAgent(session.sessionId).catch(() => undefined);
      releaseFloor(session);
      session.restraintMeterState = 'listening';
      publish(session.sessionId, {
        kind: 'echosphere:restraint-meter-changed',
        state: 'listening',
      });
      broadcastPolicy(session);
      return { ok: true, detail: 'Agent muted and any in-flight speech stopped.' };
    }

    case 'RESUME_AGENT': {
      session.policy.muted = false;
      broadcastPolicy(session);
      return { ok: true };
    }

    case 'END_AGENT_TURN': {
      const stopped = await interruptAgent(session.sessionId);
      releaseFloor(session);
      return { ok: stopped, detail: stopped ? undefined : 'Agent was not speaking.' };
    }

    case 'FORCE_AGENT_SPEAK': {
      if (!requestFloor(session, 'TEACHER_INVOKED', command.topic)) {
        return { ok: false, detail: 'Blocked by agent policy (is the agent muted?).' };
      }
      session.activeQuestionerId = command.targetStudentId ?? null;
      const name = command.targetStudentId
        ? session.participants.get(command.targetStudentId)?.displayName
        : undefined;
      const ok = await think(
        session.sessionId,
        forceSpeakDirective(command.topic, name),
      );
      if (!ok) releaseFloor(session);
      return { ok, detail: ok ? undefined : 'Agent is not running.' };
    }

    case 'SET_STUDENT_INVOCATION': {
      session.policy.studentsMayInvoke = command.enabled;
      if (!command.enabled) {
        // Closing the floor revokes any permission already granted, so a reply
        // that was about to start does not slip through.
        clearSpeakPermit(session);
        await interruptAgent(session.sessionId).catch(() => undefined);
        releaseFloor(session);
      }
      broadcastPolicy(session);
      // The prompt states whether students may call her, so she stops offering.
      await pushInstructions(session);
      return { ok: true };
    }

    case 'ADJUST_VERBOSITY': {
      session.policy.verbosity = command.level;
      broadcastPolicy(session);
      // The verbosity rule lives in the system prompt, so the agent only obeys
      // it once the prompt is re-pushed.
      await pushInstructions(session);
      return { ok: true };
    }

    case 'DISABLE_TOPIC': {
      if (!session.policy.disabledTopics.includes(command.topic)) {
        session.policy.disabledTopics.push(command.topic);
      }
      broadcastPolicy(session);
      await pushInstructions(session);
      return { ok: true };
    }

    case 'ENABLE_TOPIC': {
      session.policy.disabledTopics = session.policy.disabledTopics.filter(
        (t) => t !== command.topic,
      );
      broadcastPolicy(session);
      await pushInstructions(session);
      return { ok: true };
    }

    case 'SET_PROFICIENCY': {
      const updated = setProficiency(
        session,
        command.studentId,
        command.proficiency as ProficiencyTag,
      );
      if (!updated) return { ok: false, detail: 'No such student.' };
      publish(session.sessionId, {
        kind: 'echosphere:proficiency-changed',
        participantId: updated.participantId,
        proficiency: updated.proficiency,
      });
      // §3.5 lives entirely in the roster block of the prompt, so a level change
      // has no effect on the agent until this lands.
      await pushInstructions(session);
      return { ok: true };
    }

    case 'START_QUIZ': {
      return startQuiz(session, command.topic, command.targetStudentIds, 'teacher');
    }

    case 'END_SESSION': {
      return { ok: true, detail: 'Handled by the session route.' };
    }

    default: {
      return { ok: false, detail: 'Unknown command.' };
    }
  }
}

// ─── Quiz delivery (§3.6) ────────────────────────────────────────────────────

/**
 * Asks the agent to pose a quiz. The question itself comes back on the control
 * channel a turn later, where `applyControl` turns it into a card.
 */
export async function startQuiz(
  session: ClassroomSession,
  topic: string,
  targetStudentIds: string[] | undefined,
  origin: 'teacher' | 'gap-detector',
): Promise<CommandResult> {
  if (!requestFloor(session, 'QUIZ_DELIVERY', topic)) {
    return { ok: false, detail: 'Blocked by agent policy (is the agent muted?).' };
  }

  const targets = targetStudentIds ?? [];
  const names = activeStudents(session)
    .filter((s) => targets.includes(s.participantId))
    .map((s) => s.displayName);

  session.pendingQuiz = {
    topic,
    targetStudentIds: targets,
    origin,
    requestedAt: Date.now(),
  };

  const ok = await think(session.sessionId, quizDirective(topic, names));
  if (!ok) {
    session.pendingQuiz = null;
    releaseFloor(session);
    return { ok: false, detail: 'Agent is not running.' };
  }
  return {
    ok: true,
    detail: 'Quiz requested; the card appears when Athena asks it.',
  };
}

export function submitQuizAnswer(
  session: ClassroomSession,
  quizId: string,
  participantId: string,
  answer: string,
  via: 'ui' | 'voice',
): CommandResult {
  const result = recordAnswer(session, quizId, participantId, answer, via);
  if ('error' in result) return { ok: false, detail: result.error };

  publishTo(session.sessionId, participantId, {
    kind: 'echosphere:quiz-result',
    quizId,
    participantId,
    correct: result.answer.correct,
  });
  publishToTeachers(session.sessionId, {
    kind: 'echosphere:quiz-result',
    quizId,
    participantId,
    correct: result.answer.correct,
  });

  if (!result.answer.correct) {
    recordWrongAnswer(session, result.quiz, participantId, result.answer.answer);
  }

  if (result.proficiencyChangedTo) {
    publish(session.sessionId, {
      kind: 'echosphere:proficiency-changed',
      participantId,
      proficiency: result.proficiencyChangedTo,
    });
    // An inferred level change matters to the agent as much as a teacher's
    // manual one, so the prompt is refreshed either way.
    void pushInstructions(session);
  }

  return { ok: true, detail: result.answer.correct ? 'correct' : 'incorrect' };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Records a turn that carries a turnId, replacing a shorter earlier version.
 *
 * Returns 'new' when nothing was stored for this turn yet (the caller carries on
 * and does the full ingest), 'unchanged' when the text is identical, and
 * 'updated' when an existing segment was rewritten.
 */
function upsertByTurn(
  session: ClassroomSession,
  uid: string,
  text: string,
  turnId: number,
): 'new' | 'unchanged' | 'updated' {
  const existing = findTurn(session, uid, turnId);
  if (!existing) return 'new';
  if (existing.text === text) return 'unchanged';

  // Guard against a late-arriving shorter fragment overwriting the full turn:
  // relays race, and the longest version is the complete one.
  if (text.length < existing.text.length) return 'unchanged';

  existing.text =
    existing.speaker === 'agent' ? parseAgentTurn(text).spoken : text;
  existing.at = Date.now();
  return 'updated';
}

function findTurn(
  session: ClassroomSession,
  uid: string,
  turnId: number,
): TranscriptSegment | undefined {
  // Matched on turnId plus which side spoke, not the exact uid. A turn_id is
  // shared by the agent and a human when the turn began with an injected
  // instruction, so the side has to be part of the key — but the human uid
  // itself must not be, or a turn whose attribution was revised would land as
  // a second row under a second name.
  const wantAgent = uid === AGENT_UID;
  for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
    const segment = session.transcript[i];
    if (!segment) continue;
    if (segment.turnId === turnId && (segment.speaker === 'agent') === wantAgent) {
      return segment;
    }
    // Turns arrive in order, so a short tail scan is enough.
    if (session.transcript.length - i > 40) break;
  }
  return undefined;
}

function republishTurn(
  session: ClassroomSession,
  uid: string,
  turnId: number,
): void {
  const segment = findTurn(session, uid, turnId);
  if (segment) {
    publish(session.sessionId, { kind: 'echosphere:transcript', segment });
  }
}

/**
 * True when this segment has already been recorded. Only the tail is scanned:
 * a duplicate relay arrives within moments of the original, and scanning the
 * whole transcript would make ingestion quadratic over a long lesson.
 */
function isDuplicateSegment(
  session: ClassroomSession,
  uid: string,
  text: string,
  turnId?: number,
): boolean {
  const now = Date.now();
  const tail = session.transcript.slice(-30);
  return tail.some((segment) => {
    if (segment.uid !== uid) return false;
    if (turnId !== undefined && segment.turnId !== undefined) {
      return segment.turnId === turnId;
    }
    // Without a turnId, identical text is the only signal — but people repeat
    // themselves, and a student who was not answered the first time will say
    // the same words again. Treating that as a duplicate makes the agent
    // permanently deaf to anyone who asks twice, so a repeat only counts as a
    // relay artefact when it lands within the window a relay race would.
    return segment.text === text && now - segment.at < DUPLICATE_WINDOW_MS;
  });
}

export function broadcastFloor(session: ClassroomSession): void {
  publish(session.sessionId, {
    kind: 'echosphere:floor-changed',
    floor: session.floor,
  });
}

export function broadcastPolicy(session: ClassroomSession): void {
  publish(session.sessionId, {
    kind: 'echosphere:policy-changed',
    policy: session.policy,
  });
}

export function broadcastParticipantJoined(
  session: ClassroomSession,
  participantId: string,
): void {
  const participant = session.participants.get(participantId);
  if (!participant) return;
  publish(session.sessionId, {
    kind: 'echosphere:participant-joined',
    participant: toPublicParticipant(participant),
  });
  // A new student is a new entry in the roster block, and the agent cannot
  // pitch an explanation at someone it does not know about.
  void pushInstructions(session);
}

export function segmentsFor(session: ClassroomSession): TranscriptSegment[] {
  return session.transcript;
}
