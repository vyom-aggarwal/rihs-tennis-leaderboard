/**
 * RIHS Tennis Ladder Dashboard.
 *
 * Architecture in one paragraph: the coach's Google Sheet is the database. This app is
 * a static page that reads the sheet's published CSV directly from the browser, rebuilds
 * the ladder client-side, and re-reads on a timer. There is no server, no login and no
 * copy of the roster held anywhere but the coach's own Google Drive, which is what makes
 * it free to run and impossible to get out of sync with the coach's records.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CoachPanel } from './components/CoachPanel';
import { PlayerDrawer } from './components/PlayerDrawer';
import { Setup } from './components/Setup';
import { Spotlight } from './components/Spotlight';
import { Standings } from './components/Standings';
import { relativeTime } from './components/common';
import { useLiveSheet } from './hooks/useLiveSheet';
import {
  coachUrl,
  readAppState,
  recallSheet,
  rememberSheet,
  teamShareUrl,
  writeAppState,
  type AppState,
} from './lib/config';
import { buildDashboard, sortIssues } from './lib/dashboard';
import type { MatchField, MatchMapping } from './lib/schema';
import type { LadderConfig, StandingRow } from './lib/types';
import { DEMO_MATCHES_CSV, DEMO_ROSTER_CSV } from './demo-data';

/** Demo mode is a sentinel sheet id, so the demo shares the exact live-data code path. */
const DEMO_ID = '__demo__';

