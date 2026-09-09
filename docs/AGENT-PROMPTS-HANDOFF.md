# Athena — Agent Prompts and Configuration Handoff

Everything that governs what Athena says, when she says it, and why she sometimes says
nothing. Written to be read by someone taking this over cold.

Companion to [HANDOFF.md](./HANDOFF.md), which covers the wider system. This file covers
only the agent: the prompt, the ConvoAI configuration, and the failure modes both have.

---

## 0. What is broken right now, and the one-line fix

**Symptom:** the teacher presses "Explain", the UI shows Athena speaking, no audio is
heard, and nothing appears in the transcript.

**Cause:** `LLM_MODEL` was changed to `gpt-5-mini`. That is a *reasoning* model.
Reasoning tokens are charged against the completion budget but never appear in the
returned content, so with `max_completion_tokens: 700` the model can spend the entire
budget thinking and return an empty string. The engine still opens and closes a turn —
which is why the UI shows "speaking" — but there are no words to synthesise and no text
to transcribe.

This is confirmed, not inferred. The live agent's own history for session `6650` shows:

```
turns: 7
  assistant -> "Hi everyone,I'm Athena. ..."      <- the greeting (engine-injected)
  assistant -> 'Hi everyone,I'                    <- truncated mid-word
  user      -> '[classroom:system] ... explain "explain fractions" ...'
  user      -> '[classroom:system] ... explain "explain fractions" ...'
  user      -> '[classroom:system] ... explain "explain fractions" ...'
  user      -> '[classroom:system] ... explain "explain fractions" ...'
  user      -> '[classroom:system] ... explain "explain fractions" ...'
```

Five explain directives reached the model. It produced **zero** assistant turns in
response to any of them, and the one turn it did produce was cut off mid-word. That is
the signature of a completion budget exhausted by reasoning.

`HANDOFF.md` already documented this trap under "Reasoning models can return an empty
string". It was not applied when the model was switched.

### Fix, in order of preference

**Fastest — no code change, no redeploy.** On the Render orchestrator set:

```
LLM_MODEL=gpt-4.1-mini
```

then restart the service and send Athena out and back in. `gpt-4.1-mini` is not a
reasoning model, is meaningfully better than `gpt-4o-mini` at instruction following, and
takes the `max_tokens` parameter set that `llmParams()` already sends for non-GPT-5
models. Nothing in the code needs to change.

**If you want to stay on `gpt-5-mini`,** the completion cap has to cover reasoning as
well as output. In `apps/orchestrator/src/agent/agentLifecycle.ts`, `llmParams()`:

```ts
return resellerModel().startsWith('gpt-5')
  ? { max_completion_tokens: 700 }   // too small — reasoning eats it
  : { max_tokens: 700, temperature: 0.4, top_p: 0.9 };
```

Raise `max_completion_tokens` to something like `3000`, and if the SDK accepts it, add
`reasoning_effort: 'minimal'`. Verify against the live API before trusting it — a wrong
value here fails silently, which is what makes it expensive.

### The four models available

Agora resells exactly these, and the list is enforced by `RESELLER_MODELS` in
`agentLifecycle.ts`. Anything else silently falls back to `gpt-4o-mini`.

| Model | Reasoning? | Parameter set | Notes |
|---|---|---|---|
| `gpt-4o-mini` | no | `max_tokens` | Original. Weakest at instruction following. |
| `gpt-4.1-mini` | no | `max_tokens` | **Recommended.** Better instruction following, no reasoning trap. |
| `gpt-5-mini` | **yes** | `max_completion_tokens` | Strongest, but needs a much larger cap. |
| `gpt-5-nano` | **yes** | `max_completion_tokens` | Smaller than what you already run. |

---

## 1. Where the prompt lives

All of it is in **`apps/orchestrator/src/agent/prompt.ts`** (379 lines). Nothing else
writes prompt text. The file exports one builder and a set of directive helpers.

