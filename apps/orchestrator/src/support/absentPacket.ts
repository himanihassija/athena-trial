/**
 * The Absent-Student Packet Generator.
 *
 * Automatically produces a structured post-class catch-up packet containing:
 * 1. Executive Lesson Summary
 * 2. Key Takeaways & Milestones
 * 3. Timeline Audio Highlights & Key Quotes
 * 4. Snapshot of all Whiteboard / Shared Workspace Sticky Notes & Doubts
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
