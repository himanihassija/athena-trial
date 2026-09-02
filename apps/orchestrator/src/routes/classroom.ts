/**
 * Classroom HTTP surface.
 *
 * Route groups map to the plan's feature sections:
 *   sessions / join / events  -> §3.1, §3.2, §3.8
 *   transcript                -> §3.4, §3.9
 *   command                   -> §3.10
 *   lesson                    -> §3.4
 *   quiz                      -> §3.6
 *   gaps / report             -> §3.9
 *
 * Authorisation is deliberately thin (a participantId identifies the caller),
 * matching the plan's "lightweight join screen is enough for a hackathon demo".
 * The one rule enforced everywhere is that teacher-only routes check the role
 * from the session registry rather than trusting the request.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ClassroomEvent, RoomState } from '@echosphere/shared-types';
import {
  applyTeacherCommand,
  broadcastParticipantJoined,
  grantSpeakPermit,
  handleAgentState,
  ingestTranscript,
  startQuiz,
  submitQuizAnswer,
} from '../classroomController.js';
import {
  agentStatus,
  pushInstructions,
  startAgent,
  stopAgent,
} from '../agent/agentLifecycle.js';
import { rankedGaps } from '../gaps/gapDetector.js';
import { generateReport } from '../report/summary.js';
import { persistSessionEnd } from '../report/persist.js';
import { closeRoom, publish, subscribe } from '../state/eventBus.js';
import { answerCatchup, catchupHistory } from '../catchup/answer.js';
import {
  getWorkspaceState,
  addStickyNote,
  updateStickyNote,
  voteStickyNote,
  resolveStickyNote,
  deleteStickyNote,
} from '../workspace/workspaceManager.js';
import { generateAbsentStudentPacket } from '../support/absentPacket.js';
import {
  getTargetedReadings,
  approveReading,
  rejectReading,
} from '../support/targetedReading.js';
import { getCatchupSlots, bookCatchupSlot } from '../support/catchupSlots.js';
import { translateText } from '../support/multilingual.js';
import { think } from '../agent/agentLifecycle.js';
import {
  activeParticipants,
  addParticipant,
  AGENT_UID,
  createSession,
  endSession,
  getSession,
  isTeacher,
  listSessions,
  removeParticipant,
  toPublicParticipant,
  type ClassroomSession,
} from '../state/sessionRegistry.js';
import { mintTokens } from './tokens.js';
import { config } from '../config.js';
import {
  UNLIKE_FRACTIONS_TITLE,
  seedUnlikeFractionsLesson,
} from '../lesson/demoUnlikeFractions.js';

const joinSchema = z.object({
  displayName: z.string().min(1).max(60),
  role: z.enum(['teacher', 'student']),
  preferredLanguage: z.string().max(20).optional(),
});

const transcriptSchema = z.object({
  uid: z.string(),
  text: z.string(),
  isFinal: z.boolean().default(true),
  turnId: z.number().optional(),
  language: z.string().optional(),
  attributionConfidence: z.number().min(0).max(1).optional(),
});

const commandSchema = z.object({
  participantId: z.string(),
  command: z.discriminatedUnion('type', [
    z.object({ type: z.literal('MUTE_AGENT') }),
    z.object({ type: z.literal('RESUME_AGENT') }),
    z.object({ type: z.literal('END_AGENT_TURN') }),
    z.object({
      type: z.literal('FORCE_AGENT_SPEAK'),
      topic: z.string(),
      targetStudentId: z.string().optional(),
    }),
    z.object({
      type: z.literal('ADJUST_VERBOSITY'),
      level: z.enum(['terse', 'normal', 'detailed']),
    }),
    z.object({
      type: z.literal('SET_STUDENT_INVOCATION'),
      enabled: z.boolean(),
    }),
    z.object({ type: z.literal('DISABLE_TOPIC'), topic: z.string() }),
    z.object({ type: z.literal('ENABLE_TOPIC'), topic: z.string() }),
    z.object({
      type: z.literal('SET_PROFICIENCY'),
      studentId: z.string(),
      proficiency: z.enum(['beginner', 'intermediate', 'advanced']),
    }),
    z.object({
      type: z.literal('START_QUIZ'),
      topic: z.string(),
      targetStudentIds: z.array(z.string()).optional(),
    }),
    z.object({ type: z.literal('END_SESSION') }),
  ]),
});

export async function classroomRoutes(app: FastifyInstance): Promise<void> {
  // ── Sessions (§3.1) ───────────────────────────────────────────────────────

  app.post('/api/sessions', async (request, reply) => {
    const body = z
      .object({
        title: z.string().min(1).max(140).optional(),
        seed: z.enum(['unlike-fractions']).optional(),
      })
      .parse(request.body ?? {});
    const title =
      body.title ??
      (body.seed === 'unlike-fractions'
        ? UNLIKE_FRACTIONS_TITLE
        : 'Untitled lesson');
    const session = createSession(title);
    if (body.seed === 'unlike-fractions') {
      seedUnlikeFractionsLesson(session.lesson);
    }
    return reply.code(201).send(publicSession(session));
  });

  app.get('/api/sessions', async () =>
    listSessions().map(publicSession),
  );

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(roomState(session));
  });

  // ── Join (§3.2, §3.8) ─────────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/join', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    if (session.endedAt !== null) {
      return reply.code(409).send({ error: 'This session has already ended' });
    }

    const body = joinSchema.parse(request.body);

    if (body.role === 'teacher') {
      const existingTeacher = activeParticipants(session).find(
        (p) => p.role === 'teacher',
      );
      if (existingTeacher) {
        return reply
          .code(409)
          .send({ error: 'This classroom already has a teacher' });
      }
    }

    const participant = addParticipant(session, body);
    const tokens = mintTokens(session.channel, participant.uid);

    broadcastParticipantJoined(session, participant.participantId);

    return reply.code(201).send({
      participantId: participant.participantId,
      uid: participant.uid,
      channel: session.channel,
      rtcToken: tokens.rtcToken,
      rtmToken: tokens.rtmToken,
      appId: config.agoraAppId,
      agentUid: AGENT_UID,
      role: participant.role,
      sessionId: session.sessionId,
    });
  });

  app.post('/api/sessions/:sessionId/leave', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.body);
    removeParticipant(session, participantId);
    publish(session.sessionId, {
      kind: 'echosphere:participant-left',
      participantId,
    });
    return reply.send({ ok: true });
  });

  // ── Agent lifecycle (§3.1) ────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/agent/start', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.body);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can start the agent' });
    }

    try {
      const agentId = await startAgent(session);
      session.agentId = agentId;
      // The greeting is spoken the moment the agent joins, and it exists
      // because the teacher asked for the agent. Without a permit the
      // enforcement path treats it as an uninvited turn and cuts it off after
      // the first two words.
      grantSpeakPermit(session, 'TEACHER_INVOKED');
      publish(session.sessionId, { kind: 'echosphere:room-state', state: roomState(session) });
      return reply.send({ agentId, state: 'RUNNING' });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to start agent');
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : 'Failed to start agent' });
    }
  });

  app.post('/api/sessions/:sessionId/agent/stop', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    await stopAgent(session.sessionId);
    session.agentId = null;
    return reply.send({ ok: true });
  });

  app.get('/api/sessions/:sessionId/agent', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send((await agentStatus(session.sessionId)) ?? { agentId: null, status: 'idle' });
  });

  app.post('/api/sessions/:sessionId/catchup', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, text } = z
      .object({
        participantId: z.string(),
        text: z.string().min(1).max(800),
      })
      .parse(request.body);
    try {
      const result = await answerCatchup(session, participantId, text);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Catch-up failed';
      const code = message === 'Catch-up chat is for students' ? 403 : 400;
      if (message === 'Unknown participant') {
        return reply.code(403).send({ error: message });
      }
      return reply.code(code).send({ error: message });
    }
  });

  app.get('/api/sessions/:sessionId/catchup', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    const participant = session.participants.get(participantId);
    if (!participant || participant.leftAt !== undefined) {
      return reply.code(403).send({ error: 'Unknown participant' });
    }
    if (participant.role !== 'student') {
      return reply.code(403).send({ error: 'Catch-up chat is for students' });
    }
    return reply.send({ history: catchupHistory(session, participantId) });
  });

  // ── Control path: SSE (§2) ────────────────────────────────────────────────

  app.get('/api/sessions/:sessionId/events', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    const participant = session.participants.get(participantId);
    if (!participant) {
      return reply.code(403).send({ error: 'Unknown participant' });
    }

    // Writing to `reply.raw` bypasses the Fastify reply object, and with it the
    // headers @fastify/cors would have attached — so an EventSource is refused
    // by the browser while every ordinary route on the same server works. The
    // CORS headers have to be set explicitly here.
    const origin = request.headers.origin;
    const allowedOrigin =
      origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0];

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx and similar proxies buffer by default, which would batch the
      // control path into useless bursts.
      'X-Accel-Buffering': 'no',
      ...(allowedOrigin
        ? {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Credentials': 'true',
            Vary: 'Origin',
          }
        : {}),
    });

    const send = (event: ClassroomEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = subscribe(session.sessionId, {
      subscriberId: `${participantId}-${Date.now()}`,
      participantId,
      role: participant.role,
      send,
      close: () => reply.raw.end(),
    });

    // The joining client needs the whole room, not just future deltas.
    send({ kind: 'echosphere:room-state', state: roomState(session) });

    // Proxies drop idle connections; a comment line keeps it warm without
    // appearing as an event to the client.
    const heartbeat = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 20_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return reply;
  });

  // ── Transcript ingestion (§3.4, §3.8, §3.9) ───────────────────────────────

  app.post('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = transcriptSchema.parse(request.body);
    await ingestTranscript(session, body);
    return reply.send({ ok: true });
  });

  app.get('/api/sessions/:sessionId/transcript', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(session.transcript);
  });

  /**
   * The engine's own state, relayed from the browser (§3.3 enforcement).
   *
   * ConvoAI decides to answer without consulting anyone, so this is the only
   * moment the orchestrator learns a turn has begun. If that turn has no
   * permit, it is interrupted here.
   */
  app.post('/api/sessions/:sessionId/agent-state', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { state } = z.object({ state: z.string() }).parse(request.body);
    const result = await handleAgentState(session, state);
    return reply.send(result);
  });

  // ── Teacher commands (§3.10) ──────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/command', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, command } = commandSchema.parse(request.body);

    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can issue commands' });
    }

    if (command.type === 'END_SESSION') {
      await stopAgent(session.sessionId);
      endSession(session.sessionId);
      publish(session.sessionId, {
        kind: 'echosphere:session-ended',
        sessionId: session.sessionId,
      });
      // Fire-and-forget: a database hiccup (or no DATABASE_URL at all) must
      // not stop the teacher's "end lesson" action from completing.
      void persistSessionEnd(session).catch((err) =>
        app.log.error({ err }, 'failed to persist session on END_SESSION'),
      );
      return reply.send({ ok: true });
    }

    const result = await applyTeacherCommand(session, command, participantId);
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  // ── Lesson material (§3.4) ────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/lesson', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        participantId: z.string(),
        source: z.string().min(1).max(200),
        text: z.string().min(1),
        topics: z.array(z.string()).optional(),
      })
      .parse(request.body);

    if (!isTeacher(session, body.participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can upload lesson material' });
    }

    const chunks = session.lesson.addDocument(body.source, body.text, body.topics);
    // The material lives in the agent's system prompt, so it has no effect
    // until the prompt is re-pushed.
    const applied = await pushInstructions(session);
    return reply.code(201).send({
      source: body.source,
      chunks: chunks.length,
      appliedToAgent: applied,
      topics: session.lesson.topics(),
    });
  });

  app.get('/api/sessions/:sessionId/lesson', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send({
      chunks: session.lesson.chunks.length,
      topics: session.lesson.topics(),
      sources: [...new Set(session.lesson.chunks.map((c) => c.source))],
    });
  });

  // ── Quizzes (§3.6) ────────────────────────────────────────────────────────

  app.post('/api/sessions/:sessionId/quiz', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        participantId: z.string(),
        topic: z.string().min(1),
        targetStudentIds: z.array(z.string()).optional(),
      })
      .parse(request.body);

    if (!isTeacher(session, body.participantId)) {
      return reply.code(403).send({ error: 'Only the teacher can start a quiz' });
    }

    const result = await startQuiz(session, body.topic, body.targetStudentIds, 'teacher');
    return reply.code(result.ok ? 201 : 409).send(result);
  });

  app.post('/api/sessions/:sessionId/quiz/:quizId/answer', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { quizId } = request.params as { quizId: string };
    const body = z
      .object({
        participantId: z.string(),
        answer: z.string(),
        via: z.enum(['ui', 'voice']).default('ui'),
      })
      .parse(request.body);

    const result = submitQuizAnswer(
      session,
      quizId,
      body.participantId,
      body.answer,
      body.via,
    );
    return reply.code(result.ok ? 200 : 409).send(result);
  });

  // ── Gaps and report (§3.9) ────────────────────────────────────────────────

  app.get('/api/sessions/:sessionId/gaps', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Gap data is teacher-only' });
    }
    return reply.send(rankedGaps(session));
  });

  // ─── Workspace & Sticky Notes (Live Miro Integration) ─────────────────────

  app.get('/api/sessions/:sessionId/workspace', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(getWorkspaceState(session));
  });

  app.post('/api/sessions/:sessionId/workspace/notes', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        topic: z.string().default(''),
        content: z.string().min(1),
        suggestedAnswer: z.string().optional(),
        category: z
          .enum(['held-back-doubt', 'student-question', 'core-concept', 'teacher-insight', 'key-takeaway'])
          .optional(),
        color: z.enum(['yellow', 'coral', 'cyan', 'purple', 'green', 'amber']).optional(),
        authorName: z.string().optional(),
        authorRole: z.enum(['athena', 'teacher', 'student']).optional(),
        authorParticipantId: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .parse(request.body);

    const note = addStickyNote(session, body);
    return reply.code(201).send(note);
  });

  app.patch('/api/sessions/:sessionId/workspace/notes/:noteId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const patch = request.body as Record<string, unknown>;
    const updated = updateStickyNote(session, noteId, patch);
    if (!updated) return reply.code(404).send({ error: 'Sticky note not found' });
    return reply.send(updated);
  });

  app.post('/api/sessions/:sessionId/workspace/notes/:noteId/vote', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.body);
    const updated = voteStickyNote(session, noteId, participantId);
    if (!updated) return reply.code(404).send({ error: 'Sticky note not found' });
    return reply.send(updated);
  });

  app.post('/api/sessions/:sessionId/workspace/notes/:noteId/resolve', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const { status } = z
      .object({ status: z.enum(['pending', 'addressed', 'resolved', 'archived']) })
      .parse(request.body);
    const updated = resolveStickyNote(session, noteId, status);
    if (!updated) return reply.code(404).send({ error: 'Sticky note not found' });
    return reply.send(updated);
  });

  app.delete('/api/sessions/:sessionId/workspace/notes/:noteId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const deleted = deleteStickyNote(session, noteId);
    return reply.send({ ok: deleted });
  });

  app.post('/api/sessions/:sessionId/workspace/notes/:noteId/explain', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { noteId } = request.params as { noteId: string };
    const ws = getWorkspaceState(session);
    const note = ws.notes.find((n) => n.id === noteId);
    if (!note) return reply.code(404).send({ error: 'Sticky note not found' });

    // Instruct Athena to address this note out loud to the class
    grantSpeakPermit(session, 'TEACHER_INVOKED');
    const promptDirective = `The class wants to address a question from the shared board: "${note.content}". Please give a 2-3 sentence clear, encouraging explanation and invite a student to verify.`;
    void think(session.sessionId, promptDirective);

    // Mark as addressed
    resolveStickyNote(session, noteId, 'addressed');
    return reply.send({ ok: true, note });
  });

  // ─── Nobody Left Behind: Absent Student Packet ─────────────────────────────

  app.get('/api/sessions/:sessionId/absent-packet', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const packet = await generateAbsentStudentPacket(session);
    return reply.send(packet);
  });

  // ─── Nobody Left Behind: Targeted Reading (Teacher-Approved) ───────────────

  app.get('/api/sessions/:sessionId/targeted-readings', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(getTargetedReadings(session));
  });

  app.post('/api/sessions/:sessionId/targeted-readings/:readingId/approve', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { readingId } = request.params as { readingId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.body);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can approve reading recommendations' });
    }
    const teacher = session.participants.get(participantId);
    const approved = approveReading(session, readingId, teacher?.displayName ?? 'Teacher');
    if (!approved) return reply.code(404).send({ error: 'Reading recommendation not found' });
    return reply.send(approved);
  });

  app.post('/api/sessions/:sessionId/targeted-readings/:readingId/reject', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { readingId } = request.params as { readingId: string };
    const { participantId } = z.object({ participantId: z.string() }).parse(request.body);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'Only teachers can reject reading recommendations' });
    }
    const ok = rejectReading(session, readingId);
    return reply.send({ ok });
  });

  // ─── Nobody Left Behind: Catch-up Sessions from Real Availability ──────────

  app.get('/api/sessions/:sessionId/catchup-slots', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(getCatchupSlots(session));
  });

  app.post('/api/sessions/:sessionId/catchup-slots/book', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z
      .object({
        slotId: z.string(),
        studentId: z.string(),
        studentName: z.string(),
        topic: z.string(),
        notes: z.string().optional(),
        language: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']).default('en'),
      })
      .parse(request.body);

    try {
      const booked = bookCatchupSlot(session, body);
      return reply.send(booked);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ─── Hand-Raise Control Plane Signal ───────────────────────────────────────

  app.post('/api/sessions/:sessionId/hand-raise', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId, raised } = z
      .object({ participantId: z.string(), raised: z.boolean() })
      .parse(request.body);

    const participant = session.participants.get(participantId);
    if (!participant) return reply.code(404).send({ error: 'Participant not found' });

    participant.handRaised = raised;
    if (raised) {
      session.raisedHands.add(participantId);
      publish(session.sessionId, {
        kind: 'echosphere:hand-raised',
        participantId,
        displayName: participant.displayName,
        at: Date.now(),
      });
    } else {
      session.raisedHands.delete(participantId);
      publish(session.sessionId, {
        kind: 'echosphere:hand-lowered',
        participantId,
      });
    }

    return reply.send({ ok: true, raisedHands: Array.from(session.raisedHands) });
  });

  // ─── Multilingual Real-Time Translation ────────────────────────────────────

  app.post('/api/sessions/:sessionId/translate', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { text, targetLanguage, sourceLanguage } = z
      .object({
        text: z.string().min(1),
        targetLanguage: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']),
        sourceLanguage: z.enum(['en', 'hi', 'es', 'fr', 'de', 'ta', 'te']).optional(),
      })
      .parse(request.body);

    const translated = await translateText(text, targetLanguage, sourceLanguage);
    return reply.send({ original: text, translated, language: targetLanguage });
  });

  app.get('/api/sessions/:sessionId/report', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { participantId } = z
      .object({ participantId: z.string() })
      .parse(request.query);
    if (!isTeacher(session, participantId)) {
      return reply.code(403).send({ error: 'The report is teacher-only' });
    }
    const report = await generateReport(session);
    return reply.send(report);
  });

  app.delete('/api/sessions/:sessionId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    await stopAgent(session.sessionId);
    endSession(session.sessionId);
    closeRoom(session.sessionId);
    // See the END_SESSION handler above: fire-and-forget, same reasoning.
    void persistSessionEnd(session).catch((err) =>
      app.log.error({ err }, 'failed to persist session on DELETE'),
    );
    return reply.send({ ok: true });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): ClassroomSession | undefined {
  const { sessionId } = request.params as { sessionId?: string };
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) {
    reply.code(404).send({ error: 'No such classroom session' });
    return undefined;
  }
  return session;
}

function publicSession(session: ClassroomSession) {
  return {
    sessionId: session.sessionId,
    channel: session.channel,
    title: session.title,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    participantCount: activeParticipants(session).length,
    agentId: session.agentId,
  };
}

function roomState(session: ClassroomSession): RoomState {
  return {
    sessionId: session.sessionId,
    channel: session.channel,
    title: session.title,
    participants: activeParticipants(session).map(toPublicParticipant),
    floor: session.floor,
    policy: session.policy,
    agentId: session.agentId,
    agentUid: AGENT_UID,
    startedAt: session.createdAt,
    endedAt: session.endedAt,
    suppressedInterventions: session.suppressedInterventions,
    restraintMeterState: session.restraintMeterState,
    workspace: getWorkspaceState(session),
    targetedReadings: getTargetedReadings(session),
    catchupSlots: getCatchupSlots(session),
    raisedHands: Array.from(session.raisedHands),
  };
}

