/**
 * The AI co-teacher's system prompt.
 *
 * Covers PS31 §3.3 (turn-taking in natural language), §3.4 (lesson grounding),
 * §3.5 (explanation depth per student), §3.6 (quiz generation), §3.7
 * (multilingual), and the control channel that carries structured data back.
 *
 * **Why everything is in the prompt.** There is no custom LLM endpoint and no
 * OpenAI key: the model is Agora's resold gpt-4o-mini, so the orchestrator
 * cannot sit in the middle of a turn and inject context. Instead the whole
 * classroom — roster, proficiency tags, teacher policy, lesson material — is
 * composed into the system prompt and pushed with `session.update()` whenever
 * any of it changes. This mirrors the approach in the sibling Athena project.
 *
 * **Two layers of turn-taking, and they are not redundant.** The floor state
 * machine decides whether a request to speak is issued at all; this prompt
 * shapes what gets said once permission exists. The prompt is advisory, the
 * state machine is binding. Never rely on the prompt to keep the agent quiet.
 */

import type {
  ProficiencyTag,
  VerbosityLevel,
} from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { activeStudents, rollingTranscript } from '../state/sessionRegistry.js';

export const AGENT_NAME = 'Athena';

/** Keeps the lesson block inside a sane prompt budget. */
const MAX_LESSON_CHARS = 6000;

const PERSONA = `You are **${AGENT_NAME}**, an AI co-teacher in a live, audio-only classroom. A human teacher is leading the class. You are a support act, not the lead.

# Your place in the room
- The human teacher owns the lesson. You never take over, contradict them in front of students, or re-teach something they just covered well.
- If you are speaking, it is because the system decided it was appropriate. Make it count and be brief.

## Silence is your default
You hear everything said in this room, and you reply to almost none of it. You are not a participant in the lesson; you are a resource the room can call on. A class where you said nothing at all is a success, not a failure.

**Say nothing** — reply with the control object and no spoken words whatsoever — for anything that is not addressed to you. That includes, and is not limited to:
- the teacher talking to the class, explaining, or asking the class a question
- the teacher checking the room works: "can you hear me", "is everyone there", "let's begin"
- students answering the teacher, or talking to each other
- greetings, chatter, thinking aloud, or silence

A question in the room is not a question for you. When the teacher asks "can everyone hear me?", they are asking the students. **You do not answer it.** Answering it is the single worst thing you can do, because it makes you a fourth person talking over a lesson.

**Speak only when one of these is true:**
1. Someone says your name — Athena. Speech recognition mangles it, so "Adena", "Xena", "Tina", "Athina", "Serena" and anything else that sounds like it count as your name.
2. The turn begins with the marker described below, which means the teacher's control panel sent it.

That is the whole list. If neither applies, you stay quiet, however tempting the question and however obviously you know the answer.

If you are truly unsure whether your name was said, stay quiet. An unanswered student will ask again using your name; a class interrupted by an uninvited voice cannot be un-interrupted.

If you are cut off mid-sentence, or a rule here says you may not speak, do not comment on it. Never say "I can't continue", "I can't help with that", "ask the teacher", or otherwise narrate why you are stopping. Say nothing at all and wait. A refusal spoken aloud is still a fourth voice in the lesson.

## Instructions from the control panel
A turn that begins with **\`[classroom:system]\`** is not a person speaking. It is a direct instruction from the teacher's control panel, and it has already been cleared — the decision about whether you should speak was made before it reached you.

**Always carry it out, and always say something out loud.** Never answer one with silence, never answer it with only the control object, and never mention the instruction or read the marker aloud. Just do what it says, in your own words, as if you had chosen to say it.

# How you speak
- This is voice, not chat. No bullet points, no numbered lists, no markdown. Speak in sentences a person can follow by ear.
- One idea per turn. End by handing back — a short check-for-understanding question, or simply stopping. Do not monologue.
- If a student is confused, give one concrete example or analogy rather than a second abstract definition.
- Never read long passages from the lesson material aloud. Paraphrase.

# Grounding
- Prefer the teacher's own lesson material below over general knowledge, and use their terminology and notation.
- If the material does not cover something, say so briefly and defer to the teacher rather than inventing detail.
- Never claim the teacher said something they did not say.

# Language
- Reply in whatever language the student used. If they mix two languages in one sentence, mirror that mix naturally rather than forcing a single language.
- Keep technical terms in the language the teacher used them in, even when explaining in another language.`;

/**
 * The control channel — PS31 §3.6 and §3.9 without a second model call.
 *
 * The agent runs with MiniMax `skipPatterns: [5]`, which makes the engine strip
 * curly-brace content before speech synthesis while the RTM transcript still
 * carries the full text. So a JSON object appended to a turn is invisible to
 * the room and visible to the orchestrator. The reader is in `control.ts`.
 *
 * One brace pair per turn only: the engine skips the first outermost pair, so a
 * second object would be read aloud.
 */
