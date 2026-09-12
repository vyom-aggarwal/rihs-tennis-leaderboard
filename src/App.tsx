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
import { refFromSheetId, useLiveSheet } from './hooks/useLiveSheet';
import { challengeOptions } from './lib/challenge';
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
import type { MatchField } from './lib/schema';
import { formatScoreFor } from './lib/score';
import { sheetEditUrl } from './lib/sheets';
import { sortChronologically } from './lib/stats';
import type { DataIssue, LadderConfig, StandingRow } from './lib/types';
import { DEMO_MATCHES_CSV, DEMO_ROSTER_CSV } from './demo-data';

const SCHOOL_NAME = 'River Island High School';

/** Demo mode is a sentinel sheet id, so the demo shares the exact live-data code path. */
const DEMO_ID = '__demo__';
/** Demo data is dated against a fixed season so it always reads as current. */
const DEMO_NOW = new Date('2026-09-04T12:00:00Z');

/** Row errors shown above the coach's table; the rest are in the console. */
const INLINE_ERROR_LIMIT = 3;

const CLEARED_SHEET: Pick<AppState, 'sheetId' | 'gid' | 'rosterGid' | 'mapping' | 'ladder'> = {
  sheetId: null,
  gid: null,
  rosterGid: null,
  mapping: {},
  ladder: null,
};

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');

