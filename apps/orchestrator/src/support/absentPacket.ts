/**
 * The Absent-Student Packet Generator.
 *
 * Automatically produces a structured post-class catch-up packet containing:
 * 1. Executive Lesson Summary
 * 2. Key Takeaways & Milestones
 * 3. Timeline Audio Highlights & Key Quotes
 * 4. Snapshot of all Shared Workspace sticky notes and doubts
 * 5. Flagged Misconceptions & Clarifications
 * 6. 3-Question Diagnostic Quick-Check Quiz
 * 7. Teacher-Approved Targeted Reading Recommendations
 */

import type {
  AbsentStudentPacket,
  QuizQuestion,
  TargetedReadingItem,
} from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { rankedGaps } from '../gaps/gapDetector.js';
import { tryComplete } from '../llm/complete.js';
import { getWorkspaceState } from '../workspace/workspaceManager.js';
import { getTargetedReadings } from './targetedReading.js';

export async function generateAbsentStudentPacket(
  session: ClassroomSession,
): Promise<AbsentStudentPacket> {
  const gaps = rankedGaps(session);
  const workspace = getWorkspaceState(session);
  const durationMinutes = Math.max(
    1,
    Math.round(((session.endedAt ?? Date.now()) - session.createdAt) / 60000),
  );

  // Collect key timeline moments from the transcript
  const transcript = session.transcript;
  const timelineHighlights = transcript
    .filter((t) => t.text.trim().length > 20)
    .slice(-12)
    .map((t, idx) => ({
      timestamp: t.at,
      speaker: t.speaker,
      text: t.text,
      significance:
        idx === 0
          ? 'Introduction of Core Concept'
          : idx % 3 === 0
          ? 'Teacher Explanation & Guided Example'
          : 'Key Discussion Point',
    }));

  // Diagnostic Quiz from lesson questions or gap topics
  const diagnosticQuiz: Array<Omit<QuizQuestion, 'targetStudentIds'>> = [
    ...session.quizzes.values(),
  ].slice(0, 4).map(({ targetStudentIds, ...q }) => q);

  // If no quizzes were asked during class, synthesize a diagnostic quiz
  if (diagnosticQuiz.length === 0) {
    diagnosticQuiz.push({
      quizId: 'diag-1',
      sessionId: session.sessionId,
      topic: 'Unlike Fractions Addition',
      question: 'Why must fractions have a common denominator before being added?',
      options: [
        'To ensure you are adding pieces of the same size',
        'Because numerators can only multiply',
        'It is just an arbitrary mathematical rule',
        'Fractions cannot be added otherwise',
      ],
      correctAnswer: 'To ensure you are adding pieces of the same size',
      difficulty: 'easy',
      origin: 'teacher',
      createdAt: Date.now(),
      deadline: Date.now() + 60000,
    });
  }

  // Flagged Concepts & Explanations
  const flaggedConcepts = gaps.map((g) => ({
    concept: g.topic,
    explanation: `Core principle in ${g.topic}: ensure foundational definitions are mastered before proceeding to multi-step problem solving.`,
    commonMisconception: g.description,
  }));

  // Generate Executive Summary narrative via LLM if available, otherwise template
  const transcriptSnippet = transcript
    .slice(-15)
    .map((t) => `${t.speaker}: ${t.text}`)
    .join('\n');

  const prompt = `You are Athena, an expert AI co-teacher summarizing a live classroom session titled "${session.title}" for a student who missed the class.
Class Transcript Excerpt:
${transcriptSnippet || 'No transcript recorded.'}

Detected Learning Gaps: ${gaps.map((g) => `${g.topic} (${g.description})`).join(', ') || 'None'}

Please write:
1. A clear, encouraging, 2-3 paragraph executive summary explaining what was taught, the main intuitions, and real-world relevance.
2. 4 bulleted key takeaways.

Format response as JSON:
{
  "summary": "...",
  "takeaways": ["...", "...", "..."]
}`;

  let executiveSummary = `In this session on ${session.title}, we explored core problem-solving strategies and conceptual foundations. Key misconceptions around representation and common denominators were clarified with live examples.`;
  let keyTakeaways = [
    `Mastered the core intuition behind ${session.title}.`,
    'Identified common pitfalls when combining terms with differing units.',
    'Reviewed step-by-step methods for verifying intermediate results.',
    'Completed diagnostic checks and interactive peer questions.',
  ];

  try {
    const raw = await tryComplete([{ role: 'user', content: prompt }], {
      temperature: 0.3,
      maxTokens: 500,
    });
    if (raw) {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (parsed.summary) executiveSummary = parsed.summary;
      if (Array.isArray(parsed.takeaways) && parsed.takeaways.length > 0) {
        keyTakeaways = parsed.takeaways;
      }
    }
  } catch {
    // Fall back to template
  }

  const targetedReadings = getTargetedReadings(session);

  return {
    sessionId: session.sessionId,
    lessonTitle: session.title,
    generatedAt: Date.now(),
    durationMinutes,
    executiveSummary,
    keyTakeaways,
    timelineHighlights,
    stickyNotesSnapshot: workspace.notes,
    flaggedConcepts,
    diagnosticQuiz,
    targetedReadings,
  };
}

