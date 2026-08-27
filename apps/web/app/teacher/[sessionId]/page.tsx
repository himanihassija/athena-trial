/**
 * Teacher dashboard — PS31 §3.4 (lesson upload), §3.5 (per-student level),
 * §3.9 (live gap dashboard and post-class report), §3.10 (control panel).
 *
 * The teacher's browser is also the transcript relay for the room: Agora's RTM
 * is browser-only, and the teacher is by definition present for the whole
 * lesson, so this is the one client guaranteed to see every utterance.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  SessionReport,
  TeacherCommand,
  VerbosityLevel,
} from "@echosphere/shared-types";
import { ClassroomShell } from "@/components/classroom/ClassroomShell";
import { ClassroomAudio } from "@/components/classroom/ClassroomAudioLazy";
import { TeacherControlPanel } from "@/components/classroom/TeacherControlPanel";
import {
  AgentAbsentNotice,
  BlockedAttempts,
  FloorIndicator,
  GapPanel,
  QuizCards,
  RosterPanel,
  TranscriptFeed,
} from "@/components/classroom/panels";
import { useClassroom } from "@/hooks/useClassroom";
import {
  clearIdentity,
  loadIdentity,
  orchestrator,
  type StoredIdentity,
} from "@/lib/orchestrator";

export default function TeacherDashboardPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  // Whether the transcript pipeline is actually alive. Distinguishing this from
  // "nobody has spoken" is the difference between a quiet room and a broken one.
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [lessonText, setLessonText] = useState("");
  const [lessonName, setLessonName] = useState("");
  const [lessonInfo, setLessonInfo] = useState<{
    chunks: number;
    topics: string[];
    sources: string[];
  } | null>(null);

  useEffect(() => {
    const stored = loadIdentity(sessionId);
    if (!stored || stored.role !== "teacher") {
      router.replace("/join");
      return;
    }
    setIdentity(stored);
  }, [sessionId, router]);

  const view = useClassroom(sessionId, identity?.participantId ?? null);

  const refreshLesson = useCallback(async () => {
    try {
      setLessonInfo(await orchestrator.getLesson(sessionId));
    } catch {
      // Non-fatal; the panel just shows nothing.
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshLesson();
  }, [refreshLesson]);

  const send = useCallback(
    async (command: TeacherCommand) => {
      if (!identity) return;
      setBusy(true);
      setNotice(null);
      try {
        const result = await orchestrator.sendCommand(
          sessionId,
          identity.participantId,
          command,
        );
        if (!result.ok && result.detail) setNotice(result.detail);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Command failed");
      } finally {
        setBusy(false);
      }
    },
    [identity, sessionId],
  );

  const startAgent = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    setNotice(null);
    try {
      await orchestrator.startAgent(sessionId, identity.participantId);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not start Athena",
      );
    } finally {
      setBusy(false);
    }
  }, [identity, sessionId]);

  const stopAgent = useCallback(async () => {
    setBusy(true);
    try {
      await orchestrator.stopAgent(sessionId);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  const endSession = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    try {
      await orchestrator.sendCommand(sessionId, identity.participantId, {
        type: "END_SESSION",
      });
      setReport(
        await orchestrator.getReport(sessionId, identity.participantId),
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not end lesson",
      );
    } finally {
      setBusy(false);
    }
  }, [identity, sessionId]);

  const uploadLesson = useCallback(async () => {
    if (!identity || lessonText.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await orchestrator.uploadLesson(
        sessionId,
        identity.participantId,
        lessonName.trim() || "lesson-notes",
        lessonText,
      );
      setNotice(
        `Indexed ${result.chunks} chunk(s). ` +
          (result.appliedToAgent
            ? "Athena is now grounded in this material."
            : "It will reach Athena when you bring her in."),
      );
      setLessonText("");
      await refreshLesson();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [identity, sessionId, lessonName, lessonText, refreshLesson]);

  const leave = useCallback(async () => {
    if (identity) {
      await orchestrator
        .leave(sessionId, identity.participantId)
        .catch(() => undefined);
    }
    clearIdentity();
    router.push("/join");
  }, [identity, sessionId, router]);

  if (!identity) {
    return (
      <main className="eco-room flex min-h-screen items-center justify-center p-6 text-sm text-[var(--eco-cream-dim)]">
        Loading…
      </main>
    );
  }

  return (
    <main className="eco-room mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="eco-display text-2xl text-[var(--eco-cream)]">
            {view.room?.title ?? "Classroom"}
          </h1>
          <p className="eco-numerals text-xs text-[var(--eco-cream-faint)]">
            Teacher view · {identity.displayName} ·{" "}
            {view.connected ? "connected" : "reconnecting…"} · share code{" "}
            <span style={{ color: "var(--eco-glow)" }}>{sessionId}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FloorIndicator floor={view.floor} policy={view.policy} />
          <button
            type="button"
            onClick={() => setMicEnabled((on) => !on)}
            className="eco-mic-button flex h-9 w-9 items-center justify-center border text-xs font-medium transition-colors"
            style={
              micEnabled
                ? { borderColor: "var(--eco-glow)", background: "var(--eco-glow-dim)", color: "var(--eco-glow-bright)" }
                : { borderColor: "var(--eco-rule)", color: "var(--eco-cream-faint)" }
            }
            aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
            title={micEnabled ? "Mic on" : "Mic off"}
          >
            {micEnabled ? "●" : "○"}
          </button>
          <button
            type="button"
            onClick={() => void leave()}
            className="rounded-lg border px-3 py-1.5 text-sm text-[var(--eco-cream-dim)]"
            style={{ borderColor: "var(--eco-rule)" }}
          >
            Leave
          </button>
        </div>
      </header>

      {notice && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: "var(--eco-amber)", background: "var(--eco-amber-dim)", color: "var(--eco-cream)" }}
        >
          {notice}
        </p>
      )}

      {!view.room?.agentId && <AgentAbsentNotice isTeacher />}

      {transcriptionError && (
        <p
          className="rounded-[0.625rem] border px-4 py-3 text-sm"
          style={{ borderColor: "var(--eco-red)", background: "var(--eco-red-dim)", color: "var(--eco-cream)" }}
        >
          Transcription could not start: {transcriptionError}. Athena cannot hear
          the room. Reload the page; if it persists, check the browser console.
        </p>
      )}

      {view.room?.agentId && !transcriptionLive && !transcriptionError && (
        <p className="eco-panel-sunken px-4 py-3 text-sm text-[var(--eco-cream-dim)]">
          Connecting the transcript pipeline…
        </p>
      )}

      {/* The control panel sits OUTSIDE ClassroomShell deliberately. Starting the
          agent is a plain HTTP call to the orchestrator and needs no RTM, so
          gating it behind the messaging connection would hide the one button
          that fixes a silent room whenever RTM is slow or failing. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <TeacherControlPanel
            policy={view.policy}
            agentRunning={Boolean(view.room?.agentId)}
            busy={busy}
            onMute={() => void send({ type: "MUTE_AGENT" })}
            onResume={() => void send({ type: "RESUME_AGENT" })}
            onEndTurn={() => void send({ type: "END_AGENT_TURN" })}
            onForceSpeak={(topic) =>
              void send({ type: "FORCE_AGENT_SPEAK", topic })
            }
            onVerbosity={(level: VerbosityLevel) =>
              void send({ type: "ADJUST_VERBOSITY", level })
            }
            onSetStudentInvocation={(enabled) =>
              void send({ type: "SET_STUDENT_INVOCATION", enabled })
            }
            onDisableTopic={(topic) =>
              void send({ type: "DISABLE_TOPIC", topic })
            }
            onEnableTopic={(topic) =>
              void send({ type: "ENABLE_TOPIC", topic })
            }
            onStartQuiz={(topic) => void send({ type: "START_QUIZ", topic })}
            onStartAgent={() => void startAgent()}
            onStopAgent={() => void stopAgent()}
            onEndSession={() => void endSession()}
          />

          <section className="eco-panel flex flex-col gap-2 p-4">
            <h2 className="eco-label">Lesson material</h2>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              Paste slides or notes. Athena grounds her answers in this and uses
              your terminology.
              {lessonInfo && lessonInfo.chunks > 0 && (
                <>
                  {" "}
                  Currently indexed: {lessonInfo.chunks} chunk(s) from{" "}
                  {lessonInfo.sources.join(", ")}.
                </>
              )}
            </p>
            <input
              className="rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
              style={{ borderColor: "var(--eco-rule)", background: "var(--eco-ink-sunken)" }}
              value={lessonName}
              onChange={(e) => setLessonName(e.target.value)}
              placeholder="Source name, e.g. week-4-slides"
            />
            <textarea
              className="min-h-28 rounded-lg border px-2.5 py-1.5 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
              style={{ borderColor: "var(--eco-rule)", background: "var(--eco-ink-sunken)" }}
              value={lessonText}
              onChange={(e) => setLessonText(e.target.value)}
              placeholder="Paste the lesson text here…"
            />
            <button
              type="button"
              disabled={busy || lessonText.trim().length === 0}
              onClick={() => void uploadLesson()}
              className="self-start rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-40"
              style={{ background: "var(--eco-glow)", color: "var(--eco-ink)" }}
            >
              Index material
            </button>
          </section>

          {/* Audio only. RTM failing degrades the room to a silent classroom
              rather than an unusable page. */}
          <ClassroomShell identity={identity}>
            {(rtm) => (
              <ClassroomAudio
                sessionId={sessionId}
                channel={identity.channel}
                appId={identity.appId}
                uid={identity.uid}
                rtcToken={identity.rtcToken}
                rtmClient={rtm}
                agentUid={identity.agentUid}
                isRelay
                micEnabled={micEnabled}
                onToolkitReady={setTranscriptionLive}
                onToolkitError={setTranscriptionError}
              />
            )}
          </ClassroomShell>

          <TranscriptFeed
            transcript={view.transcript}
            participants={view.participants}
            agentPresent={Boolean(view.room?.agentId)}
          />
        </div>

        <aside className="flex w-full flex-col gap-5 lg:w-80">
          <RosterPanel
            participants={view.participants}
            agentPresent={Boolean(view.room?.agentId)}
            onSetProficiency={(studentId, proficiency) =>
              void send({ type: "SET_PROFICIENCY", studentId, proficiency })
            }
          />
          <GapPanel
            gaps={view.gaps}
            participants={view.participants}
            onQuiz={(topic, targetStudentIds) =>
              void send({ type: "START_QUIZ", topic, targetStudentIds })
            }
          />
          <QuizCards
            quizzes={view.quizzes}
            canAnswer={false}
            onAnswer={() => undefined}
          />
          <BlockedAttempts attempts={view.blockedAttempts} />
        </aside>
      </div>

      {report && <ReportView report={report} />}
    </main>
  );
}