export default function App() {
  const [state, setState] = useState<AppState>(() => readAppState(window.location.search));
  const [showCoachPanel, setShowCoachPanel] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const isDemo = state.sheetId === DEMO_ID;
  const recalled = useMemo(() => recallSheet(), []);

  // Keep the address bar in step with app state so the link is always shareable.
  useEffect(() => {
    const base = writeAppState(state);
    const query = base + (state.coach ? (base ? '&' : '?') + 'coach=1' : '');
    const next = window.location.pathname + query;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
    if (state.sheetId && !isDemo) rememberSheet(state);
  }, [state, isDemo]);

  // Tick every 30 seconds so the "updated 3m ago" label stays truthful.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
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

  // Date-based rules (cooling-off, the movement window) are judged against today. Moving
  // that reference once a day is precise enough, and it keeps the ladder from being
  // rebuilt on every 30-second clock tick.
  const today = now.toDateString();
  const evaluatedAt = useMemo(() => (isDemo ? DEMO_NOW : new Date()), [isDemo, today]);

  const dashboard = useMemo(() => {
    if (!matchesCsv) return null;
    return buildDashboard({
      matchesCsv,
      rosterCsv,
      config: state.config,
      mappingOverride: state.mapping,
      now: evaluatedAt,
    });
  }, [matchesCsv, rosterCsv, state.config, state.mapping, evaluatedAt]);

  const boards = dashboard?.boards ?? [];
  const activeBoard =
    boards.find((b) => (b.team ?? b.label) === state.ladder) ?? boards[0] ?? null;

  const setConfig = useCallback((patch: Partial<LadderConfig>) => {
    setState((s) => ({ ...s, config: { ...s.config, ...patch } }));
  }, []);

  const connect = useCallback((sheetId: string, gid: string | null) => {
    setState((s) => ({ ...s, ...CLEARED_SHEET, sheetId, gid, coach: true }));
  }, []);

  const nameFor = useCallback(
    (key: string) => dashboard?.displayNames.get(key) ?? key,
    [dashboard],
  );

  const matchLog = useCallback(
    (row: StandingRow): MatchLogEntry[] => {
      if (!activeBoard) return [];
      return sortChronologically(
        activeBoard.matches.filter((m) => m.playerA === row.key || m.playerB === row.key),
      )
        .reverse()
        .slice(0, 8)
        .map((m) => {
          const isA = m.playerA === row.key;
          const retired = /\b(ret(ired|\.)?|rtd)(?=\W|$)/i.test(m.score.raw);
          return {
            date: formatDate(m.date),
            opponent: nameFor(isA ? m.playerB : m.playerA),
            // Written from this player's side, so a win never reads as "3-6, 2-6".
            score: formatScoreFor(m.score, isA ? 'a' : 'b') + (retired ? ' ret.' : ''),
            result: m.winner === (isA ? 'a' : 'b') ? 'W' : 'L',
            pending: m.approval === 'Pending',
          };
        });
    },
    [activeBoard, nameFor],
  );

  // A pair who played recently is in cooling-off whether or not the coach has verified
  // that result yet; only a rejected result does not count as having played.
  const playedMatches = useMemo(
    () => dashboard?.matches.filter((m) => m.approval !== 'Rejected') ?? [],
    [dashboard],
  );

  const optionsFor = useCallback(
    (row: StandingRow) =>
      activeBoard && dashboard
        ? challengeOptions({
            challengerKey: row.key,
            standings: activeBoard.standings,
            matches: playedMatches,
            config: state.config,
            openChallenges: dashboard.openChallenges,
            now: evaluatedAt,
          })
        : [],
    [activeBoard, dashboard, playedMatches, state.config, evaluatedAt],
  );

  const openChallengeFor = useCallback(
    (row: StandingRow): string | null => {
      const open = dashboard?.openChallenges.find(
        (c) => c.challengerKey === row.key || c.defenderKey === row.key,
      );
      if (!open) return null;
      const isChallenger = open.challengerKey === row.key;
      const other = nameFor(isChallenger ? open.defenderKey : open.challengerKey);
      return (
        (isChallenger ? 'challenged ' : 'challenged by ') +
        other +
        (open.createdAt ? ' on ' + formatDate(open.createdAt) : '') +
        '. It stays open until the score is entered in the sheet.'
      );
    },
    [dashboard, nameFor],
  );

  // ------------------------------------------------------------------ setup
  if (!state.sheetId) {
    return (
      <div className="app">
        <header className="masthead">
          <div className="shell">
            <div className="masthead-row">
              <div className="masthead-title">
                <h1>{SCHOOL_NAME} · Tennis Ladder</h1>
                <p className="sub">Team standings, straight from your scores sheet</p>
              </div>
            </div>
          </div>
        </header>
        <main className="shell">
          <Setup
            onSubmit={connect}
            onTryDemo={() => setState((s) => ({ ...s, ...CLEARED_SHEET, sheetId: DEMO_ID, coach: true }))}
            recalled={recalled?.sheetId ? { sheetId: recalled.sheetId, gid: recalled.gid } : null}
            onResume={recalled?.sheetId ? () => setState((s) => ({ ...recalled, coach: s.coach })) : undefined}
          />
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ leaderboard
  const allIssues = dashboard ? sortIssues(dashboard.issues) : [];
  const mappingIssues = allIssues.filter((i) => i.code === 'mapping-incomplete');
  const mappingFailed = mappingIssues.length > 0;
  const isFirstLoad = live.loading && !matchesCsv;
  const isLoadError = Boolean(live.error) && !matchesCsv;

  let status: DrawSheetStatus = 'ready';
  if (isFirstLoad) status = 'loading';
  else if (isLoadError || mappingFailed) status = 'blocked';

  const useDifferentSheet = () => setState((s) => ({ ...s, ...CLEARED_SHEET }));

  let blockedTitle: string | undefined;
  let blockedMessage: ReactNode = null;
  let blockedActions: ReactNode = null;

  if (isLoadError && live.error) {
    blockedTitle = 'Could not load the sheet';
    blockedMessage = (
      <>
        <p>{live.error.message}</p>
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
        {state.coach && (
          <button className="ds-text-link" onClick={useDifferentSheet}>
            Use a different sheet
          </button>
        )}
      </>
    );
  } else if (mappingFailed) {
    blockedTitle = 'The columns in this sheet were not recognized';
    blockedMessage = (
      <p>
        {mappingIssues.map((i) => i.message).join(' ')}
        {!state.coach && ' Ask your coach to check the sheet layout.'}
      </p>
    );
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
    leaders: b.leaders,
  }));
  const activeDivisionId = activeBoard ? (activeBoard.team ?? activeBoard.label) : '';

  const dataNotes = allIssues.filter((i) => i.code !== 'mapping-incomplete');
  const rowErrors = dataNotes.filter((i) => i.severity === 'error');
  // The coach sees the first few unreadable rows right above the table. Teammates get
  // one collapsed summary instead, so a messy sheet never buries the ladder on a phone.
  const inlineIssues: DataIssue[] = state.coach ? rowErrors.slice(0, INLINE_ERROR_LIMIT) : [];
  const hiddenErrors = state.coach ? rowErrors.length - inlineIssues.length : 0;

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
  } else if (state.coach && live.rosterError) {
    banner = (
      <div className="ds-notice">
        <p className="ds-notice-label">The Roster tab could not be read</p>
        <p>
          {live.rosterError.message} The ladder is shown without roster details. Check the Roster
          tab setting in the Coach console.
        </p>
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
      {isDemo && <button onClick={useDifferentSheet}>Use my sheet</button>}
      {state.coach && (
        <button onClick={() => setShowCoachPanel((v) => !v)} aria-expanded={showCoachPanel}>
          {showCoachPanel ? 'Close console' : 'Coach console'}
        </button>
      )}
    </>
  );

  const errorCount = rowErrors.length;
  const notesSummary =
    plural(dataNotes.length, 'note') +
    ' about this sheet’s data' +
    (errorCount > 0
      ? ', including ' + plural(errorCount, 'problem') + ' that kept a row out of the ladder'
      : '');

  const coachConsole =
    state.coach && showCoachPanel && dashboard ? (
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
            setState((s) => ({ ...s, mapping: { ...s.mapping, [field]: index } }))
          }
          config={state.config}
          onConfigChange={setConfig}
          issues={dashboard.issues}
          matches={dashboard.matches}
          openChallenges={dashboard.openChallenges}
          displayNames={dashboard.displayNames}
          teamUrl={teamShareUrl(state, window.location.origin, window.location.pathname)}
          coachLinkUrl={coachUrl(state, window.location.origin, window.location.pathname)}
          sheetUrl={isDemo ? null : sheetEditUrl(refFromSheetId(state.sheetId, state.gid))}
          sheetId={state.sheetId}
          matchesGid={state.gid}
          isDemo={isDemo}
          rosterGid={state.rosterGid}
          rosterError={live.rosterError?.message ?? null}
          onRosterGidChange={(rosterGid) => setState((s) => ({ ...s, rosterGid }))}
          refreshSeconds={state.refreshSeconds}
          onRefreshSecondsChange={(refreshSeconds) => setState((s) => ({ ...s, refreshSeconds }))}
        />
      </div>
    ) : null;

  const afterTable = (
    <>
      {status === 'ready' && hiddenErrors > 0 && !showCoachPanel && (
        <p className="ds-more-notes">
          {plural(hiddenErrors, 'more row problem')} listed in Coach console → Data health.
        </p>
      )}

      {status === 'ready' && !state.coach && dataNotes.length > 0 && (
        <details className="ds-more-notes">
          <summary>{notesSummary}</summary>
          <ul>
            {dataNotes.slice(0, 20).map((issue, i) => (
              <li key={i}>{(issue.sheetRow ? 'Row ' + issue.sheetRow + ': ' : '') + issue.message}</li>
            ))}
          </ul>
        </details>
      )}

      {/* The console stays reachable when the sheet is blocked - column mapping is the fix. */}
      {coachConsole}

      {status === 'ready' && (
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
      )}
    </>
  );

  return (
    <DrawSheetLeaderboard
      teamName={SCHOOL_NAME}
      subtitle="Tennis Ladder"
      divisions={divisions}
      activeDivisionId={activeDivisionId}
      onSelectDivision={(ladder) => setState((s) => ({ ...s, ladder }))}
      status={status}
      lastSynced={isDemo ? null : live.lastUpdated}
      now={now}
      staleAfterMinutes={15}
      headerActions={headerActions}
      banner={status === 'ready' ? banner : null}
      issues={status === 'ready' ? inlineIssues : []}
      matchLog={matchLog}
      challengeOptions={optionsFor}
      openChallengeFor={openChallengeFor}
      challengeRange={state.config.challengeRange}
      movementWindowDays={state.config.movementWindowDays}
      minMatchesForRating={state.config.minMatchesForRating}
      hasDates={dashboard?.hasDates ?? false}
      orderedBy={state.config.ladderMode}
      blockedTitle={blockedTitle}
      blockedMessage={blockedMessage}
      blockedActions={blockedActions}
      afterTable={afterTable}
    />
  );
}
