'use client';

import { useState } from 'react';
import type {
  MiroStickyNote,
  MiroWorkspaceState,
  StickyNoteCategory,
  StickyNoteColor,
  Role,
} from '@echosphere/shared-types';
import { orchestratorClient } from '@/lib/orchestrator';

interface MiroWorkspacePaneProps {
  sessionId: string;
  participantId: string;
  role: Role;
  workspace: MiroWorkspaceState | null;
  onRefresh?: () => void;
}

const CATEGORY_LABELS: Record<StickyNoteCategory, { label: string; bg: string; text: string }> = {
  'held-back-doubt': { label: 'Held-Back Doubt (Athena)', bg: 'bg-amber-500/20', text: 'text-amber-300' },
  'student-question': { label: 'Student Question', bg: 'bg-cyan-500/20', text: 'text-cyan-300' },
  'core-concept': { label: 'Core Concept', bg: 'bg-purple-500/20', text: 'text-purple-300' },
  'teacher-insight': { label: 'Teacher Insight', bg: 'bg-emerald-500/20', text: 'text-emerald-300' },
  'key-takeaway': { label: 'Key Takeaway', bg: 'bg-blue-500/20', text: 'text-blue-300' },
};

const COLOR_STYLES: Record<StickyNoteColor, { border: string; bg: string; header: string }> = {
  yellow: { border: 'border-yellow-400/40', bg: 'bg-gradient-to-b from-[#2a2718] to-[#1e1c12]', header: 'bg-yellow-500/20 text-yellow-200' },
  amber: { border: 'border-amber-400/40', bg: 'bg-gradient-to-b from-[#2d2214] to-[#20170d]', header: 'bg-amber-500/20 text-amber-200' },
  coral: { border: 'border-rose-400/40', bg: 'bg-gradient-to-b from-[#2d171b] to-[#1f0f13]', header: 'bg-rose-500/20 text-rose-200' },
  cyan: { border: 'border-cyan-400/40', bg: 'bg-gradient-to-b from-[#14262d] to-[#0c191e]', header: 'bg-cyan-500/20 text-cyan-200' },
  purple: { border: 'border-purple-400/40', bg: 'bg-gradient-to-b from-[#26162f] to-[#1a0f21]', header: 'bg-purple-500/20 text-purple-200' },
  green: { border: 'border-emerald-400/40', bg: 'bg-gradient-to-b from-[#142a1f] to-[#0d1c14]', header: 'bg-emerald-500/20 text-emerald-200' },
};