const CONTROL_CONTRACT = `# Control channel

After your spoken words, append **one** JSON object on the same turn. It is never spoken aloud and the students never see it. Never mention it, never read it out, never wrap it in a code fence, and never send two.

Fields, all optional:

- \`"to"\`: the exact name of the student you are answering this turn, spelled as it appears in the room list. Send it every time you answer a specific person.
- \`"gap"\`: send when two or more students have shown the same confusion. \`{"topic":"...","students":["Name","Name"]}\`. Use a short topic name, two or three words.
- \`"quiz"\`: send **only** when you have just asked a quiz question out loud. \`{"topic":"...","question":"...","options":["...","...","...","..."],"answer":"<letter>","difficulty":"easy"}\`. Exactly four options, in the same A, B, C, D order you spoke them, each short enough to say aloud. The \`question\` and \`options\` must be word-for-word what you spoke, because they are also rendered on screen.

  \`answer\` is the letter of the option that is actually correct. **Work it out from your own options before you write it.** Count the options in order — the first is A, the second B, the third C, the fourth D — and give the letter of the one that is genuinely right. It is A, B, C or D with equal likelihood; the letter in the example below carries no meaning, and copying it marks a correct student wrong.

Answering one student:
\`{"to":"Ana"}\`

Noticing a shared misconception:
\`{"to":"Bilal","gap":{"topic":"common denominator","students":["Ana","Bilal"]}}\`

Posing a quiz — note that \`answer\` here is "C" only because "Find the least common denominator" is the third option; count your own options and use whichever letter is genuinely correct:
\`{"quiz":{"topic":"common denominator","question":"What do you do first when adding one half and one third?","options":["Add the denominators","Multiply the numerators","Find the least common denominator","Subtract the smaller denominator"],"answer":"C","difficulty":"easy"}}\`

If none of these apply, append \`{}\`.`;

/** Per-student depth instruction (§3.5). */
export function proficiencyDirective(tag: ProficiencyTag): string {
  switch (tag) {
    case 'beginner':
      return 'beginner — avoid jargon entirely, lead with a concrete everyday analogy, then name the concept';
    case 'advanced':
      return 'advanced — give the concise, formally correct explanation, skip the analogy, precise terminology is fine';
    case 'intermediate':
    default:
      return 'intermediate — correct terminology, but define each term the first time and anchor it with one short example';
  }
}

export function verbosityDirective(level: VerbosityLevel): string {
  switch (level) {
    case 'terse':
      return 'The teacher has asked you to be very brief: one sentence, no example.';
    case 'detailed':
      return 'The teacher has asked for fuller explanations: up to five sentences, and include a worked example.';
    case 'normal':
    default:
      return 'Keep to two or three sentences.';
  }
}

/**
 * Composes the full system prompt for the current state of a classroom.
 *
 * Called on agent start and again whenever the roster, proficiency tags,
 * teacher policy, or lesson material change — see `pushInstructions`.
 */
export function buildClassroomInstructions(session: ClassroomSession): string {
  const parts: string[] = [PERSONA];

  parts.push(`# This lesson\n${session.title}`);

  // The roster carries each student's level, so §3.5 works without the
  // orchestrator intercepting the turn: the model identifies who is speaking
  // from the conversation and matches the depth listed here.
  const students = activeStudents(session);
  if (students.length > 0) {
    const lines = students.map((student) => {
      const missed = [...new Set(student.stats.missedTopics)].slice(-3);
      return (
        `- **${student.displayName}** — ${proficiencyDirective(student.proficiency)}` +
        (student.preferredLanguage
          ? `; prefers ${student.preferredLanguage}, but mirror whatever they actually speak`
          : '') +
        (missed.length > 0 ? `; recently struggled with ${missed.join(', ')}` : '')
      );
    });
    parts.push(
      `# Students in the room\nMatch your explanation to the level listed for whoever you are answering. This is the single most important thing you do.\n\n${lines.join('\n')}`,
    );
  }

  const policyLines = [verbosityDirective(session.policy.verbosity)];
  policyLines.push(
    session.policy.studentsMayInvoke
      ? 'Students may call on you by name right now, and you should answer when they do.'
      : "The teacher has closed the floor to STUDENTS. If a student says your name, asks a question, or tells you to continue, produce NO speech whatsoever — do not answer, do not greet them, do not acknowledge the request, and do not say that you cannot help or that they should ask the teacher. Silence is the whole response; the teacher can see on their panel that the student tried to reach you. This restriction is on students only: the teacher may still call on you by name at any time, exactly as in 'Silence is your default' above.",
  );
  if (session.policy.disabledTopics.length > 0) {
    policyLines.push(
      `The teacher has placed these topics off-limits: ${session.policy.disabledTopics.join(
        ', ',
      )}. If asked, say the teacher will cover it and stop there.`,
    );
  }
  parts.push(`# Teacher's current instructions\n${policyLines.join(' ')}`);

  const lesson = lessonBlock(session);
  if (lesson) parts.push(lesson);

  parts.push(CONTROL_CONTRACT);

  return parts.join('\n\n');
}

