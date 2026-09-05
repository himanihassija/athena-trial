/**
 * Student catch-up answers. Private text — does not start a second Agora
 * ConvoAI agent on the classroom channel (that would speak over the lesson).
 * Grounds replies in transcript + lesson retrieval + workspace notes, then
 * `tryComplete` when a provider key exists.
 */

import type { CatchupMessage, CatchupReply, CatchupSource } from '@echosphere/shared-types';
import { tryComplete } from '../llm/complete.js';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { rollingTranscript } from '../state/sessionRegistry.js';

const MAX_THREAD = 24;
const MAX_SNIPPET = 280;

function isEducationalQuery(question: string, sessionTitle: string): { isEdu: boolean; reason?: string } {
  const lower = question.toLowerCase();
  
  // Explicit off-topic keywords
  const offTopicKeywords = [
    'fortnite', 'minecraft', 'roblox', 'gta', 'tiktok', 'instagram', 'youtube video',
    'celebrity', 'gossip', 'dating', 'crush', 'crypto', 'bitcoin', 'play a game',
    'tell me a joke about movie', 'who is your favorite actor', 'football score',
    'fifa', 'nba score', 'play music'
  ];

  for (const kw of offTopicKeywords) {
    if (lower.includes(kw)) {
      return {
        isEdu: false,
        reason: `I am your classroom AI co-teacher for "${sessionTitle}". I am here to help you with school subjects, math, science, homework, and what we covered today. Let's refocus on our lesson! What can I help you understand about ${sessionTitle}?`,
      };
    }
  }

  return { isEdu: true };
}

