import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SessionSummary } from './api';
import { KIND_COLOR, fmtCost, shortId, timeAgo, fmtClock } from './util';
import { Waterfall } from './components/Waterfall';
import { Replay } from './components/Replay';
import { PromptDiff } from './components/PromptDiff';
import { Inspector } from './components/Inspector';
import { StepsRail } from './components/StepsRail';

type Tab = 'waterfall' | 'replay' | 'diff';
type Filter = 'all' | 'errors' | 'cost';

const TABS: { id: Tab; label: string }[] = [
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'replay', label: 'Replay' },
  { id: 'diff', label: 'Diff' },
];

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('waterfall');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [traceId, setTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [replayIdx, setReplayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Live-ish: sessions poll every 3s (TanStack refetchInterval, no sockets).
  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: api.sessions,
    refetchInterval: 3000,
  });
  const sessions = sessionsQ.data?.sessions ?? [];

  const filtered = sessions.filter((s) => {
    if (search && !s.session_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'errors') return s.error_count > 0;
    if (filter === 'cost') return s.total_cost_usd > 0.01;
    return true;
  });

  const activeId = sessionId ?? filtered[0]?.session_id ?? null;

  // Shares the query cache with any component using the same key.
  const sessionQ = useQuery({
    queryKey: ['session', activeId],
    queryFn: () => api.session(activeId!),
    enabled: !!activeId,
    refetchInterval: 3000,
  });
  const spans = sessionQ.data?.spans ?? [];
  const traces = sessionQ.data?.traces ?? [];

  const activeTrace = traces.find((t) => t.trace_id === traceId) ?? traces[0] ?? null;

  // Persistent inspector: fall back to the first LLM span of the active trace.
  const selectedSpan = useMemo(() => {
    const byId = spans.find((s) => s.span_id === selectedSpanId);
    if (byId) return byId;
    const inTrace = activeTrace ? spans.filter((s) => s.trace_id === activeTrace.trace_id) : spans;
    return inTrace.find((s) => s.kind === 'llm') ?? inTrace[0] ?? null;
  }, [spans, selectedSpanId, activeTrace]);

  const todayCost = useMemo(() => {
    const today = new Date().toDateString();
    return sessions
      .filter((s) => new Date(s.started_at).toDateString() === today)
      .reduce((sum, s) => sum + s.total_cost_usd, 0);
  }, [sessions]);

  const selectSession = (id: string) => {
    setSessionId(id);
    setTraceId(null);
    setSelectedSpanId(null);
    setReplayIdx(0);
    setPlaying(false);
  };

  const openInReplay = (spanId: string) => {
    const i = spans.findIndex((s) => s.span_id === spanId);
    if (i >= 0) {
      setReplayIdx(i);
      setPlaying(false);
      setTab('replay');
    }
  };

  // ⌘K focuses search; ←/→/space drive the replay when it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (tab !== 'replay') return;
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return;
      if (e.key === 'ArrowLeft') setReplayIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setReplayIdx((i) => Math.min(spans.length - 1, i + 1));
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, spans.length]);

  // Autoplay: advance one step at a time, stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (tab !== 'replay' || replayIdx >= spans.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setReplayIdx(replayIdx + 1), 900);
    return () => clearTimeout(t);
  }, [playing, tab, replayIdx, spans.length]);

  const replaySpan = spans[Math.min(replayIdx, Math.max(0, spans.length - 1))];
  const totalSpans = sessions.reduce((sum, s) => sum + s.span_count, 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <div className="logo-mark" />
          <div className="brand">
            Agent<span>Lens</span>
          </div>
        </div>
        <div className="env-pill">
          local<span className="sep">/</span>
          <span className="env">dev</span>
          <span className="caret">▾</span>
        </div>
        <div className="search">
          <span className="search-icon">⌕</span>
          <input
            ref={searchRef}
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="kbd">⌘K</span>
        </div>
        <div className="topbar-right">
          <div className="live" title="auto-refreshing">
            <span className="live-dot" />
            live · 3s poll
          </div>
          <div className="cost-pill">
            today <span>{fmtCost(todayCost)}</span>
          </div>
        </div>
      </header>

      <div className={`shell ${tab === 'waterfall' ? 'with-inspector' : ''}`}>
        <aside className="rail">
          {tab === 'replay' && activeId ? (
            <StepsRail
              sessionId={activeId}
              spans={spans}
              idx={replayIdx}
              onSelect={(i) => {
                setPlaying(false);
                setReplayIdx(i);
              }}
            />
          ) : (
            <SessionsRail
              sessions={filtered}
              total={sessions.length}
              activeId={activeId}
              filter={filter}
              onFilter={setFilter}
              onSelect={selectSession}
              totalSpans={totalSpans}
              apiOk={!sessionsQ.isError}
            />
          )}
        </aside>

        <main className="main">
          <div className="switcher-row">
            <div className="segmented">
              {TABS.map((t) => (
                <div
                  key={t.id}
                  className={`seg ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </div>
              ))}
            </div>
            <div className="switcher-right">
              {tab === 'waterfall' && traces.length > 0 && activeTrace && (
                <select
                  className="trace-select"
                  value={activeTrace.trace_id}
                  onChange={(e) => {
                    setTraceId(e.target.value);
                    setSelectedSpanId(null);
                  }}
                >
                  {traces.map((t) => (
                    <option key={t.trace_id} value={t.trace_id}>
                      {t.root_name ?? shortId(t.trace_id)} · {fmtClock(t.started_at)}
                    </option>
                  ))}
                </select>
              )}
              {tab === 'replay' && replaySpan && (
                <span className="ctx-note">
                  trace {shortId(replaySpan.trace_id)} · {fmtClock(replaySpan.started_at)}
                </span>
              )}
              {tab === 'diff' && activeId && (
                <span className="ctx-note">session {shortId(activeId)}</span>
              )}
            </div>
          </div>

          <div className="content">
            {!activeId ? (
              <div className="empty">
                No sessions yet. Run `pnpm example:agent` to generate one.
              </div>
            ) : sessionQ.isLoading ? (
              <div className="empty">Loading session…</div>
            ) : tab === 'waterfall' ? (
              <Waterfall
                trace={activeTrace}
                selectedSpanId={selectedSpan?.span_id ?? null}
                onSelectSpan={setSelectedSpanId}
              />
            ) : tab === 'replay' ? (
              <Replay
                spans={spans}
                idx={replayIdx}
                playing={playing}
                onSelect={(i) => {
                  setPlaying(false);
                  setReplayIdx(i);
                }}
                onTogglePlay={() => setPlaying((p) => !p)}
              />
            ) : (
              <PromptDiff traces={traces} />
            )}
          </div>
        </main>

        {tab === 'waterfall' && (
          <aside className="inspector">
            <Inspector
              span={selectedSpan}
              onClose={() => setSelectedSpanId(null)}
              onOpenReplay={openInReplay}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function SessionsRail({
  sessions,
  total,
  activeId,
  filter,
  onFilter,
  onSelect,
  totalSpans,
  apiOk,
}: {
  sessions: SessionSummary[];
  total: number;
  activeId: string | null;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onSelect: (id: string) => void;
  totalSpans: number;
  apiOk: boolean;
}) {
  return (
    <>
      <div className="rail-header">
        <div className="rail-title">Sessions</div>
        <div className="rail-count">{total}</div>
      </div>
      <div className="chips">
        {(
          [
            ['all', 'All'],
            ['errors', 'Errors'],
            ['cost', '> $0.01'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <div
            key={f}
            className={`chip ${filter === f ? 'active' : ''}`}
            onClick={() => onFilter(f)}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="rail-scroll">
        {sessions.length === 0 && <div className="empty">No sessions match.</div>}
        {sessions.map((s) => (
          <SessionCard
            key={s.session_id}
            s={s}
            active={s.session_id === activeId}
            onClick={() => onSelect(s.session_id)}
          />
        ))}
      </div>
      <div className="rail-footer">
        <span>{totalSpans.toLocaleString()} spans</span>
        <span>{apiOk ? 'api ok' : 'api down'}</span>
      </div>
    </>
  );
}

function SessionCard({
  s,
  active,
  onClick,
}: {
  s: SessionSummary;
  active: boolean;
  onClick: () => void;
}) {
  const totalMs = s.agent_ms + s.tool_ms + s.llm_ms;
  return (
    <div className={`session-card ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="sc-row">
        <span className="sc-id">{shortId(s.session_id)}</span>
        <span className="sc-time">{timeAgo(s.started_at)}</span>
      </div>
      {totalMs > 0 && (
        <div className="kind-bar">
          {(['agent', 'tool', 'llm'] as const).map((k) => {
            const ms = s[`${k}_ms`];
            if (ms <= 0) return null;
            return (
              <div
                key={k}
                style={{ width: `${(ms / totalMs) * 100}%`, background: KIND_COLOR[k] }}
              />
            );
          })}
        </div>
      )}
      <div className="sc-meta">
        <span>
          {s.trace_count} trace{s.trace_count === 1 ? '' : 's'}
        </span>
        <span>{s.span_count} spans</span>
        <span className="cost">{fmtCost(s.total_cost_usd)}</span>
        {s.error_count > 0 && <span className="errs">{s.error_count} err</span>}
      </div>
    </div>
  );
}