export function MiroWorkspacePane({
  sessionId,
  participantId,
  role,
  workspace,
  onRefresh,
}: MiroWorkspacePaneProps) {
  const [activeFilter, setActiveFilter] = useState<StickyNoteCategory | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<StickyNoteCategory>('student-question');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [explainingId, setExplainingId] = useState<string | null>(null);

  const notes = workspace?.notes ?? [];
  const filteredNotes = activeFilter === 'all'
    ? notes
    : notes.filter((n) => n.category === activeFilter);

  const heldBackCount = notes.filter((n) => n.isHeldBackDoubt).length;

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    setIsSubmitting(true);
    try {
      await orchestratorClient.addStickyNote(sessionId, {
        topic: newTopic.trim() || 'Class Discussion',
        content: newContent.trim(),
        category: newCategory,
        authorRole: role,
        authorParticipantId: participantId,
      });
      setNewContent('');
      setNewTopic('');
      setShowAddModal(false);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to add sticky note', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (noteId: string) => {
    try {
      await orchestratorClient.voteStickyNote(sessionId, noteId, participantId);
      onRefresh?.();
    } catch (err) {
      console.error('Vote failed', err);
    }
  };

  const handleResolve = async (noteId: string, currentStatus: string) => {
    try {
      const nextStatus = currentStatus === 'resolved' ? 'pending' : 'resolved';
      await orchestratorClient.resolveStickyNote(sessionId, noteId, nextStatus);
      onRefresh?.();
    } catch (err) {
      console.error('Resolve failed', err);
    }
  };

  const handleExplain = async (noteId: string) => {
    setExplainingId(noteId);
    try {
      await orchestratorClient.explainStickyNote(sessionId, noteId);
      onRefresh?.();
    } catch (err) {
      console.error('Explain failed', err);
    } finally {
      setTimeout(() => setExplainingId(null), 2500);
    }
  };

  return (
    <section
      className="eco-panel flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] shadow-xl"
      aria-label="Shared Miro Workspace"
    >
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] bg-black/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-yellow-600 font-bold text-black shadow-md">
            M
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-base font-semibold tracking-wide text-[var(--eco-cream)]">
                Live Shared Workspace
              </h2>
              {heldBackCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/40">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  {heldBackCount} {heldBackCount === 1 ? 'Held-Back Doubt' : 'Held-Back Doubts'}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--eco-cream-faint)]">
              Miro-style live board · synchronized doubts, questions & co-teacher insights
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/40 transition hover:bg-amber-500/30 hover:ring-amber-300"
          >
            <span className="text-base leading-none">+</span> Pin Sticky Note
          </button>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--eco-rule)]/60 bg-black/10 px-4 py-2 text-xs">
        <span className="mr-1 text-[var(--eco-cream-faint)] font-medium">Filter:</span>
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`rounded-md px-2.5 py-1 transition ${
            activeFilter === 'all'
              ? 'bg-[var(--eco-rule)] font-semibold text-[var(--eco-cream)]'
              : 'text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]'
          }`}
        >
          All ({notes.length})
        </button>
        {(Object.keys(CATEGORY_LABELS) as StickyNoteCategory[]).map((cat) => {
          const count = notes.filter((n) => n.category === cat).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveFilter(cat)}
              className={`rounded-md px-2.5 py-1 transition ${
                activeFilter === cat
                  ? 'bg-[var(--eco-rule)] font-semibold text-[var(--eco-cream)]'
                  : 'text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]'
              }`}
            >
              {CATEGORY_LABELS[cat].label} ({count})
            </button>
          );
        })}
      </div>

      {/* Workspace Board Canvas */}
      <div className="relative min-h-[16rem] flex-1 overflow-y-auto p-4">
        {filteredNotes.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--eco-rule)]/60 bg-black/10 p-6 text-center text-sm text-[var(--eco-cream-faint)]">
            <div className="mb-2 text-2xl">📌</div>
            <p className="font-medium text-[var(--eco-cream)]">No sticky notes in this view yet</p>
            <p className="mt-1 max-w-sm text-xs">
              When Athena restrains an intervention or when students ask questions, notes are automatically pinned here live.
            </p>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="mt-3 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/40 hover:bg-amber-500/30"
            >
              + Add First Sticky Note
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredNotes.map((note) => {
              const catMeta = CATEGORY_LABELS[note.category] ?? CATEGORY_LABELS['student-question'];
              const colorStyle = COLOR_STYLES[note.color] ?? COLOR_STYLES.yellow;
              const hasVoted = note.votedBy?.includes(participantId);
              const isResolved = note.status === 'resolved' || note.status === 'addressed';

              return (
                <div
                  key={note.id}
                  className={`group relative flex flex-col justify-between rounded-xl border ${colorStyle.border} ${colorStyle.bg} p-4 shadow-lg transition duration-200 hover:-translate-y-1 hover:shadow-2xl ${
                    isResolved ? 'opacity-70 saturate-50' : ''
                  }`}
                >
                  {/* Category Header */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${catMeta.bg} ${catMeta.text}`}>
                        {catMeta.label}
                      </span>
                      {note.isHeldBackDoubt && note.restraintScore !== undefined && (
                        <span className="text-[10px] font-mono text-amber-300/80" title="Restraint Score">
                          🛡️ Restraint: {Math.round(note.restraintScore * 100)}%
                        </span>
                      )}
                    </div>

                    <h3 className="mt-2 text-sm font-semibold text-[var(--eco-cream)] line-clamp-1">
                      {note.topic}
                    </h3>

                    <p className="mt-1.5 text-xs text-[var(--eco-cream)]/90 leading-relaxed">
                      {note.content}
                    </p>

                    {note.suggestedAnswer && (
                      <div className="mt-2 rounded-lg bg-black/40 p-2 text-[11px] text-amber-200/90 border border-amber-500/20">
                        <span className="font-semibold text-amber-300">Suggested by Athena: </span>
                        {note.suggestedAnswer}
                      </div>
                    )}

                    {note.heldBackReason && (
                      <p className="mt-2 text-[10px] italic text-[var(--eco-cream-faint)]">
                        Reason held back: {note.heldBackReason}
                      </p>
                    )}
                  </div>

                  {/* Footer & Actions */}
                  <div className="mt-4 border-t border-[var(--eco-rule)]/40 pt-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-[10px] text-[var(--eco-cream-faint)]">
                        by {note.authorName}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {/* Vote Button */}
                        <button
                          type="button"
                          onClick={() => handleVote(note.id)}
                          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition ${
                            hasVoted
                              ? 'bg-amber-500 text-black'
                              : 'bg-black/30 text-[var(--eco-cream)] hover:bg-black/50 ring-1 ring-[var(--eco-rule)]'
                          }`}
                          title="Vote this doubt for classroom discussion"
                        >
                          <span>▲</span>
                          <span>{note.votes || 0}</span>
                        </button>

                        {/* Ask Athena to Explain Button */}
                        <button
                          type="button"
                          onClick={() => handleExplain(note.id)}
                          disabled={explainingId === note.id}
                          className="flex items-center gap-1 rounded-md bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-200 ring-1 ring-purple-400/40 hover:bg-purple-500/30 transition disabled:opacity-50"
                          title="Ask Athena to speak this doubt out loud"
                        >
                          {explainingId === note.id ? 'Addressing...' : '🗣️ Explain'}
                        </button>

                        {/* Resolve Button (Teacher or Author) */}
                        {role === 'teacher' && (
                          <button
                            type="button"
                            onClick={() => handleResolve(note.id, note.status)}
                            className={`rounded-md px-2 py-0.5 text-xs transition ${
                              isResolved
                                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                                : 'bg-black/30 text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]'
                            }`}
                          >
                            {isResolved ? '✓ Done' : 'Resolve'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Sticky Note Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel)] p-6 shadow-2xl">
            <h3 className="font-serif text-lg font-semibold text-[var(--eco-cream)]">
              Pin New Sticky Note to Shared Workspace
            </h3>
            <p className="mt-1 text-xs text-[var(--eco-cream-faint)]">
              Broadcasts instantly to all students and the teacher.
            </p>

            <form onSubmit={handleAddNote} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as StickyNoteCategory)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-black/40 px-3 py-2 text-xs text-[var(--eco-cream)] focus:border-amber-400 focus:outline-none"
                >
                  <option value="student-question">Student Question / Doubt</option>
                  <option value="core-concept">Core Concept Note</option>
                  <option value="teacher-insight">Teacher Insight</option>
                  <option value="key-takeaway">Key Takeaway</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">Topic / Concept</label>
                <input
                  type="text"
                  placeholder="e.g. Least Common Multiple (LCM)"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-black/40 px-3 py-2 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--eco-cream)]">Content / Question *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="What is confusing or what insight would you like to share with the room?"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--eco-rule)] bg-black/40 px-3 py-2 text-xs text-[var(--eco-cream)] placeholder-[var(--eco-cream-faint)]/50 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--eco-cream-faint)] hover:text-[var(--eco-cream)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newContent.trim()}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {isSubmitting ? 'Pinning...' : 'Pin to Board'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