export async function answerCatchup(
  session: ClassroomSession,
  participantId: string,
  question: string,
): Promise<CatchupReply> {
  const text = question.trim();
  if (text.length === 0) {
    throw new Error('Ask a question about what you missed or your schoolwork.');
  }

  const participant = session.participants.get(participantId);
  if (!participant || participant.leftAt !== undefined) {
    throw new Error('Unknown participant');
  }

  const role = participant.role;
  const guardCheck = isEducationalQuery(text, session.title);
  const now = Date.now();
  const thread = session.catchupByParticipant.get(participantId) ?? [];
  const userTurn: CatchupMessage = { role: role === 'teacher' ? 'teacher' : 'student', text, at: now };

  if (!guardCheck.isEdu) {
    const athenaTurn: CatchupMessage = { role: 'athena', text: guardCheck.reason!, at: Date.now() };
    const history = [...thread, userTurn, athenaTurn].slice(-MAX_THREAD);
    session.catchupByParticipant.set(participantId, history);
    return { reply: guardCheck.reason!, sources: [], history };
  }

  const sources = gatherSources(session, text);

  const generated = await tryComplete(
    [
      {
        role: 'system',
        content: catchupSystemPrompt(session, participant.displayName, role === 'teacher' ? 'teacher' : 'student', sources),
      },
      ...thread.slice(-8).map((m) => ({
        role: (m.role === 'student' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text,
      })),
      { role: 'user', content: text },
    ],
    { temperature: 0.3, maxTokens: 450 },
  );

  const replyText = (generated ?? fallbackReply(text, sources, session.title)).trim();
  const athenaTurn: CatchupMessage = { role: 'athena', text: replyText, at: Date.now() };
  const history = [...thread, userTurn, athenaTurn].slice(-MAX_THREAD);
  session.catchupByParticipant.set(participantId, history);

  return { reply: replyText, sources, history };
}

export function catchupHistory(
  session: ClassroomSession,
  participantId: string,
): CatchupMessage[] {
  return session.catchupByParticipant.get(participantId) ?? [];
}

function gatherSources(session: ClassroomSession, query: string): CatchupSource[] {
  const sources: CatchupSource[] = [];

  const retrieved = session.lesson.retrieveSync(query, 3);
  for (const hit of retrieved) {
    sources.push({ kind: 'lesson', snippet: clip(hit.chunk.text) });
  }

  const recent = rollingTranscript(session, 30);
  const q = query.toLowerCase();
  const fromTranscript = recent
    .filter((seg) => {
      const hay = seg.text.toLowerCase();
      return q.split(/\s+/).some((w) => w.length > 3 && hay.includes(w));
    })
    .slice(-4);
  const transcriptPick = fromTranscript.length > 0 ? fromTranscript : recent.slice(-3);
  for (const seg of transcriptPick) {
    const who =
      seg.speaker === 'agent' ? 'Athena' : seg.speaker === 'teacher' ? 'Teacher' : 'Student';
    sources.push({ kind: 'transcript', snippet: clip(`${who}: ${seg.text}`) });
  }

  for (const note of (session.workspace?.notes ?? []).slice(-3)) {
    sources.push({ kind: 'workspace', snippet: clip(`${note.topic}: ${note.content}`) });
  }

  return sources.slice(0, 8);
}

function catchupSystemPrompt(
  session: ClassroomSession,
  userName: string,
  role: 'teacher' | 'student',
  sources: CatchupSource[],
): string {
  const sourceBlock =
    sources.length > 0
      ? sources.map((s) => `- [${s.kind}] ${s.snippet}`).join('\n')
      : '- (no specific classroom notes or spoken transcript for this specific topic)';

  if (role === 'teacher') {
    return `You are Athena, an elite, universal AI Co-Teacher & Pedagogical Assistant helping Teacher ${userName} in "${session.title}".
You possess comprehensive knowledge across all educational domains (Mathematics, STEM, Social Sciences, Languages, Literature, Pedagogy, Lesson Design, Classroom Management).

Your capabilities for the teacher:
1. Provide rich pedagogical suggestions, real-world analogies, classroom engagement strategies, and check-in questions.
2. Formulate diagnostic quizzes, homework prompts, and board challenge problems on any educational subject.
3. Answer any academic subject question with clear structure, accuracy, and teaching tips.
4. Ground responses in this session's ongoing records when relevant.

Live class record:
${sourceBlock}`;
  }

  return `You are Athena, an expert, encouraging AI Tutor & Educational Assistant helping student ${userName} in "${session.title}".
You have deep, comprehensive knowledge across ALL educational topics (Mathematics, Algebra, Geometry, Physics, Chemistry, Biology, History, Geography, Computer Science, Literature, Grammar, Study Skills, and Homework Help).

GUIDELINES:
1. Answer ANY and ALL educational questions thoroughly, accurately, and step-by-step with intuitive real-world analogies and examples.
2. If the student asks about what was said in the current class or what they missed, prioritize the classroom record below.
3. If the student asks about other educational subjects (e.g. "What is photosynthesis?", "How to solve 3x+7=22?", "Explain gravity", "Who wrote Romeo and Juliet?"), answer clearly and pedagogically!
4. Only decline non-educational entertainment/gossip (e.g., video games, celebrity gossip) and politely invite them to ask about school subjects.
5. Format formulas, numbered steps, and key concepts cleanly with bolding and bullet points.

Current class record:
${sourceBlock}`;
}

function fallbackReply(question: string, sources: CatchupSource[], sessionTitle: string): string {
  const lower = question.trim().toLowerCase();
  const recap = sources.find((s) => s.kind === 'transcript')?.snippet;
  const notes = sources.find((s) => s.kind === 'lesson')?.snippet;
  const workspaceNote = sources.find((s) => s.kind === 'workspace')?.snippet;

  // 0. Greetings & Friendly Check-ins
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy)\b/i.test(lower)) {
    return `Hello! 👋 I am Athena, your AI Educational Assistant for **"${sessionTitle}"**.\n\nI can help you:\n• Understand tricky concepts with real-world analogies\n• Walk through problems step-by-step\n• Test your knowledge with practice questions\n• Catch up on anything you missed in class\n\nWhat would you like to explore or solve together?`;
  }

  if (/\b(who are you|what can you do|help me|capabilities)\b/i.test(lower)) {
    return `I am **Athena**, your pedagogical co-teacher and universal learning assistant! 🎓\n\nHere is how I can assist:\n1. 📐 **Math & Science**: Step-by-step equations, proofs, and physical principles.\n2. 💡 **Socratic Guidance**: Hints and analogies without spoiling answers directly.\n3. 📝 **Classroom Recaps**: Summaries of what was spoken or written on the board.\n4. 🧪 **Practice Exercises**: Quick check-ins to build mastery.\n\nAsk me any question to get started!`;
  }

  // 1. Current Classroom Missed / Recap queries
  if (/\b(miss|missed|catch up|recap|what happened|so far|what did teacher say|class summary)\b/.test(lower)) {
    const parts = [
      recap ? `**From live classroom audio:**\n${recap}` : null,
      notes ? `**From lesson notes (${sessionTitle}):**\n${notes}` : null,
      workspaceNote ? `**From shared workspace:**\n${workspaceNote}` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      return `Here is a quick catch-up on what was just covered in **${sessionTitle}**:\n\n${parts.join('\n\n')}\n\n*Feel free to ask me to explain any specific step, give an analogy, or test your understanding with a practice problem!*`;
    }
    return `In **${sessionTitle}**, we are focusing on core problem-solving concepts. As soon as the teacher or Athena speaks, I track every moment and recap for you here!`;
  }

  // 2. Science topics
  if (lower.includes('photosynthesis')) {
    return `🌿 **Photosynthesis** is the biological process by which plants use sunlight, water ($H_2O$), and carbon dioxide ($CO_2$) to create oxygen ($O_2$) and energy in the form of sugar (glucose).\n\n**Chemical Formula:**\n$$6CO_2 + 6H_2O + \\text{Light} \\rightarrow C_6H_{12}O_6 + 6O_2$$\n\n• **Where it happens:** Inside the chloroplasts (using the green pigment chlorophyll).\n• **Why it matters:** It produces the oxygen we breathe and forms the base of almost all food chains!`;
  }

  if (lower.includes('gravity') || lower.includes('gravitation')) {
    return `🌌 **Gravity** is the universal force of attraction between all objects that have mass.\n\n• **Newton's Law of Universal Gravitation:** The attraction force increases with mass and decreases with the square of distance ($F = G \\frac{m_1 m_2}{r^2}$).\n• **On Earth:** Gravity pulls objects toward Earth's center at an acceleration of approximately $9.8\\text{ m/s}^2$.\n• **Everyday Analogy:** Think of a heavy bowling ball sitting on a trampoline — it creates a dip that pulls lighter marbles toward it!`;
  }

  if (lower.includes('atom') || lower.includes('electron') || lower.includes('proton')) {
    return `⚛️ **The Structure of an Atom:**\nAn atom is the basic building block of all matter, composed of three subatomic particles:\n1. **Protons:** Positively charged particles in the central nucleus.\n2. **Neutrons:** Neutrally charged particles in the nucleus.\n3. **Electrons:** Negatively charged particles orbiting the nucleus in energy shells.\n\n• *Analogy:* The nucleus is like the sun, and electrons orbit like planets!`;
  }

  if (lower.includes('water cycle')) {
    return `💧 **The Water Cycle (Hydrologic Cycle):**\nContinuous movement of water on, above, and below Earth's surface:\n1. **Evaporation:** Sun heats liquid water, turning it into vapor.\n2. **Transpiration:** Water vapor released by plants.\n3. **Condensation:** Vapor cools and forms clouds.\n4. **Precipitation:** Water falls as rain, snow, or hail.\n5. **Collection:** Water flows back into lakes, rivers, and oceans.`;
  }

  // 3. Mathematics & Algebra
  if (lower.includes('pythagor') || lower.includes('triangle') || lower.includes('hypotenuse')) {
    return `📐 **The Pythagorean Theorem ($a^2 + b^2 = c^2$):**\nIn any **right-angled triangle**, the square of the longest side (hypotenuse $c$) equals the sum of the squares of the other two sides ($a$ and $b$).\n\n**Example:**\nIf $a = 3$ and $b = 4$:\n$$3^2 + 4^2 = 9 + 16 = 25$$\n$$c = \\sqrt{25} = 5$$ (Classic 3-4-5 right triangle!)`;
  }

  if (lower.includes('fraction') || lower.includes('lcd') || lower.includes('denominator') || lower.includes('numerator')) {
    return `🍕 **Fractions & Lowest Common Denominator (LCD):**\n• **Numerator (Top):** How many parts you have.\n• **Denominator (Bottom):** Total equal parts the whole is divided into.\n\n**Rule for Adding/Subtracting:**\n1. Find the Least Common Multiple of both denominators.\n2. Convert fractions to have that common denominator.\n3. Add/subtract ONLY the numerators (keep denominator the same).\n\n*Example:* $\\frac{1}{3} + \\frac{1}{4} = \\frac{4}{12} + \\frac{3}{12} = \\frac{7}{12}$!`;
  }

  if (lower.includes('solve') || lower.includes('equation') || lower.includes('algebra')) {
    return `🔢 **Algebraic Problem Solving Method:**\nTo solve an equation for variable $x$:\n1. **Isolate the variable term** by performing inverse operations (addition/subtraction) on both sides.\n2. **Isolate the variable itself** by multiplying or dividing both sides.\n3. **Check your solution** by substituting $x$ back into the original equation.\n\n*Example:* $2x + 6 = 14 \\implies 2x = 8 \\implies x = 4$.`;
  }

  // 4. Grounded in this lesson or general explanation
  if (notes && lower.length > 5) {
    return `**Key Educational Insight (${sessionTitle}):**\n${notes}\n\n*Would you like me to walk you through a step-by-step example or practice question?*`;
  }
  if (recap && lower.length > 5) {
    return `**From class discussions:**\n${recap}\n\n*Let me know what subject or formula you would like help with next!*`;
  }

  return `📚 **Athena Educational Assistant:**\nI am ready to help you with **any academic subject** (Mathematics, Science, History, Grammar, Physics, Chemistry, Biology, and Homework Problem-Solving) as well as questions on **${sessionTitle}**!\n\nWhat specific concept, question, or equation would you like us to solve together?`;
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_SNIPPET) return t;
  return `${t.slice(0, MAX_SNIPPET - 1)}…`;
}


