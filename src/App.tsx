/**
 * RIHS Tennis Ladder Dashboard.
 *
 * Architecture in one paragraph: the coach's Google Sheet is the database. Every
 * viewer's browser reads the sheet's CSV directly, rebuilds the ladders client-side, and
 * re-reads on a timer. On Vercel, one small function (api/ladder.js) stores which sheet
 * and settings make up the team's official ladder, and only the coach password can change
 * that. Everyone else opens the site's plain address and sees the published ladder, with
 * no accounts and no student data held anywhere but the coach's own Google Drive. Where
 * that function is not available, the settings travel in a shared link instead.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CoachPanel } from './components/CoachPanel';
import { CoachSignIn } from './components/CoachSignIn';
import { Setup } from './components/Setup';
import { formatDate, relativeTime } from './components/common';
import {
  DrawSheetLeaderboard,
  type DrawSheetDivision,
  type DrawSheetLeaderboardProps,
  type DrawSheetStatus,
  type MatchLogEntry,
  type UpcomingMatch,
} from './design/DrawSheetLeaderboard';
import { refFromSheetId, useLiveSheet } from './hooks/useLiveSheet';
import { usePublishedLadder } from './hooks/usePublishedLadder';
import { challengeOptions } from './lib/challenge';
import {
  coachUrl,
  DEFAULT_APP_STATE,
  DEFAULT_REFRESH_SECONDS,
  readAppState,
  recallSheet,
  rememberSheet,
  teamShareUrl,
  writeAppState,
  type AppState,
} from './lib/config';
import { buildDashboard, issueLocation, sortIssues } from './lib/dashboard';
import { rankTimeline } from './lib/ladder';
import {
  clearCoachSession,
  coachLogin,
  PublishError,
  publishHistory,
  publishLadder,
  readCoachSession,
  saveCoachSession,
  verifyCoachSession,
  type CoachSession,
  type PublishedLadder,
  type PublishingState,
} from './lib/publish';
import type { MatchField } from './lib/schema';
import { formatScoreFor } from './lib/score';
import { sheetEditUrl } from './lib/sheets';
import { sortChronologically } from './lib/stats';
import { DEFAULT_LADDER_CONFIG, type DataIssue, type LadderConfig, type StandingRow } from './lib/types';
import { DEMO_DOUBLES_CSV, DEMO_MATCHES_CSV, DEMO_ROSTER_CSV } from './demo-data';

const SCHOOL_NAME = 'River Island High School';

/** Demo mode is a sentinel sheet id, so the demo shares the exact live-data code path. */
const DEMO_ID = '__demo__';
/** Demo data is dated against a fixed season so it always reads as current. */
const DEMO_NOW = new Date('2026-09-04T12:00:00Z');
const DEMO_STATE: AppState = { ...DEFAULT_APP_STATE, config: { ...DEFAULT_LADDER_CONFIG }, sheetId: DEMO_ID };

/** Row errors shown above the coach's table; the rest are in the console. */
const INLINE_ERROR_LIMIT = 3;

const CLEARED_SHEET: Pick<AppState, 'sheetId' | 'gid' | 'rosterGid' | 'doublesGid' | 'mapping'> = {
  sheetId: null,
  gid: null,
  rosterGid: null,
  doublesGid: null,
  mapping: {},
};

const SETUP_HELP: Record<Exclude<PublishingState, 'ready'>, string> = {
  'needs-storage':
    'This site still needs its storage connected: in Vercel, open the project’s Storage tab, connect an Upstash Redis database, then redeploy.',
  'needs-password':
    'This site still needs a coach password: in Vercel, add an environment variable named COACH_PASSWORD, then redeploy.',
  'weak-password':
    'The coach password must be at least 10 characters. Change COACH_PASSWORD in Vercel, then redeploy.',
};

