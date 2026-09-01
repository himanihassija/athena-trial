'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  Message,
  MessageContent,
} from 'agora-agent-uikit';
import type { CatchupMessage } from '@echosphere/shared-types';
import { orchestrator } from '@/lib/orchestrator';

const PROMPTS = [
  'What did I miss?',
  'Explain the last thing on the board',
  'Recap the LCD method',
];

export function CatchupChatbot({
  sessionId,
  participantId,
  displayName,
}: {
  sessionId: string;
  participantId: string;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CatchupMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void orchestrator
      .getCatchup(sessionId, participantId)
      .then((r) => setMessages(r.history))
      .catch(() => undefined);
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open, sessionId, participantId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      setDraft('');
      setMessages((prev) => [...prev, { role: 'student', text: trimmed, at: Date.now() }]);
      try {
        const result = await orchestrator.askCatchup(sessionId, participantId, trimmed);
        setMessages(result.history);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach Athena');
        setMessages((prev) => prev.slice(0, -1));
        setDraft(trimmed);
      } finally {
        setBusy(false);
      }
    },
    [busy, participantId, sessionId],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  return (
    <>
      <button
        type="button"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border text-sm font-medium shadow-none"
        style={{
          borderColor: 'var(--eco-glow)',
          background: open ? 'var(--eco-ink-raised)' : 'var(--eco-glow)',
          color: open ? 'var(--eco-glow-bright)' : 'var(--eco-ink)',
        }}
        aria-expanded={open}
        aria-controls="catchup-chat"
        aria-label={open ? 'Close catch-up chat' : 'Open catch-up chat'}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : 'Ask'}
      </button>

      {open && (
        <section
          id="catchup-chat"
          className="eco-panel fixed bottom-24 right-5 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden"
          aria-label="Catch-up chat with Athena"
        >
          <header
            className="flex items-start justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="eco-lamp eco-lamp-glow" />
                <h2 className="eco-label">Catch up</h2>
              </div>
              <p className="mt-1 text-xs text-[var(--eco-cream-faint)]">
                Private with Athena. No teacher approval. Grounded in this class.
              </p>
            </div>
          </header>

          <Conversation
            agentName="Athena"
            userName={displayName}
            height="h-72"
            className="bg-transparent"
          >
            <ConversationContent padding="p-3">
              {messages.length === 0 ? (
                <ConversationEmptyState
                  title="Missed a stretch?"
                  description="Ask what the class covered. Answers stay on your screen only."
                />
              ) : (
                messages.map((message, index) => (
                  <Message
                    key={`${message.at}-${index}`}
                    from={message.role === 'student' ? 'user' : 'assistant'}
                    name={message.role === 'student' ? displayName : 'Athena'}
                  >
                    <MessageContent>{message.text}</MessageContent>
                  </Message>
                ))
              )}
              {busy && (
                <Message from="assistant" name="Athena">
                  <MessageContent>Looking at the lesson…</MessageContent>
                </Message>
              )}
            </ConversationContent>
          </Conversation>

          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={busy}
                onClick={() => void send(prompt)}
                className="rounded-full border px-2.5 py-1 text-[11px] text-[var(--eco-cream-dim)] disabled:opacity-40"
                style={{ borderColor: 'var(--eco-rule)' }}
              >
                {prompt}
              </button>
            ))}
          </div>

          {error && (
            <p className="px-3 pb-1 text-xs text-[var(--eco-amber)]">{error}</p>
          )}

          <form
            onSubmit={onSubmit}
            className="flex gap-2 border-t p-3"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            <input
              ref={inputRef}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none"
              style={{
                borderColor: 'var(--eco-rule)',
                background: 'var(--eco-ink-sunken)',
              }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What did I miss?"
              maxLength={800}
              disabled={busy}
              aria-label="Catch-up question"
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--eco-glow)', color: 'var(--eco-ink)' }}
            >
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