```
prompt.ts
├── PERSONA                     the static system prompt (identity + rules)
├── CONTROL_CONTRACT            the JSON side-channel spec
├── buildClassroomInstructions  assembles the full system prompt per session
├── getGreetingForLanguage      the opening line
└── *Directive functions        one-off instructions injected mid-lesson
```

`buildClassroomInstructions(session)` is called on agent start and again on every
`pushInstructions()` — that is, whenever the roster, policy, language or lesson material
changes. It concatenates, in order:

1. `PERSONA` — the fixed rules
2. a language block, **only if** the lesson language is not English
3. `# This lesson` — the title
4. `# Students in the room` — the roster with each student's proficiency and recent
   struggles, so explanation depth can be matched per student without the orchestrator
   intercepting turns
5. `# Teacher's current instructions` — verbosity, whether students may invoke her,
   blocked topics
6. `# The teacher's lesson material` — uploaded notes, trimmed to `MAX_LESSON_CHARS`
   (6000); beyond that it retrieves the 8 most relevant chunks against recent talk
7. `CONTROL_CONTRACT` — the JSON channel spec

---

## 2. The restraint design, and why it is fragile

The central idea: **Athena is silent by default.** A lesson where she says nothing is a
success. She speaks only when (a) someone says her name, or (b) the turn begins with
`[classroom:system]`, which means the teacher's control panel sent it.

This is enforced in three independent places, which is worth knowing because a bug can
live in any of them:

| Layer | Where | What it does |
|---|---|---|
| Prompt | `PERSONA` → "Silence is your default" | Asks her not to speak. Advisory. |
| Floor machine | `classroomController.ts` | Interrupts an un-permitted turn via a REST call. Authoritative but slow (~3s). |
| Engine VAD | `agentLifecycle.ts` `turnDetection` | Decides when a human turn starts and ends. |

### How "stay quiet" is expressed

A silent turn is **an empty control object and nothing else**:

```
{}
```

MiniMax TTS runs with `skipPatterns: [5]`, which strips curly-brace content before
speech synthesis. So a turn containing only `{}` is inaudible. The braces are also
stripped from the RTM transcript the browser relays, so a silent turn leaves no
transcript entry either.

**This is the sharp edge.** "Speaking but silent" and "correctly staying quiet" look
identical from outside — the agent state goes to `speaking` in both cases. If Athena
appears to speak and you hear nothing, you cannot tell from the UI whether she chose
silence or the model returned empty. Check the agent history endpoint:

```
GET /api/sessions/:sessionId/agent/history
```

An assistant turn containing `{}` means restraint working. **No assistant turn at all**
means the model returned nothing — a real fault.

### The "Silence." bug, for context

Before the current prompt, `gpt-4o-mini` responded to the silence instruction by saying
the word *"Silence."* aloud, then copying itself from history for the rest of the lesson.
The prompt now (a) shows the silent turn literally as `{}`, (b) forbids placeholder words
by name, and (c) tells her to ignore such turns in her own history.