interface AsyncStatus {
  busy: boolean;
  error: string | null;
}
const IDLE: AsyncStatus = { busy: false, error: null };

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function App() {
  const site = usePublishedLadder();

  const [urlState, setUrlState] = useState<AppState>(() => readAppState(window.location.search));
  const [serverDemo, setServerDemo] = useState(() => new URLSearchParams(window.location.search).get('demo') === '1');
  /** The coach's unpublished edits to the published ladder (server mode). */
  const [draft, setDraft] = useState<AppState | null>(null);
  /** Settings changed while exploring the demo (server mode), kept apart from the draft. */
  const [demoDraft, setDemoDraft] = useState<AppState | null>(null);
  const [session, setSession] = useState<CoachSession | null>(() => readCoachSession());
  const [signInOpen, setSignInOpen] = useState(false);
  const [signIn, setSignIn] = useState<AsyncStatus>(IDLE);
  const [publishNote, setPublishNote] = useState('');
  const [publishStatus, setPublishStatus] = useState<AsyncStatus>(IDLE);
  const [history, setHistory] = useState<PublishedLadder[] | null>(null);
  const [historyStatus, setHistoryStatus] = useState<AsyncStatus>(IDLE);
  const [showCoachPanel, setShowCoachPanel] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const serverMode = site.api;
  const checking = site.phase === 'checking';
  // A link that carries its own sheet still works when the publishing check fails outright.
  const siteFailed = site.phase === 'error' && !urlState.sheetId;

  const publishedState = useMemo(() => (site.published ? readAppState(site.published.query) : null), [site.published]);
  const coach = serverMode ? session !== null : urlState.coach;

  // The settings being shown right now. In server mode the URL never chooses the sheet:
  // the published ladder is the only one a visitor can be shown, so nobody can pass off a
  // doctored sheet under the team's address.
  const view: AppState | null =
    checking || siteFailed
      ? null
      : !serverMode
        ? urlState
        : serverDemo
          ? (demoDraft ?? DEMO_STATE)
          : coach && draft
            ? draft
            : publishedState;
  const isDemo = view?.sheetId === DEMO_ID;

  // Keep the address bar in step: a full settings link in link mode, only the open
  // ladder tab (and the demo flag) in server mode.
  useEffect(() => {
    if (checking) return;
    let query: string;
    if (serverMode) {
      const params = new URLSearchParams();
      if (serverDemo) params.set('demo', '1');
      if (urlState.ladder) params.set('ladder', urlState.ladder);
      query = params.toString() ? '?' + params.toString() : '';
    } else {
      const base = writeAppState(urlState);
      query = base + (urlState.coach ? (base ? '&' : '?') + 'coach=1' : '');
      if (urlState.sheetId && urlState.sheetId !== DEMO_ID) rememberSheet(urlState);
    }
    const next = window.location.pathname + query;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [checking, serverMode, serverDemo, urlState]);

  // Tick every 30 seconds so the "updated 3m ago" label stays truthful.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // A remembered coach session is checked once the site is known to support publishing,
  // so a changed password signs old devices out.
  useEffect(() => {
    if (!serverMode || site.publishing !== 'ready' || !session) return;
    let cancelled = false;
    verifyCoachSession(session).then(
      (valid) => {
        if (!cancelled && !valid) {
          clearCoachSession();
          setSession(null);
        }
      },
      () => undefined, // offline: keep the session and let the next action decide
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode, site.publishing]);

  const live = useLiveSheet(
    view?.sheetId && !isDemo ? view.sheetId : null,
    view?.gid ?? null,
    view?.rosterGid ?? null,
    view?.doublesGid ?? null,
    view?.refreshSeconds ?? DEFAULT_REFRESH_SECONDS,
  );

  const matchesCsv = isDemo ? DEMO_MATCHES_CSV : live.matchesCsv;
  const rosterCsv = isDemo ? DEMO_ROSTER_CSV : live.rosterCsv;
  const doublesCsv = isDemo ? DEMO_DOUBLES_CSV : live.doublesCsv;
  const config = view?.config ?? DEFAULT_LADDER_CONFIG;
  const mappingOverride = view?.mapping;

  // Date-based rules (cooling-off, the movement window) are judged against today. Moving
  // that reference once a day is precise enough, and it keeps the ladder from being
  // rebuilt on every 30-second clock tick.
  const today = now.toDateString();
  const evaluatedAt = useMemo(() => (isDemo ? DEMO_NOW : new Date()), [isDemo, today]);

  const dashboard = useMemo(() => {
    if (!matchesCsv) return null;
    return buildDashboard({ matchesCsv, rosterCsv, doublesCsv, config, mappingOverride, now: evaluatedAt });
  }, [matchesCsv, rosterCsv, doublesCsv, config, mappingOverride, evaluatedAt]);

  const boards = dashboard?.boards ?? [];
  const activeBoard =
    boards.find((b) => b.id === urlState.ladder) ??
    // Older links name just the team.
    boards.find((b) => b.team === urlState.ladder && b.format === 'singles') ??
    boards[0] ??
    null;

  const nameFor = useCallback((key: string) => dashboard?.displayNames.get(key) ?? key, [dashboard]);

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
            config,
            openChallenges: dashboard.openChallenges,
            now: evaluatedAt,
          })
        : [],
    [activeBoard, dashboard, playedMatches, config, evaluatedAt],
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

  const rankHistoryFor = useCallback(
    (row: StandingRow) =>
      activeBoard && dashboard
        ? rankTimeline(
            activeBoard.matches,
            {
              matches: activeBoard.matches,
              roster: dashboard.roster,
              displayNames: dashboard.displayNames,
              config,
              now: evaluatedAt,
            },
            row.key,
          )
        : [],
    [activeBoard, dashboard, config, evaluatedAt],
  );

  const upcoming = useMemo((): UpcomingMatch[] => {
    if (!activeBoard || !dashboard) return [];
    const rankOf = new Map(activeBoard.standings.map((s) => [s.key, s.rank]));
    return dashboard.openChallenges
      .filter((c) => rankOf.has(c.challengerKey) || rankOf.has(c.defenderKey))
      .sort((a, b) => (a.createdAt?.getTime() ?? Infinity) - (b.createdAt?.getTime() ?? Infinity))
      .map((c) => ({
        challenger: nameFor(c.challengerKey),
        challengerRank: rankOf.get(c.challengerKey) ?? null,
        defender: nameFor(c.defenderKey),
        defenderRank: rankOf.get(c.defenderKey) ?? null,
        date: c.createdAt ? formatDate(c.createdAt) : null,
      }));
  }, [activeBoard, dashboard, nameFor]);

  const closeSignIn = useCallback(() => setSignInOpen(false), []);

  // ----------------------------------------------------------------- actions

  /** Apply a settings change: to the URL in link mode, to the coach's preview in server mode. */
  const updateView = (change: (s: AppState) => AppState) => {
    if (!serverMode) setUrlState(change);
    else if (serverDemo) setDemoDraft((d) => change(d ?? DEMO_STATE));
    else setDraft((d) => change(d ?? publishedState ?? DEFAULT_APP_STATE));
  };

  const setConfig = (patch: Partial<LadderConfig>) =>
    updateView((s) => ({ ...s, config: { ...s.config, ...patch } }));

  const connect = (sheetId: string, gid: string | null) => {
    if (!serverMode) {
      setUrlState((s) => ({ ...s, ...CLEARED_SHEET, sheetId, gid, coach: true, ladder: null }));
      return;
    }
    setServerDemo(false);
    setDraft((d) => ({ ...(d ?? publishedState ?? DEFAULT_APP_STATE), ...CLEARED_SHEET, sheetId, gid }));
    setUrlState((s) => ({ ...s, ladder: null }));
  };

  const chooseDifferentSheet = () => {
    if (!serverMode) {
      setUrlState((s) => ({ ...s, ...CLEARED_SHEET, ladder: null }));
      return;
    }
    setServerDemo(false);
    setDraft((d) => ({ ...(d ?? publishedState ?? DEFAULT_APP_STATE), ...CLEARED_SHEET }));
  };

  const startDemo = () => {
    if (!serverMode) {
      setUrlState((s) => ({ ...s, ...CLEARED_SHEET, sheetId: DEMO_ID, coach: true, ladder: null }));
      return;
    }
    setServerDemo(true);
    setDemoDraft(null);
    setUrlState((s) => ({ ...s, ladder: null }));
  };

  const exitDemo = () => {
    if (!serverMode) {
      chooseDifferentSheet();
      return;
    }
    setServerDemo(false);
    setDemoDraft(null);
    setUrlState((s) => ({ ...s, ladder: null }));
  };

  const openSignIn = () => {
    setSignIn(IDLE);
    setSignInOpen(true);
  };

  const submitSignIn = async (password: string) => {
    setSignIn({ busy: true, error: null });
    try {
      const next = await coachLogin(password);
      saveCoachSession(next);
      setSession(next);
      setSignIn(IDLE);
      setSignInOpen(false);
      setShowCoachPanel(true);
    } catch (err) {
      setSignIn({ busy: false, error: messageOf(err, 'Sign-in failed. Try again.') });
    }
  };

  const signOut = () => {
    clearCoachSession();
    setSession(null);
    setDraft(null);
    setShowCoachPanel(false);
    setHistory(null);
    setHistoryStatus(IDLE);
    setPublishStatus(IDLE);
  };

  /** A 401 means the token expired or the password changed. The preview is kept for after sign-in. */
  const endSession = () => {
    clearCoachSession();
    setSession(null);
    setSignIn({ busy: false, error: 'Your coach session has ended. Enter the password again to continue.' });
    setSignInOpen(true);
  };

  const publish = async () => {
    if (!session || !view?.sheetId || isDemo) return;
    setPublishStatus({ busy: true, error: null });
    try {
      const published = await publishLadder(session, writeAppState({ ...view, coach: false, ladder: null }), publishNote);
      site.setPublished(published);
      setDraft(null);
      setPublishNote('');
      setHistory(null);
      setPublishStatus(IDLE);
    } catch (err) {
      if (err instanceof PublishError && err.status === 401) {
        setPublishStatus(IDLE);
        endSession();
        return;
      }
      setPublishStatus({ busy: false, error: messageOf(err, 'Publishing failed. Try again.') });
    }
  };

  const loadHistory = async () => {
    if (!session) return;
    setHistoryStatus({ busy: true, error: null });
    try {
      setHistory(await publishHistory(session));
      setHistoryStatus(IDLE);
    } catch (err) {
      if (err instanceof PublishError && err.status === 401) {
        setHistoryStatus(IDLE);
        endSession();
        return;
      }
      setHistoryStatus({ busy: false, error: messageOf(err, 'The publish history could not be loaded.') });
    }
  };

  const restore = (entry: PublishedLadder) => {
    setServerDemo(false);
    setDraft(readAppState(entry.query));
    setUrlState((s) => ({ ...s, ladder: null }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const shell = (props: Partial<DrawSheetLeaderboardProps>) => (
    <DrawSheetLeaderboard
      teamName={SCHOOL_NAME}
      subtitle="Tennis Ladder"
      divisions={[]}
      activeDivisionId=""
      onSelectDivision={() => undefined}
      status="loading"
      lastSynced={null}
      now={now}
      matchLog={() => []}
      {...props}
    />
  );

  const signInDialog = signInOpen ? (
    <CoachSignIn busy={signIn.busy} error={signIn.error} onSubmit={submitSignIn} onClose={closeSignIn} />
  ) : null;

  // ---------------------------------------------------------------- checking
  if (checking) return shell({ status: 'loading' });

  if (siteFailed) {
    return shell({
      status: 'blocked',
      blockedTitle: 'Could not load the ladder',
      blockedMessage: <p>{site.error}</p>,
      blockedActions: (
        <>
          <button className="ds-text-link" onClick={site.refresh}>
            Try again
          </button>
          <button className="ds-text-link" onClick={startDemo}>
            See a demo
          </button>
        </>
      ),
    });
  }

  // ------------------------------------------------------------ no sheet yet
  if (!view?.sheetId) {
    if (serverMode && !coach) {
      const notReady = site.publishing && site.publishing !== 'ready' ? site.publishing : null;
      return shell({
        status: 'blocked',
        blockedTitle: notReady ? 'This ladder site is not set up yet' : 'The ladder has not been published yet',
        blockedMessage: (
          <p>
            {notReady
              ? SETUP_HELP[notReady]
              : 'Once your coach connects the team’s scores sheet and publishes it, the Boys and Girls ladders appear here.'}
          </p>
        ),
        blockedActions: (
          <>
            <button className="ds-text-link" onClick={startDemo}>
              See a demo
            </button>
            {site.publishing === 'ready' && (
              <button className="ds-text-link" onClick={openSignIn}>
                Coach sign-in
              </button>
            )}
          </>
        ),
        afterTable: signInDialog,
      });
    }

    const recalled = serverMode ? null : recallSheet();
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
            mode={serverMode ? 'server' : 'link'}
            onSubmit={connect}
            onTryDemo={startDemo}
            recalled={recalled?.sheetId ? { sheetId: recalled.sheetId, gid: recalled.gid } : null}
            onResume={recalled?.sheetId ? () => setUrlState((s) => ({ ...recalled, coach: s.coach })) : undefined}
            onCancel={serverMode && site.published ? () => setDraft(null) : undefined}
          />
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------ leaderboard
  const sheetId = view.sheetId;
  const allIssues = dashboard ? sortIssues(dashboard.issues) : [];
  const mappingIssues = allIssues.filter((i) => i.code === 'mapping-incomplete');
  const mappingFailed = mappingIssues.length > 0;
  const isFirstLoad = live.loading && !matchesCsv;
  const isLoadError = Boolean(live.error) && !matchesCsv;

  let status: DrawSheetStatus = 'ready';
  if (isFirstLoad) status = 'loading';
  else if (isLoadError || mappingFailed) status = 'blocked';

  const publishedQuery = publishedState ? writeAppState(publishedState) : null;
  const viewQuery = isDemo ? null : writeAppState({ ...view, coach: false, ladder: null });
  const unpublished = serverMode && coach && viewQuery !== null && viewQuery !== publishedQuery;

  const discardAction =
    unpublished && site.published ? (
      <button className="ds-text-link" onClick={() => setDraft(null)}>
        Discard changes
      </button>
    ) : null;

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
        {coach && (
          <button className="ds-text-link" onClick={chooseDifferentSheet}>
            Use a different sheet
          </button>
        )}
        {discardAction}
      </>
    );
  } else if (mappingFailed) {
    blockedTitle = 'The columns in this sheet were not recognized';
    blockedMessage = (
      <p>
        {mappingIssues.map((i) => i.message).join(' ')}
        {!coach && ' Ask your coach to check the sheet layout.'}
      </p>
    );
    blockedActions = coach ? (
      <>
        <button className="ds-text-link" onClick={() => setShowCoachPanel(true)}>
          Open column mapping
        </button>
        {discardAction}
      </>
    ) : null;
  }

  // Ladder tabs are per team; boards for the same team differ only by format.
  const hasSingles = (group: string) => boards.some((b) => (b.team ?? 'all') === group && b.format === 'singles');
  const divisions: DrawSheetDivision[] = boards.map((b) => {
    const group = b.team ?? 'all';
    return {
      id: b.id,
      label: b.label,
      standings: b.standings,
      leaders: b.leaders,
      group,
      groupLabel: hasSingles(group) ? (b.team ? b.team + ' Ladder' : 'Team Ladder') : b.label,
      format: b.format,
    };
  });

  const dataNotes = allIssues.filter((i) => i.code !== 'mapping-incomplete');
  const rowErrors = dataNotes.filter((i) => i.severity === 'error');
  // The coach sees the first few unreadable rows right above the table. Teammates get
  // one collapsed summary instead, so a messy sheet never buries the ladder on a phone.
  const inlineIssues: DataIssue[] = coach ? rowErrors.slice(0, INLINE_ERROR_LIMIT) : [];
  const hiddenErrors = coach ? rowErrors.length - inlineIssues.length : 0;

  const notices: ReactNode[] = [];
  if (isDemo) {
    notices.push(
      <Notice key="demo" label="Demo data">
        A simulated season for Boys and Girls singles and doubles, so you can see every feature
        before a real sheet is connected.
      </Notice>,
    );
  }
  if (site.offline) {
    notices.push(
      <Notice key="offline" label="Showing the last ladder saved on this device">
        {site.error} Your coach&rsquo;s latest updates will appear when the site can be reached.
      </Notice>,
    );
  }
  if (live.error && matchesCsv) {
    notices.push(
      <Notice key="stale" label="Showing the last ladder that loaded">
        {live.error.message}
      </Notice>,
    );
  }
  if (coach && live.rosterError) {
    notices.push(
      <Notice key="roster" label="The Roster tab could not be read">
        {live.rosterError.message} The ladder is shown without roster details. Check the Roster tab
        in the Coach console.
      </Notice>,
    );
  }
  if (coach && live.doublesError) {
    notices.push(
      <Notice key="doubles" label="The Doubles tab could not be read">
        {live.doublesError.message} Doubles ladders are hidden until it loads. Check the Doubles tab in
        the Coach console.
      </Notice>,
    );
  }
  if (unpublished) {
    notices.push(
      <PublishBar
        key="publish"
        published={site.published}
        now={now}
        note={publishNote}
        onNoteChange={setPublishNote}
        status={publishStatus}
        onPublish={publish}
        onDiscard={site.published ? () => setDraft(null) : null}
      />,
    );
  }

  const headerActions = (
    <>
      {!isDemo && (
        <button onClick={live.refresh} disabled={live.refreshing}>
          {live.refreshing ? 'Updating…' : 'Refresh'}
        </button>
      )}
      {isDemo && <button onClick={exitDemo}>{serverMode ? 'Exit demo' : 'Use my sheet'}</button>}
      {coach && (
        <button onClick={() => setShowCoachPanel((v) => !v)} aria-expanded={showCoachPanel}>
          {showCoachPanel ? 'Close console' : 'Coach console'}
        </button>
      )}
      {serverMode && !coach && site.publishing === 'ready' && <button onClick={openSignIn}>Coach</button>}
    </>
  );

  const errorCount = rowErrors.length;
  const notesSummary =
    plural(dataNotes.length, 'note') +
    ' about this sheet’s data' +
    (errorCount > 0
      ? ', including ' + plural(errorCount, 'problem') + ' that kept a row out of the ladder'
      : '');

  const origin = window.location.origin;
  const pathname = window.location.pathname;

  const coachConsole =
    coach && showCoachPanel && dashboard ? (
      <div className="ds-coach-console">
        <div className="ds-coach-console-head">
          <p className="ds-notice-label">Coach console</p>
          <button className="ds-text-link" onClick={() => setShowCoachPanel(false)}>
            Hide
          </button>
        </div>
        <CoachPanel
          mode={serverMode ? 'server' : 'link'}
          table={dashboard.table}
          mapping={dashboard.mapping}
          onMappingChange={(field: MatchField, index: number) =>
            updateView((s) => ({ ...s, mapping: { ...s.mapping, [field]: index } }))
          }
          config={config}
          onConfigChange={setConfig}
          issues={dashboard.issues}
          matches={dashboard.matches}
          openChallenges={dashboard.openChallenges}
          displayNames={dashboard.displayNames}
          teamUrl={serverMode ? origin + pathname : teamShareUrl(view, origin, pathname)}
          coachLinkUrl={serverMode ? null : coachUrl(view, origin, pathname)}
          sheetUrl={isDemo ? null : sheetEditUrl(refFromSheetId(sheetId, view.gid))}
          sheetId={sheetId}
          matchesGid={view.gid}
          isDemo={isDemo}
          rosterGid={view.rosterGid}
          rosterError={live.rosterError?.message ?? null}
          onRosterGidChange={(rosterGid) => updateView((s) => ({ ...s, rosterGid }))}
          doublesGid={view.doublesGid}
          doublesError={live.doublesError?.message ?? null}
          onDoublesGidChange={(doublesGid) => updateView((s) => ({ ...s, doublesGid }))}
          refreshSeconds={view.refreshSeconds}
          onRefreshSecondsChange={(refreshSeconds) => updateView((s) => ({ ...s, refreshSeconds }))}
          published={site.published}
          history={history}
          historyLoading={historyStatus.busy}
          historyError={historyStatus.error}
          onLoadHistory={loadHistory}
          onRestore={restore}
          onSignOut={serverMode ? signOut : null}
          now={now}
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

      {status === 'ready' && !coach && dataNotes.length > 0 && (
        <details className="ds-more-notes">
          <summary>{notesSummary}</summary>
          <ul>
            {dataNotes.slice(0, 20).map((issue, i) => {
              const where = issueLocation(issue);
              return <li key={i}>{(where ? where + ': ' : '') + issue.message}</li>;
            })}
          </ul>
        </details>
      )}

      {/* The console stays reachable when the sheet is blocked - column mapping is the fix. */}
      {coachConsole}
      {signInDialog}

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
      activeDivisionId={activeBoard?.id ?? ''}
      onSelectDivision={(ladder) => setUrlState((s) => ({ ...s, ladder }))}
      status={status}
      lastSynced={isDemo ? null : live.lastUpdated}
      now={now}
      staleAfterMinutes={15}
      headerActions={headerActions}
      banner={status === 'ready' && notices.length > 0 ? <>{notices}</> : null}
      issues={status === 'ready' ? inlineIssues : []}
      matchLog={matchLog}
      challengeOptions={optionsFor}
      openChallengeFor={openChallengeFor}
      rankHistoryFor={rankHistoryFor}
      upcoming={upcoming}
      challengeRange={config.challengeRange}
      movementWindowDays={config.movementWindowDays}
      minMatchesForRating={config.minMatchesForRating}
      hasDates={dashboard?.hasDates ?? false}
      orderedBy={config.ladderMode}
      blockedTitle={blockedTitle}
      blockedMessage={blockedMessage}
      blockedActions={blockedActions}
      afterTable={afterTable}
    />
  );
}

function Notice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ds-notice">
      <p className="ds-notice-label">{label}</p>
      <p>{children}</p>
    </div>
  );
}

