# Athena Echosphere — Engineering Handoff

A live, audio-only classroom on Agora ConvoAI. A teacher, several students, and an AI
co-teacher named **Athena** share one voice channel. Athena hears the whole lesson and speaks
only when invited — the teacher keeps a hard mute and override at all times.

| | |
|---|---|
| **Branch** | `himani` |
| **Head** | `143c203` |
| **Orchestrator tests** | 87 passing |
| **Typecheck & lint** | clean (3 workspaces) |
| **Production build** | passing |

Prepared from the working tree at `143c203`. Every figure here was read from the repository or
produced by running the command shown. Anything unverified is called out as such.

---

## 1. Read this first

The three things that will otherwise cost you an afternoon.

**There is no OpenAI key in this project, by design.** Speech recognition, the language model
and the voice are all billed through the Agora project. The model is Agora's resold
`gpt-4o-mini`. This is why the orchestrator cannot sit in the middle of a turn and inject
context, and why nearly all behaviour lives in the system prompt, pushed with
`session.update()` whenever the room changes.

**The orchestrator has no build step.** It runs TypeScript directly through `tsx`.
`pnpm --filter @echosphere/orchestrator build` fails because no such script exists, not because
anything is broken. Only the Next.js app builds.

**Turn-taking is enforced in two independent layers, and they are not redundant.** The floor
state machine decides whether a request to speak is issued at all; the prompt only shapes what
gets said once permission exists. The prompt is advisory, the state machine is binding. Never
rely on prompt wording to keep Athena quiet.

---

## 2. Getting it running

Two processes. Roughly five minutes from a clean clone.

### 1. Install

```bash
pnpm install
```

### 2. Set credentials

Both apps read Agora credentials. The orchestrator reads `NEXT_`-prefixed names to match the
web app — a known wart, noted in its own `.env`.

| Variable | Where | Required |
|---|---|---|
| `NEXT_PUBLIC_AGORA_APP_ID` | both | **yes** |
| `NEXT_AGORA_APP_CERTIFICATE` | both | **yes** |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | web | **yes** |
| `PORT` / `CORS_ORIGINS` | orchestrator | **yes** |
| `LLM_MODEL` | orchestrator | defaulted |
| `SARVAM_API_KEY` | orchestrator | optional |
| `STT_LANGUAGE` / `TTS_VOICE_ID` | orchestrator | optional |
| `DATABASE_URL` | orchestrator | optional |

`LLM_MODEL` must be one Agora resells: `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5-nano` or
`gpt-5-mini`.

### 3. Run both processes

```bash
pnpm run dev:classroom   # orchestrator :8787 + web :3000
```

Then open <http://localhost:3000/join>. Open the teacher in one browser profile and each
student in another — see the tab-duplication trap below.

---

## 3. How a quiz actually works

The most load-bearing and least obvious path in the system.

There is no second model call. Athena appends a JSON object to her spoken turn, and the TTS
engine's `skipPatterns` strips curly-brace content before speech synthesis. So the object never
reaches the room's ears but does reach the orchestrator. **One brace pair per turn only** — the
engine skips the first outermost pair, so a second object would be read aloud.

That payload reaches `applyControl` by **two independent paths**:

1. the agent-history poll in `issueSetQuestion`
2. the relayed RTM transcript in `ingestAgentTurn`

Neither can be removed — the poll is the reliable one for a teacher-started quiz set, but a quiz
Athena poses unprompted is only ever seen via the relay. They are de-duplicated on the payload
itself.

> **If quiz cards start duplicating again,** that de-duplication is the first place to look:
> `isDuplicateQuizPayload` in `classroomController.ts`. Both delivery paths mint their own
> `quizId`, so without the guard one spoken turn becomes two cards carrying the same
> "Question N of M".

---

## 4. Traps that have already cost time

Each of these was diagnosed the slow way. None is obvious from the code.

### The dev server and the production build use different bundlers

`next dev --webpack` uses webpack; `next build` on Next 16 defaults to **Turbopack**. A
`webpack:` key in `next.config.mjs` is therefore *silently ignored at build time*. This is
exactly how the whiteboard branch shipped code that ran perfectly in dev and failed every
production build. If something works locally and dies in CI, check this first.

### The dev server caches `tailwind.config.ts`

Editing `fontFamily` or theme values does not hot-reload reliably. A browser check reported the
*old* font stack and looked like a genuine failure until the server was restarted. Restart `dev`
before trusting any config-level styling result.

### Duplicating a browser tab breaks Agora RTM

Duplicating copies `sessionStorage`, and therefore the stored identity. Agora permits each
participant one connection, so the second tab collides (`-10027`). `ClassroomShell`
reference-counts one RTM client per `(app, uid, channel)` with a 3 s dispose grace period,
because React StrictMode runs the fake unmount's cleanup *synchronously* before the real mount.
Use a separate browser profile or a private window for a second student.

### RTM socket timeouts are a network problem, not a code problem

`socket connection error, errorInfo: Timeout has occurred` means the SDK could not reach an
Agora edge before its connect timeout. Auth failures look different (`-10005` / `-10008` at
login). It is almost always a firewall, VPN or campus network that does not allowlist Agora. The
SDK retries; a single occurrence followed by a successful connect is harmless. If RTM never
connects the room degrades to silent-classroom-over-HTTP rather than failing outright.

### Neural TTS mangles isolated letters