/** Post-class report (§3.9), rendered inline once the lesson ends. */
function ReportView({ report }: { report: SessionReport }) {
  return (
    <section className="eco-panel flex flex-col gap-4 p-5">
      <h2 className="eco-display text-xl text-[var(--eco-cream)]">
        Post-class summary
      </h2>
      <p className="text-sm text-[var(--eco-cream)]">{report.narrative}</p>

      {report.topicsCovered.length > 0 && (
        <div>
          <h3 className="eco-label-dim mb-1">Topics covered</h3>
          <p className="text-sm text-[var(--eco-cream-dim)]">
            {report.topicsCovered.join(", ")}
          </p>
        </div>
      )}

      {report.commonMisconceptions.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="eco-label-dim mb-1">Common misconceptions</h3>
          <ul className="flex flex-col gap-1 text-sm text-[var(--eco-cream-dim)]">
            {report.commonMisconceptions.map((m) => (
              <li key={m.topic}>
                <strong className="text-[var(--eco-cream)]">{m.topic}</strong>{" "}
                — {m.description}{" "}
                <span className="text-[var(--eco-cream-faint)]">
                  ({m.studentNames.join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="eco-label-dim mb-1">Per student</h3>
        <div className="overflow-x-auto">
          <table className="eco-numerals w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr
                className="border-b text-xs uppercase text-[var(--eco-cream-faint)]"
                style={{ borderColor: "var(--eco-rule)" }}
              >
                <th className="py-1 pr-3 font-medium">Student</th>
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 font-medium">Asked</th>
                <th className="py-1 pr-3 font-medium">Quiz</th>
                <th className="py-1 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {report.perStudent.map((s) => (
                <tr
                  key={s.participantId}
                  className="border-b text-[var(--eco-cream-dim)]"
                  style={{ borderColor: "var(--eco-rule)" }}
                >
                  <td className="py-1 pr-3 text-[var(--eco-cream)]">
                    {s.displayName}
                  </td>
                  <td className="py-1 pr-3">{s.proficiency}</td>
                  <td className="py-1 pr-3">{s.questionsAsked}</td>
                  <td className="py-1 pr-3">
                    {s.quizzesCorrect}/{s.quizzesAnswered}
                  </td>
                  <td className="py-1">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {report.suggestedFollowUp.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="eco-label-dim mb-1">Suggested follow-up</h3>
          <ul className="list-disc pl-5 text-sm text-[var(--eco-cream-dim)]">
            {report.suggestedFollowUp.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