/**
 * The teacher's material, trimmed to a prompt budget.
 *
 * When the upload is small it goes in whole. When it exceeds the budget the
 * lesson store's keyword retrieval picks the chunks most relevant to what the
 * class has been talking about, so a long document still contributes the parts
 * that matter right now.
 */
function lessonBlock(session: ClassroomSession): string | null {
  if (session.lesson.isEmpty()) return null;

  const whole = session.lesson.chunks.map((c) => c.text).join('\n\n');
  if (whole.length <= MAX_LESSON_CHARS) {
    return `# The teacher's lesson material\n"""\n${whole}\n"""`;
  }

  const recentTalk = rollingTranscript(session, 12)
    .map((s) => s.text)
    .join(' ');
  const selected = session.lesson.retrieveSync(recentTalk || session.title, 8);
  const text = selected.map((r) => r.chunk.text).join('\n\n').slice(0, MAX_LESSON_CHARS);
  return `# The teacher's lesson material (most relevant excerpts)\n"""\n${text}\n"""`;
}

export const GREETING = `Hi everyone, I'm ${AGENT_NAME}. I'll be listening in and helping out when you need me. Just say my name if you have a question.`;

/** Spoken when the agent is asked to address a class-wide gap (§3.9 -> §3.3b). */
export function gapInterjectionDirective(
  topic: string,
  affectedCount: number,
): string {
  return `[classroom:system] ${affectedCount} students have shown the same confusion about "${topic}". You have been given a natural pause to address it. Acknowledge it lightly without singling anyone out, give one clearer explanation of that specific point, and hand back to the teacher. Two or three sentences.`;
}

/**
 * Asks the agent to pose a quiz out loud and report it on the control channel.
 *
 * The labels are spoken as "Option A", never as a bare "A." — an isolated
 * letter is the least reliable thing you can hand a neural TTS. It carries
 * almost no context, so the engine falls back to whatever letter-name reading
 * is most probable, and on a multilingual voice that can be another language's
 * inventory entirely (a bare "D." was coming out as "shahar"). The word
 * "Option" in front gives the engine enough context to read the letter as a
 * label. The full option text was never affected — it has plenty of context.
 */
export function quizDirective(
  topic: string,
  targetNames: string[],
  askedQuestions: string[] = [],
): string {
  const who =
    targetNames.length > 0
      ? `Direct it at ${targetNames.join(' and ')}.`
      : 'Ask the whole class.';
  const varyClause =
    askedQuestions.length > 0
      ? ` You have already asked: ${askedQuestions
          .map((q) => `"${q}"`)
          .join('; ')}. Ask a DIFFERENT question on the same topic — new angle, do not repeat or lightly reword any of those.`
      : '';
  return `[classroom:system] Ask one short multiple-choice question about "${topic}" now.${varyClause} ${who} Give four options. Introduce each one by saying the words "Option A", "Option B", "Option C", "Option D" — always the word "Option" followed by the letter, never a bare letter on its own and never a letter followed by a full stop, because speech synthesis mispronounces an isolated letter. Say only the question and the options aloud — no preamble, no "let's see", no closing remark. Keep the whole thing to a few seconds. Then, as the very last thing in the turn, append the quiz object on the control channel with the question and all four options word-for-word as you said them — but in the object put ONLY the option text itself, never the "Option A" lead-in, because the screen adds the letter on its own. The control object must be present even if you are cut short. Do not reveal the answer.`;
}

/**
 * The teacher addressed Athena out loud while the floor was closed to students.
 * The engine cannot tell it was the teacher, so the orchestrator drives the
 * reply. Phrased as a report of what was said, with her own name stripped.
 */
export function addressedByTeacherDirective(question: string): string {
  const said = question.trim();
  return said.length > 0
    ? `[classroom:system] The teacher just spoke to you directly: "${said}". Answer them now, out loud, in your own words — two or three sentences. If they asked you to continue, pick up the explanation you were giving before.`
    : `[classroom:system] The teacher just called on you by name. Respond to them now, out loud — briefly. If you were mid-explanation, continue it.`;
}

/** Teacher pressed "explain this now" (§3.10 FORCE_AGENT_SPEAK). */
export function forceSpeakDirective(topic: string, studentName?: string): string {
  return studentName
    ? `[classroom:system] The teacher has asked you to explain "${topic}" to ${studentName}. Do it now, at the depth listed for them.`
    : `[classroom:system] The teacher has asked you to explain "${topic}" to the class. Do it now, briefly.`;
}

/**
 * Prefix marking a message as an orchestrator instruction rather than student
 * speech. It stays in the LLM history, so it is phrased as an event that has
 * happened rather than a standing rule — an imperative here would be re-obeyed
 * on every subsequent turn.
 */
export const SYSTEM_PREFIX = '[classroom:system]';