Be aware this correction pushes hard toward silence. If Athena becomes *too* quiet — not
answering when directly addressed — that section is the first place to look, and the
`[classroom:system]` rule at line 81 ("**Always carry it out, and always say something
out loud**") is what is supposed to override it.

---

## 3. The control channel

After her spoken words, Athena appends **one** JSON object. `skipPatterns: [5]` hides it
from the room; `agent/control.ts` reads it. Only the first outermost brace pair is
skipped, so **two objects in one turn means the second is read aloud.**

| Field | Purpose |
|---|---|
| `to` | Name of the student being answered |
| `gap` | `{"topic":"...","students":[...]}` — two or more students showed the same confusion |
| `board` | `{"action":"write","text":"..."}` — one short line for the shared board |
| `illustrate` | `{"illustrate":{"topic":"..."}}` — triggers an Excalidraw diagram |
| `quiz` | Question, four options, answer letter, difficulty |

Two known traps, both already documented in `HANDOFF.md` and both still live:

- **The quiz answer key is generated, not computed.** The model states a letter and
  nothing server-side validates it. It once anchored on a hardcoded `"B"` in the example
  and marked correct students wrong. The durable fix is to have her state the correct
  option's *text* rather than its letter.
- **`illustrate` must never be the whole turn.** A turn with a diagram and no speech
  leaves the room staring at a picture nobody introduced.

---

## 4. Agent configuration

All in `agentLifecycle.ts`, in `startAgent()`. Every setting here differs deliberately
from the official quickstart.

| Setting | Value | Why |
|---|---|---|
| `remoteUids` | `['*']` | Hears every participant. Quickstart uses one requester. |
| `idleTimeout` | `0` | A class can sit silent through written work; she must still be there. |
| `skipPatterns` | `[5]` | Opens the brace control channel. |
| `end_of_speech` | `semantic`, `pause_state_enabled` | Was a flat 2000 ms silence timer, which charged every turn a 2 s wait. |
| `interruption` | `keywords` | Only her name or "stop" cuts her off, not classroom noise. |
| `sal` | `recognition` | Engine-side voice separation. `SAL_MODE=off` disables. |

### Settings I am least confident about

Two of these were changed this session on my reading of the SDK type definitions rather
than the vendor documentation, and both should be re-checked against the official ConvoAI
docs before being trusted:

- **`interruption: { mode: 'keywords' }`** — I documented it in code as governing
  barge-in only. The SDK deprecation note on the older `start_of_speech.mode: 'keywords'`
  says to "use `interruption.mode = 'keywords'` instead", which suggests it may also gate
  when a user turn *starts*. Live testing showed plain speech without the wake word is
  still transcribed, so it does not appear to gate transcription — but the semantics are
  not confirmed from documentation.
- **`sal: { sal_mode: 'recognition' }`** — a voiceprint mode, running with no voiceprints
  enrolled. The documented behaviour is that it "identifies different speakers and
  suppresses other background voices". What it does with zero enrolled speakers is not
  documented. `SAL_MODE=off` is the escape hatch and costs nothing to try.

Set `SAL_MODE=off` and revert `interruption` to `{ enable: true }` if you want to return
to known-good ConvoAI defaults.

---

## 5. Directives — the `[classroom:system]` channel

The orchestrator makes Athena speak by injecting an instruction through
`agentSession.think()`. The engine treats the injected text as *user* input, so it appears
in her history as a `user` turn prefixed `[classroom:system]`.

| Function | Fired by |
|---|---|
| `addressedByTeacherDirective` | Teacher says her name |
| `forceSpeakDirective` | "Explain" button |
| `quizDirective` | "Quiz" button |
| `gapInterjectionDirective` | Gap detector |

Two things matter here:

1. `think()` must pass `on_listening_action: 'interrupt'`. Listening is her resting
   state, so omitting it means the teacher presses "Explain" and nothing happens.
2. These turns are stripped from the classroom transcript before storage — otherwise
   `[classroom:system] The teacher has asked you to…` would appear in front of students.

---

## 6. How to test properly

The harness is `apps/web/scripts/speech.e2e.ts`. It drives a real Chromium with a WAV
file as the microphone and asserts on what actually reaches the orchestrator.

```bash
pnpm --filter @echosphere/orchestrator dev     # :8787
pnpm --filter @echosphere/web dev              # :3000
pnpm --filter @echosphere/web test:speech apps/web/.tmp/speech-fixture.wav
pnpm --filter @echosphere/web test:speech apps/web/.tmp/speech-nowake.wav
```

**Both fixtures matter, and this is the lesson from this session.** The original fixture
says *"Hey Athena. Can you explain what a common denominator is?"* — it contains the wake
word. For a long time it was the only fixture, so the suite could not distinguish "plain
speech is transcribed" from "only speech containing her name is transcribed", and it could
not see a bug where she narrated her silence. `speech-nowake.wav` says *"The weather is
nice today. Can everyone hear me at the back of the room?"* and exercises the silent path.

Regenerate a fixture on macOS:

```bash
say -o out.aiff "your sentence here"
afconvert -f WAVE -d LEI16@48000 -c 1 out.aiff fixture.wav
```

Full gate before shipping:

```bash
pnpm -r typecheck
pnpm --filter @echosphere/orchestrator test
pnpm --filter @echosphere/web verify
```

None of these catch a model returning empty. **Only the speech harness or the agent
history endpoint will.**

---

## 7. Debugging checklist

When Athena misbehaves, work down this list — it goes from cheapest to most expensive and
each step rules out a whole layer.

1. **`GET /health`** — confirms which model is actually running.
2. **`GET /api/sessions`** — is the session live, how many participants.
3. **`GET /api/sessions/:id/agent/history`** — *the highest-value endpoint.* Shows what
   the model actually received and produced. `user` turns prefixed `[classroom:system]`
   with no `assistant` reply after them means the model returned nothing.
4. **`GET /api/sessions/:id/transcript`** — what the orchestrator stored. Agent entries
   but no human ones means the engine never heard the room.
5. **`GET /api/sessions/:id`** — check `floor.lastHumanSpeechAt`. If it still equals
   session creation time, no human turn has ever been processed.
6. **`GET /api/sessions/:id/prompt`** — the exact system prompt currently in force.

A worked example: for session `6650`, step 3 alone identified the empty-completion fault
in one request, after steps 1 and 2 showed everything nominally healthy.

---

## 8. Honest list of open risks

- **The model can return empty and nothing detects it.** No alert, no log, no failed
  assertion. It presents as "the UI says she is speaking but there is no sound." A cheap
  guard would be: if an assistant turn is empty or whitespace-only, log a warning.
- **Speaker attribution is a guess.** The toolkit reports every human turn as uid `"0"`.
  `ClassroomAudio.tsx` polls remote track volume every 150 ms and attributes the turn to
  the loudest speaker. It is wrong under cross-talk. SAL does not fix this — no speaker
  identity is exposed to the browser transcript.
- **Only the teacher's browser relays transcripts.** `isRelay` is hardcoded to the
  teacher page. If that tab reloads or is backgrounded, transcripts stop for everyone.
  There is no failover.
- **`evaluateGate` is dead code.** `routes/completions.ts` is registered but the agent
  points at Agora's resold OpenAI with no custom `url`, so the restraint-scoring gate
  never runs.
- **The quiz answer key is unvalidated** (see §3).
- **Non-English lessons have no working ASR.** `LanguageCode` allows `ta` and `te`;
  Deepgram nova-3 does not support them. Sarvam is the fallback but needs
  `SARVAM_API_KEY`, which is not set.

---

## 9. Change log for this session

| Change | Status |
|---|---|
| Supabase Postgres wired; migrations applied | Working, verified end to end |
| Teacher auth via Supabase (JWKS, ES256, no secrets) | Working; positive path untested |
| `end_of_speech` → semantic | Working |
| `interruption` → keywords | Working, semantics unconfirmed |
| `sal_mode` → recognition | Unconfirmed; `SAL_MODE=off` to disable |
| Prompt: `{}` silent turn, placeholder ban, name precedence | Working on `gpt-4o-mini` |
| `LLM_MODEL` → `gpt-5-mini` | **Broken — see §0** |
| GPT-5 parameter names in `llmParams()` | Correct, but the cap is too small |

Two calls I got wrong, recorded so they are not repeated:

1. I diagnosed a no-transcript fault as the `interruption: keywords` gate blocking
   speech. A wake-word-free fixture disproved it. The real cause of that session was
   never established; the mic most likely never published.
2. I switched to `gpt-5-mini` without applying the reasoning-model warning already
   written in `HANDOFF.md`, and set a 700-token completion cap that reasoning consumes
   entirely. That is the fault in §0.
