import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SessionSummary } from './api';
import { fmtCost, fmtTime, shortId } from './util';
import { Waterfall } from './components/Waterfall';
import { Replay } from './components/Replay';
import { PromptDiff } from './components/PromptDiff';

type Tab = 'waterfall' | 'replay' | 'diff';

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('waterfall');

  // Live-ish: sessions poll every 3s (TanStack refetchInterval, no sockets).
  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: api.sessions,
    refetchInterval: 3000,
  });

  const sessions = sessionsQ.data?.sessions ?? [];
  const activeId = sessionId ?? sessions[0]?.session_id ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            Agent<span>Lens</span>
          </div>
          <div title="live — auto-refreshing" className="live-dot" />
        </div>
        {sessions.length === 0 && <div className="empty">No sessions yet.</div>}
        {sessions.map((s) => (
          <SessionItem
            key={s.session_id}
            s={s}
            active={s.session_id === activeId}
            onClick={() => setSessionId(s.session_id)}
          />
        ))}
      </aside>

      <main className="main">
        <div className="tabs">
          {(['waterfall', 'replay', 'diff'] as Tab[]).map((t) => (
            <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'waterfall' ? 'Waterfall' : t === 'replay' ? 'Session Replay' : 'Prompt Diff'}
            </div>
          ))}
        </div>
        <div className="content">
          {activeId ? (
            <SessionView sessionId={activeId} tab={tab} />
          ) : (
            <div className="empty">Select a session, or run `pnpm example:agent` to generate one.</div>
          )}
        </div>
      </main>
    </div>
  );
}

function SessionItem({
  s,
  active,
  onClick,
}: {
  s: SessionSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`session-item ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="id">{shortId(s.session_id)}</div>
      <div className="meta">
        {s.trace_count} trace{s.trace_count === 1 ? '' : 's'} · {s.span_count} spans ·{' '}
        {fmtCost(s.total_cost_usd)}
      </div>
      <div className="meta">{fmtTime(s.started_at)}</div>
    </div>
  );
}

function SessionView({ sessionId, tab }: { sessionId: string; tab: Tab }) {
  const { data, isLoading } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId),
    refetchInterval: 3000,
  });

  if (isLoading) return <div className="muted">Loading session…</div>;
  if (!data) return <div className="empty">Session not found.</div>;

  if (tab === 'waterfall') return <Waterfall traces={data.traces} />;
  if (tab === 'replay') return <Replay spans={data.spans} />;
  return <PromptDiff traces={data.traces} />;
}