A bare `"D."` carries almost no context, so the engine falls back to whatever letter-name
reading is most probable — on a multilingual voice that can be another language's inventory
entirely (a live session produced "shahar" for D). The quiz directive now instructs Athena to
say **"Option A"**, never a bare letter. Full option text was never affected; it has plenty of
context.

### The quiz answer key is generated, not computed

Nothing server-side can validate it without a second model call. The control contract previously
hardcoded `"answer":"B"` in both the schema and its only worked example, and the model anchored
on it — marking students who answered correctly as wrong. The example now answers `C` and the
model is told to count its own options.

**This is mitigation, not a fix.** If wrong answer keys recur, the robust change is to have
Athena state the correct option's *text* rather than its letter, so position errors become
impossible.

---

## 5. Recent work

Three commits on top of the light-theme redesign.

| Commit | What it did |
|---|---|
| `143c203` | Removed decorative emoji across the UI, and put everything on one type system. Tailwind mapped `sans` to plain system-ui while the app rendered in IBM Plex Sans, and `serif`/`mono` were unmapped — four typefaces in play. Now mapped to the faces actually loaded; twelve `font-serif` headings moved to `.eco-display`. |
| `2d1cb35` | Merged three features from `prashant-ClaudeCode`: catch-up chatbot, Nobody Left Behind support, shared workspace. Retheming migrated 191 hardcoded dark-only colours onto `--eco-*` tokens. |
| `f70ae44` | Quiz correctness (duplicate cards, answer key, spoken option labels), mobile scrolling on the classroom page, a hydration warning, and confetti built outside render. |

### What was deliberately left out

The **Agora Interactive Whiteboard** from that branch is not merged. It was the sole cause of a
broken production build — `@netless/fastboard` pulls `white-web-sdk`, which pulls
`agora-foundation`, which calls `require('fs')` and `require('winston')` in browser code. It
also required a separate Agora product enabled plus two credentials we do not have, and pinned
`agora-foundation@3.10.0-jk.2`, a pre-release tag. Removing it cleared all three problems at
once. The `2d1cb35` commit message records exactly what was stripped if it is ever revived.

---

## 6. Known gaps

Real, and none of them hidden behind a passing test.

### The language selector is decorative

`changeLanguage` only sets local React state. There is no server route, and
`echosphere:language-changed` is handled in the client but **never emitted** by the orchestrator
— verified by grep. Selecting a language changes the dropdown and nothing else; the catch-up
prompt never sees it.

Wiring it is roughly an hour: a route to set `participant.language`, emit the event, and read it
in `catchupSystemPrompt`.

### The voice stack is English-only while the prompt invites any language

STT is Deepgram `nova-3` pinned to `en` and TTS is MiniMax `English_captivating_female1`, but
the persona says "reply in whatever language the student used". The Sarvam path (Hindi STT *and*
TTS) exists in `agentLifecycle.ts` but is gated on `SARVAM_API_KEY`, which is not set — so it
silently falls back. Hindi output read by an English voice is what "gargled" words sound like.

### None of the three merged features has been exercised in a live classroom

They compile, pass tests and theme correctly. Nobody has confirmed the catch-up bot gives good
answers or that booking a slot round-trips. That needs a real session with two browser profiles.

---

## 7. Verifying a change

Run the narrowest thing that covers what you touched, then the gate.

```bash
pnpm run typecheck                              # all 3 workspaces
pnpm run lint                                   # web only; orchestrator has none
pnpm --filter @echosphere/orchestrator test     # 87 tests, needs .env
cd apps/web && pnpm run build                   # catches Turbopack-only failures
```

| Suite | Tests | Covers |
|---|---:|---|
| `floorMachine` | 25 | Turn-taking transitions in isolation |
| `quiz` | 14 | Answer resolution, set advance, duplicate payloads |
| `floor` | 13 | Floor requests against a live session |
| `control` | 11 | Control-channel parsing |
| `echo` | 8 | Stripping Athena's own speech re-entering by mic |
| `gate` | 8 | Speak-permit gating |
| `tokens` | 5 | RTC + RTM token minting |
| `catchup` | 3 | Catch-up answer grounding |

Several suites need `.env` (`--env-file=.env`), so they fail confusingly on a fresh clone with
no credentials. Browser-only defects — hydration mismatches, theme regressions, clipped layouts
— are invisible to all of the above; drive a real browser with Playwright, which is already a
workspace dependency.

---

## 8. Where things live

| Path | Responsibility |
|---|---|
| `orchestrator/src/classroomController.ts` | The seam: transcript in, floor decision, control payload out |
| `orchestrator/src/floor/floorMachine.ts` | Turn-taking. The binding layer |
| `orchestrator/src/agent/prompt.ts` | Persona, control contract, per-command directives |
| `orchestrator/src/agent/agentLifecycle.ts` | Agora SDK wrapper; STT/TTS/LLM provider choice |
| `orchestrator/src/quiz/quizEngine.ts` | Quiz records, answer resolution, broadcast |
| `web/components/classroom/ClassroomShell.tsx` | RTM client lifecycle and the duplicate-identity guard |
| `web/hooks/useClassroom.ts` | SSE subscription; the single source of room state |
| `web/app/globals.css` | The `--eco-*` design tokens. Both themes |

[`docs/SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) is the architecture reference,
[`docs/BUILD-LOG.md`](BUILD-LOG.md) the bug-by-bug history, and each app's `AGENTS.md` the
contributor handbook.

> Note: `apps/web/AGENTS.md` carries the upstream Agora quickstart's conventions, including some
> that conflict with this repo's git practice — read it as inherited, not authoritative.