export default function App() {
  const [state, setState] = useState<AppState>(() => readAppState(window.location.search));
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showCoachPanel, setShowCoachPanel] = useState(false);
  const [mappingOverride, setMappingOverride] = useState<Partial<MatchMapping>>({});
  const [tick, setTick] = useState(0);

  const isDemo = state.sheetId === DEMO_ID;
  const recalled = useMemo(() => recallSheet(), []);

  // Keep the address bar in step with app state so the link is always shareable.
  useEffect(() => {
    const query = writeAppState(state) + (state.coach ? (writeAppState(state) ? '&' : '?') + 'coach=1' : '');
    const next = window.location.pathname + query;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
    if (!isDemo) rememberSheet(state);
  }, [state, isDemo]);

  // Re-render once a minute so the "updated 3m ago" label stays truthful.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const live = useLiveSheet(
    isDemo ? null : state.sheetId,
    state.gid,
    state.rosterGid,
    state.refreshSeconds,
  );

  const matchesCsv = isDemo ? DEMO_MATCHES_CSV : live.matchesCsv;
  const rosterCsv = isDemo ? DEMO_ROSTER_CSV : live.rosterCsv;

  const dashboard = useMemo(() => {
    if (!matchesCsv) return null;
    return buildDashboard({
      matchesCsv,
      rosterCsv,
      config: state.config,
      mappingOverride,
      // Demo data is dated against a fixed season so it always reads as current.
      now: isDemo ? new Date('2026-09-04T12:00:00Z') : new Date(),
    });
  }, [matchesCsv, rosterCsv, state.config, mappingOverride, isDemo]);

  const boards = dashboard?.boards ?? [];
  const activeBoard =
    boards.find((b) => (b.team ?? b.label) === selectedTeam) ?? boards[0] ?? null;

  const selectedRow: StandingRow | null =
    activeBoard?.standings.find((s) => s.key === selectedKey) ?? null;

  const setConfig = useCallback((patch: Partial<LadderConfig>) => {
    setState((s) => ({ ...s, config: { ...s.config, ...patch } }));
  }, []);

  const connect = useCallback((sheetId: string, gid: string | null) => {
    setState((s) => ({ ...s, sheetId, gid, coach: true }));
    setMappingOverride({});
    setSelectedTeam(null);
  }, []);

  // ------------------------------------------------------------------ setup
  if (!state.sheetId) {
    return (
      <Shell state={state} live={null} onOpenCoach={undefined}>
        <Setup
          onSubmit={connect}
          onTryDemo={() => setState((s) => ({ ...s, sheetId: DEMO_ID, coach: true }))}
          recalled={recalled?.sheetId ? { sheetId: recalled.sheetId, gid: recalled.gid } : null}
          onResume={
            recalled?.sheetId
              ? () =>
                  setState((s) => ({
                    ...s,
                    sheetId: recalled.sheetId,
                    gid: recalled.gid,
                    rosterGid: recalled.rosterGid,
                  }))
              : undefined
          }
        />
      </Shell>
    );
  }

  // ------------------------------------------------------------- first load
  if (live.loading && !matchesCsv) {
    return (
      <Shell state={state} live={live} onOpenCoach={undefined}>
        <div className="section stack" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading the ladder…</span>
          <div className="skeleton" style={{ height: 46 }} />
          <div className="skeleton" style={{ height: 128 }} />
          <div className="skeleton" style={{ height: 320 }} />
        </div>
      </Shell>
    );
  }

  // ------------------------------------------------- unrecoverable load error
  if (live.error && !matchesCsv) {
    return (
      <Shell state={state} live={live} onOpenCoach={undefined}>
        <div className="section">
          <div className="notice notice-error">
            <strong>Could not load the sheet</strong>
            {live.error.message}
            {live.error.attempts.length > 0 && (
              <ul>
                {live.error.attempts.map((a, i) => (
                  <li key={i} className="mono small">
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={live.refresh}>
              Try again
            </button>
            <button
              className="btn"
              onClick={() => setState((s) => ({ ...s, sheetId: null, gid: null, rosterGid: null }))}
            >
              Use a different sheet
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const fatal = dashboard ? sortIssues(dashboard.issues).filter((i) => i.severity === 'error') : [];
  const mappingFailed = fatal.some((i) => i.code === 'mapping-incomplete');
  const hasDates = Boolean(dashboard?.matches.some((m) => m.date !== null));

  return (
    <Shell
      state={state}
      live={live}
      isDemo={isDemo}
      onOpenCoach={state.coach ? () => setShowCoachPanel((v) => !v) : undefined}
      coachPanelOpen={showCoachPanel}
      onExitDemo={isDemo ? () => setState((s) => ({ ...s, sheetId: null })) : undefined}
      tick={tick}
    >
      {isDemo && (
        <div className="notice notice-info" style={{ marginTop: 16 }}>
          <strong>Demo data</strong>
          A simulated season for two ladders, so you can see every feature before connecting your
          own sheet.
        </div>
      )}

      {live.error && matchesCsv && (
        <div className="notice notice-warn" style={{ marginTop: 16 }}>
          <strong>Showing the last ladder that loaded</strong>
          {live.error.message}
        </div>
      )}

      {mappingFailed && dashboard && (
        <div className="notice notice-error" style={{ marginTop: 16 }}>
          <strong>The columns in this sheet were not recognised</strong>
          {fatal.map((i) => i.message).join(' ')}
          {!state.coach && ' Ask your coach to check the sheet layout.'}
          {state.coach && (
            <>
              {' '}
              <button className="btn btn-sm" onClick={() => setShowCoachPanel(true)}>
                Open column mapping
              </button>
            </>
          )}
        </div>
      )}

      {/* AC-1.1.1: ladder tabs. Both boards are already computed, so switching is instant. */}
      {boards.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Choose a ladder">
          {boards.map((board) => {
            const id = board.team ?? board.label;
            const active = board === activeBoard;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                className="tab"
                onClick={() => {
                  setSelectedTeam(id);
                  setSelectedKey(null);
                }}
              >
                {board.label}
              </button>
            );
          })}
        </div>
      )}

      {activeBoard && (
        <>
          <Spotlight
            leaders={activeBoard.leaders}
            movementWindowDays={state.config.movementWindowDays}
            hasDates={hasDates}
            onSelect={setSelectedKey}
          />

          <section className="section" aria-labelledby="standings-heading">
            <div className="section-head">
              <h2 id="standings-heading">
                {boards.length > 1 ? activeBoard.label : 'Standings'}
              </h2>
              <span className="section-note">
                {activeBoard.standings.length} players · {activeBoard.matches.length} matches
                {!hasDates && ' · add a Date column for movement arrows'}
              </span>
            </div>
            <Standings
              standings={activeBoard.standings}
              onSelect={(row) => setSelectedKey(row.key)}
              movementWindowDays={state.config.movementWindowDays}
            />
          </section>
        </>
      )}

      {/* Non-fatal data warnings are shown to everyone, briefly - a ladder built on a
          row the app could not read should say so, not just to the coach. */}
      {dashboard && !state.coach && dashboard.issues.length > 0 && !mappingFailed && (
        <div className="section">
          <details className="card panel">
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              {dashboard.issues.length} note{dashboard.issues.length === 1 ? '' : 's'} about this
              sheet&rsquo;s data
            </summary>
            <ul className="issue-list" style={{ marginTop: 10 }}>
              {sortIssues(dashboard.issues).slice(0, 12).map((issue, i) => (
                <li key={i} className="issue">
                  <span className="issue-row">{issue.sheetRow ? 'Row ' + issue.sheetRow : 'Note'}</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {state.coach && showCoachPanel && dashboard && (
        <section className="section" aria-labelledby="coach-heading">
          <div className="section-head">
            <h2 id="coach-heading">Coach console</h2>
            <button className="btn btn-sm" onClick={() => setShowCoachPanel(false)}>
              Hide
            </button>
          </div>
          <CoachPanel
            table={dashboard.table}
            mapping={dashboard.mapping}
            onMappingChange={(field: MatchField, index: number) =>
              setMappingOverride((m) => ({ ...m, [field]: index }))
            }
            config={state.config}
            onConfigChange={setConfig}
            issues={dashboard.issues}
            matches={dashboard.matches}
            displayNames={dashboard.displayNames}
            teamUrl={teamShareUrl(state, window.location.origin, window.location.pathname)}
            coachLinkUrl={coachUrl(state, window.location.origin, window.location.pathname)}
            sheetUrl={
              isDemo
                ? '#'
                : 'https://docs.google.com/spreadsheets/d/' + state.sheetId + '/edit'
            }
            refreshSeconds={state.refreshSeconds}
            onRefreshSecondsChange={(refreshSeconds) => setState((s) => ({ ...s, refreshSeconds }))}
          />
        </section>
      )}

      {selectedRow && activeBoard && dashboard && (
        <PlayerDrawer
          row={selectedRow}
          standings={activeBoard.standings}
          matches={activeBoard.matches}
          config={state.config}
          openChallenges={[]}
          now={isDemo ? new Date('2026-09-04T12:00:00Z') : new Date()}
          onClose={() => setSelectedKey(null)}
          onSelectPlayer={setSelectedKey}
        />
      )}

      <footer className="footer">
        <p>
          Ratings are computed from the results in this sheet using a USTA-modelled NTRP-style
          method. They are <strong>not</strong> official USTA NTRP ratings and should not be
          reported as such.
        </p>
        <p>
          Only the gaps between players carry meaning — the squad average is pinned to a fixed
          value because intra-team results cannot establish an absolute level.
        </p>
      </footer>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

interface ShellProps {
  state: AppState;
  live: ReturnType<typeof useLiveSheet> | null;
  children: React.ReactNode;
  isDemo?: boolean;
  onOpenCoach?: (() => void) | undefined;
  coachPanelOpen?: boolean;
  onExitDemo?: (() => void) | undefined;
  tick?: number;
}

function Shell({
  state,
  live,
  children,
  isDemo,
  onOpenCoach,
  coachPanelOpen,
  onExitDemo,
}: ShellProps) {
  const updated = live?.lastUpdated ?? null;
  const stale = Boolean(live?.error);

  return (
    <div className="app">
      <header className="masthead">
        <div className="shell">
          <div className="masthead-row">
            <div className="masthead-title">
              <h1>River Island High School · Tennis Ladder</h1>
              <p className="sub">
                {isDemo
                  ? 'Demo season'
                  : state.sheetId
                    ? 'Live from the team scores sheet'
                    : 'Team standings, straight from your scores sheet'}
              </p>
            </div>

            <div className="masthead-actions">
              {live && state.sheetId && !isDemo && (
                <span className="live" title={updated ? 'Last updated ' + updated.toLocaleTimeString() : undefined}>
                  <span
                    className={
                      'live-dot' + (stale ? ' stale' : live.refreshing ? ' pulsing' : '')
                    }
                  />
                  {live.refreshing
                    ? 'Updating…'
                    : updated
                      ? 'Updated ' + relativeTime(updated)
                      : 'Live'}
                </span>
              )}
              {live && state.sheetId && (
                <button
                  className="btn btn-sm btn-ghost-light"
                  onClick={live.refresh}
                  disabled={live.refreshing}
                >
                  Refresh
                </button>
              )}
              {onExitDemo && (
                <button className="btn btn-sm btn-ghost-light" onClick={onExitDemo}>
                  Use my sheet
                </button>
              )}
              {onOpenCoach && (
                <button className="btn btn-sm btn-ghost-light" onClick={onOpenCoach}>
                  {coachPanelOpen ? 'Close console' : 'Coach console'}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="shell">{children}</main>
    </div>
  );
}
