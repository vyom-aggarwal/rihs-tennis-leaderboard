/**
 * RIHS Tennis Ladder Dashboard.
 *
 * Architecture in one paragraph: the coach's Google Sheet is the database. This app is
 * a static page that reads the sheet's published CSV directly from the browser, rebuilds
 * the ladder client-side, and re-reads on a timer. There is no server, no login and no
 * copy of the roster held anywhere but the coach's own Google Drive, which is what makes
 * it free to run and impossible to get out of sync with the coach's records.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CoachPanel } from './components/CoachPanel';
import { Setup } from './components/Setup';
import { formatDate } from './components/common';
import {
  DrawSheetLeaderboard,
  type DrawSheetDivision,
  type DrawSheetStatus,
  type MatchLogEntry,
} from './design/DrawSheetLeaderboard';
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
  const [showCoachPanel, setShowCoachPanel] = useState(false);
  const [mappingOverride, setMappingOverride] = useState<Partial<MatchMapping>>({});
  // Ticks once a minute purely to force a re-render, so the "updated 3m ago" label stays truthful.
  const [, setTick] = useState(0);

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

  const setConfig = useCallback((patch: Partial<LadderConfig>) => {
    setState((s) => ({ ...s, config: { ...s.config, ...patch } }));
  }, []);

  const connect = useCallback((sheetId: string, gid: string | null) => {
    setState((s) => ({ ...s, sheetId, gid, coach: true }));
    setMappingOverride({});
    setSelectedTeam(null);
  }, []);

  const matchLog = useCallback(
    (row: StandingRow): MatchLogEntry[] => {
      if (!activeBoard) return [];
      return activeBoard.matches
        .filter((m) => m.playerA === row.key || m.playerB === row.key)
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
        .slice(0, 8)
        .map((m) => {
          const isA = m.playerA === row.key;
          const won = (isA && m.winner === 'a') || (!isA && m.winner === 'b');
          return {
            date: formatDate(m.date),
            opponent: isA ? m.displayB : m.displayA,
            score: m.score.raw,
            result: won ? 'W' : ('L' as const),
          };
        });
    },
    [activeBoard],
  );

  // ------------------------------------------------------------------ setup
  if (!state.sheetId) {
    return (
      <div className="app">
        <header className="masthead">
          <div className="shell">
            <div className="masthead-row">
              <div className="masthead-title">
                <h1>River Islands High School · Tennis Ladder</h1>
                <p className="sub">Team standings, straight from your scores sheet</p>
              </div>
            </div>
          </div>
        </header>
        <main className="shell">
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
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ leaderboard
  const fatal = dashboard ? sortIssues(dashboard.issues).filter((i) => i.severity === 'error') : [];
  const mappingFailed = fatal.some((i) => i.code === 'mapping-incomplete');
  const isFirstLoad = live.loading && !matchesCsv;
  const isLoadError = Boolean(live.error) && !matchesCsv;

  let status: DrawSheetStatus = 'ready';
  if (isFirstLoad) status = 'loading';
  else if (isLoadError || mappingFailed) status = 'blocked';

  let blockedTitle: string | undefined;
  let blockedMessage: ReactNode = null;
  let blockedActions: ReactNode = null;

  if (isLoadError && live.error) {
    blockedTitle = 'Could not load the sheet';
    blockedMessage = (
      <>
        {live.error.message}
        {live.error.attempts.length > 0 && (
          <ul className="ds-attempts">
            {live.error.attempts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </>
    );
    blockedActions = (
      <>
        <button className="ds-text-link" onClick={live.refresh}>
          Try again
        </button>
        <button
          className="ds-text-link"
          onClick={() => setState((s) => ({ ...s, sheetId: null, gid: null, rosterGid: null }))}
        >
          Use a different sheet
        </button>
      </>
    );
  } else if (mappingFailed) {
    blockedTitle = 'The columns in this sheet were not recognized';
    blockedMessage =
      fatal.map((i) => i.message).join(' ') +
      (!state.coach ? ' Ask your coach to check the sheet layout.' : '');
    blockedActions = state.coach ? (
      <button className="ds-text-link" onClick={() => setShowCoachPanel(true)}>
        Open column mapping
      </button>
    ) : null;
  }

  const divisions: DrawSheetDivision[] = boards.map((b) => ({
    id: b.team ?? b.label,
    label: b.label,
    standings: b.standings,
  }));
  const activeDivisionId = activeBoard ? (activeBoard.team ?? activeBoard.label) : '';

  const allIssues = dashboard ? sortIssues(dashboard.issues) : [];
  const visibleIssues = allIssues.filter((i) => i.severity === 'error' && i.code !== 'mapping-incomplete');
  const collapsedIssues = allIssues.filter((i) => i.severity === 'warning');

  let banner: ReactNode = null;
  if (isDemo) {
    banner = (
      <div className="ds-notice">
        <p className="ds-notice-label">Demo data</p>
        <p>
          A simulated season for two ladders, so you can see every feature before connecting your
          own sheet.
        </p>
      </div>
    );
  } else if (live.error && matchesCsv) {
    banner = (
      <div className="ds-notice">
        <p className="ds-notice-label">Showing the last ladder that loaded</p>
        <p>{live.error.message}</p>
      </div>
    );
  }

  const headerActions = (
    <>
      {!isDemo && (
        <button onClick={live.refresh} disabled={live.refreshing}>
          {live.refreshing ? 'Updating…' : 'Refresh'}
        </button>
      )}
      {isDemo && (
        <button onClick={() => setState((s) => ({ ...s, sheetId: null }))}>Use my sheet</button>
      )}
      {state.coach && (
        <button onClick={() => setShowCoachPanel((v) => !v)}>
          {showCoachPanel ? 'Close console' : 'Coach console'}
        </button>
      )}
    </>
  );

  const afterTable =
    status === 'ready' ? (
      <>
        {!state.coach && collapsedIssues.length > 0 && (
          <details className="ds-more-notes">
            <summary>
              {collapsedIssues.length} more note{collapsedIssues.length === 1 ? '' : 's'} about this
              sheet&rsquo;s data
            </summary>
            <ul>
              {collapsedIssues.slice(0, 12).map((issue, i) => (
                <li key={i}>{(issue.sheetRow ? 'Row ' + issue.sheetRow + ': ' : '') + issue.message}</li>
              ))}
            </ul>
          </details>
        )}

        {state.coach && showCoachPanel && dashboard && (
          <div className="ds-coach-console">
            <div className="ds-coach-console-head">
              <p className="ds-notice-label">Coach console</p>
              <button className="ds-text-link" onClick={() => setShowCoachPanel(false)}>
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
                isDemo ? '#' : 'https://docs.google.com/spreadsheets/d/' + state.sheetId + '/edit'
              }
              refreshSeconds={state.refreshSeconds}
              onRefreshSecondsChange={(refreshSeconds) => setState((s) => ({ ...s, refreshSeconds }))}
            />
          </div>
        )}

        <div className="ds-footnote">
          <p>
            Ratings are computed from the results in this sheet using a USTA-modeled NTRP-style
            method. They are <strong>not</strong> official USTA NTRP ratings and should not be
            reported as such.
          </p>
          <p>
            Only the gaps between players carry meaning — the squad average is pinned to a fixed
            value because intra-team results cannot establish an absolute level.
          </p>
        </div>
      </>
    ) : null;

  return (
    <DrawSheetLeaderboard
      teamName="River Islands High School"
      subtitle="Tennis Ladder"
      divisions={divisions}
      activeDivisionId={activeDivisionId}
      onSelectDivision={setSelectedTeam}
      status={status}
      lastSynced={isDemo ? null : live.lastUpdated}
      now={new Date()}
      staleAfterMinutes={15}
      headerActions={headerActions}
      banner={status === 'ready' ? banner : null}
      issues={status === 'ready' ? visibleIssues : []}
      matchLog={matchLog}
      blockedTitle={blockedTitle}
      blockedMessage={blockedMessage}
      blockedActions={blockedActions}
      afterTable={afterTable}
    />
  );
}