/** The coach's "you are previewing, publish when ready" bar. */
function PublishBar({
  published,
  now,
  note,
  onNoteChange,
  status,
  onPublish,
  onDiscard,
}: {
  published: PublishedLadder | null;
  now: Date;
  note: string;
  onNoteChange: (note: string) => void;
  status: AsyncStatus;
  onPublish: () => void;
  onDiscard: (() => void) | null;
}) {
  return (
    <div className="ds-notice ds-publish">
      <p className="ds-notice-label">{published ? 'Unpublished changes' : 'Not published yet'}</p>
      <p>
        {published
          ? 'Only you can see these changes. The team still sees the version published ' +
            relativeTime(new Date(published.publishedAt), now) +
            '.'
          : 'Only you can see this ladder. Publish it and the whole team sees it at this site’s address.'}
      </p>
      <form
        className="ds-publish-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!status.busy) onPublish();
        }}
      >
        <label className="ds-sr-only" htmlFor="publish-note">
          Note for the publish history (optional)
        </label>
        <input
          id="publish-note"
          type="text"
          value={note}
          maxLength={200}
          placeholder="Note (optional), e.g. Added the Roster tab"
          onChange={(e) => onNoteChange(e.target.value)}
        />
        <button type="submit" className="ds-button is-primary" disabled={status.busy}>
          {status.busy ? 'Publishing…' : 'Publish to team'}
        </button>
        {onDiscard && (
          <button type="button" className="ds-button" onClick={onDiscard} disabled={status.busy}>
            Discard
          </button>
        )}
      </form>
      {status.error && (
        <p className="ds-error-text" role="alert">
          {status.error}
        </p>
      )}
    </div>
  );
}