import type { AbsentDispatchPayload, AbsentDispatchResult, DispatchChannel } from '@echosphere/shared-types';
import { randomUUID } from 'node:crypto';

export async function dispatchAbsentPacket(
  session: ClassroomSession,
  payload: AbsentDispatchPayload,
): Promise<AbsentDispatchResult> {
  const packet = await generateAbsentStudentPacket(session);
  const studentName = payload.studentName || 'Student';
  const receiptId = `dispatch-${randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const channels: DispatchChannel[] =
    payload.channel === 'both' ? ['whatsapp', 'email'] : [payload.channel];

  // 1. Compose Rich WhatsApp Digest
  const takeawaysList = packet.keyTakeaways.map((t) => `• ${t}`).join('\n');
  const quizPreview = payload.includeQuiz && packet.diagnosticQuiz.length > 0
    ? `\n\n🎯 *Diagnostic Quick-Check (${packet.diagnosticQuiz.length} Questions):*\n1. ${packet.diagnosticQuiz[0]?.question ?? ''}`
    : '';

  const parentNote = payload.parentNote ? `\n\n📝 *Teacher Note:* ${payload.parentNote}` : '';

  const whatsappMessageText = `📚 *Athena EchoSphere — Lesson Catch-up Packet*
━━━━━━━━━━━━━━━━━━━━━━
Hi ${studentName}! Here is everything covered in today's lesson:
📖 *Lesson:* ${session.title} (${packet.durationMinutes} mins)

✨ *Executive Summary:*
${packet.executiveSummary.slice(0, 320)}...

🔑 *Key Takeaways:*
${takeawaysList}${quizPreview}${parentNote}

🌐 *View Full Interactive Digital Packet:*
https://echosphere.classroom/session/${session.sessionId}/catchup`;

  const cleanPhone = (payload.recipientPhone || '').replace(/[^\d+]/g, '');
  const encodedMsg = encodeURIComponent(whatsappMessageText);
  const whatsappDeepLink = cleanPhone
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`
    : `https://api.whatsapp.com/send?text=${encodedMsg}`;

  // 2. Compose Rich HTML Email Digest
  const emailSubject = `[Athena Co-Teacher] Catch-up Notes & Diagnostic for ${session.title} (${studentName})`;
  const emailBodyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px; }
.card { background: #ffffff; max-width: 620px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
.header { background: #0f172a; color: #ffffff; padding: 20px 24px; }
.header h1 { margin: 0 0 4px 0; font-size: 20px; }
.content { padding: 24px; }
.highlight { background: #f1f5f9; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px; }
.quiz { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 16px 0; }
.btn { display: inline-block; background: #0f172a; color: #ffffff !important; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; margin-top: 12px; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>Athena EchoSphere · Classroom Catch-Up</h1>
    <p style="margin: 0; opacity: 0.8; font-size: 13px;">Lesson: <strong>${session.title}</strong> · Duration: ${packet.durationMinutes} mins</p>
  </div>
  <div class="content">
    <p>Dear ${studentName} & Family,</p>
    <p>Here is your personalized AI Co-Teacher packet summarizing today's live lecture so you do not miss a beat.</p>
    
    <div class="highlight">
      <strong>Executive Summary:</strong>
      <p style="margin: 4px 0 0 0;">${packet.executiveSummary}</p>
    </div>

    <h3>Key Takeaways & Milestones:</h3>
    <ul>
      ${packet.keyTakeaways.map((t) => `<li>${t}</li>`).join('')}
    </ul>

    ${payload.parentNote ? `<p><strong>Teacher Note:</strong> ${payload.parentNote}</p>` : ''}

    ${
      payload.includeQuiz && packet.diagnosticQuiz.length > 0 && packet.diagnosticQuiz[0]
        ? `<div class="quiz">
            <h4 style="margin: 0 0 8px 0;">🎯 Quick Diagnostic Check:</h4>
            <p style="margin: 0 0 8px 0;"><strong>Q1: ${packet.diagnosticQuiz[0].question}</strong></p>
            <ul>${(packet.diagnosticQuiz[0].options ?? []).map((opt) => `<li>${opt}</li>`).join('')}</ul>
          </div>`
        : ''
    }

    <p style="text-align: center;">
      <a href="https://echosphere.classroom/session/${session.sessionId}/catchup" class="btn">Open Full Interactive Packet & Quizzes</a>
    </p>
  </div>
</div>
</body>
</html>
  `.trim();

  return {
    ok: true,
    sessionId: session.sessionId,
    dispatchedAt: now,
    channels,
    recipientEmail: payload.recipientEmail,
    recipientPhone: payload.recipientPhone,
    whatsappDeepLink,
    whatsappMessageText,
    emailSubject,
    emailBodyHtml,
    deliveryReceiptId: receiptId,
  };
}

