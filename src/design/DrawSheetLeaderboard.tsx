/**
 * Draw-sheet leaderboard - the team-facing ladder page.
 *
 * Modeled on a printed tournament draw sheet: the table is the heart of the page, and
 * hairline rules stand in for cards and borders. There is no login, so nothing on the
 * page is scoped to "you". Nothing here reads from src/lib directly; it takes the real
 * StandingRow / Leaders / ChallengeOption shapes as props, which is what lets the design
 * preview harness render it from hand-written sample data.
 *
 * What the coach's requirements put on this page, and where:
 *   AC-1.1.1-3  ladder tabs, with a solid underline on the active tab
 *   AC-1.2.1    rank, avatar, name, grade, division, status and movement on every row
 *   AC-1.2.3    distinct Available / Challenge Pending / Injury Hold badges
 *   PRD 6.2     top-three spotlight plus Most Wins, Longest Active Streak and Top Climber
 *   AC-2.1.1-2  each player's expanded row lists who they may challenge, and why not
 */

import { useEffect, useState, type ReactNode } from 'react';
import { initials, relativeTime } from '../components/common';
import type { ChallengeOption } from '../lib/challenge';
import type { LeaderEntry, Leaders } from '../lib/leaders';
import type { DataIssue, DisplayStatus, StandingRow } from '../lib/types';
import './draw-sheet.css';

export interface MatchLogEntry {
  date: string;
  opponent: string;
  score: string;
  result: 'W' | 'L';
  /** Awaiting coach verification. */
  pending?: boolean;
}

export interface DrawSheetDivision {
  id: string;
  label: string;
  standings: StandingRow[];
  /** Spotlight and performance leaderboards for this ladder (PRD 6.2). */
  leaders?: Leaders;
}

export type DrawSheetStatus = 'ready' | 'loading' | 'empty' | 'blocked';

export interface DrawSheetLeaderboardProps {
  teamName: string;
  subtitle?: string;
  divisions: DrawSheetDivision[];
  activeDivisionId: string;
  onSelectDivision: (id: string) => void;
  status: DrawSheetStatus;
  lastSynced: Date | null;
  now: Date;
  /** Minutes after which the sync line reads as stale. Defaults to 15. */
  staleAfterMinutes?: number;
  /** Small text actions (refresh, coach console, ...) shown next to the sync line. */
  headerActions?: ReactNode;
  /** A contextual notice (demo mode, showing stale data) shown above the table. */
  banner?: ReactNode;
  /** Named, row-level data issues worth surfacing - each becomes its own quiet notice. */
  issues?: DataIssue[];
  matchLog: (row: StandingRow) => MatchLogEntry[];
  /** Everyone above a player, with eligibility (AC-2.1.1). Omit to hide the challenge list. */
  challengeOptions?: (row: StandingRow) => ChallengeOption[];
  /** A one-line description of a player's open challenge, or null when they have none. */
  openChallengeFor?: (row: StandingRow) => string | null;
  /** Spots ahead a player may challenge. Defaults to 3. */
  challengeRange?: number;
  /** Window behind the movement arrows and Top Climber. Defaults to 30. */
  movementWindowDays?: number;
  /** Matches before a rating is established. Defaults to 3. */
  minMatchesForRating?: number;
  /** Whether the sheet has dates - without them there is no movement to show. */
  hasDates?: boolean;
  /** How the ladder is ordered, for the table caption. */
  orderedBy?: 'rating' | 'challenge';
  onConnectSheet?: () => void;
  /** status 'blocked': the sheet loaded (or failed to) but no table can be shown at all. */
  blockedTitle?: string;
  blockedMessage?: ReactNode;
  blockedActions?: ReactNode;
  /** Rendered last, inside the page column - e.g. the ratings disclaimer, extra notes. */
  afterTable?: ReactNode;
}

export function DrawSheetLeaderboard(props: DrawSheetLeaderboardProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [scrollToKey, setScrollToKey] = useState<string | null>(null);
  const activeDivision =
    props.divisions.find((d) => d.id === props.activeDivisionId) ?? props.divisions[0] ?? null;

  const staleAfter = props.staleAfterMinutes ?? 15;
  const stale = Boolean(
    props.lastSynced && (props.now.getTime() - props.lastSynced.getTime()) / 60000 > staleAfter,
  );

  // Choosing a name in the spotlight opens that player's row and brings it into view.
  useEffect(() => {
    if (!scrollToKey) return;
    const selector =
      '[data-row-key="' +
      (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(scrollToKey) : scrollToKey.replace(/["\\]/g, '\\$&')) +
      '"]';
    const row = document.querySelector<HTMLElement>(selector);
    if (row) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      row.focus({ preventScroll: true });
    }
    setScrollToKey(null);
  }, [scrollToKey]);

  const selectPlayer = (key: string) => {
    setExpandedKey(key);
    setScrollToKey(key);
  };

  const windowDays = props.movementWindowDays ?? 30;

  return (
    <div className="draw-sheet">
      <div className="ds-page">
        <p className="ds-kicker">{props.teamName}</p>
        <h1 className="ds-title">{props.subtitle ?? 'Tennis Ladder'}</h1>

        <div className="ds-meta-row">
          {(props.status === 'ready' || props.status === 'loading') &&
          props.divisions.length > 1 ? (
            <div className="ds-tabs" role="tablist" aria-label="Choose a ladder">
              {props.divisions.map((d) => (
                <button
                  key={d.id}
                  role="tab"
                  aria-selected={d.id === activeDivision?.id}
                  className="ds-tab"
                  onClick={() => {
                    setExpandedKey(null);
                    props.onSelectDivision(d.id);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}

          {props.status === 'ready' && (
            <span className="ds-meta-right">
              <span className={'ds-sync' + (stale ? ' is-stale' : '')}>
                {props.lastSynced
                  ? 'Updated ' +
                    relativeTime(props.lastSynced, props.now) +
                    (stale ? ' — may be out of date' : '')
                  : 'Live'}
              </span>
              {props.headerActions && (
                <span className="ds-header-actions">{props.headerActions}</span>
              )}
            </span>
          )}
        </div>
        <hr className="ds-rule" />

        {props.banner}

        {props.status === 'empty' && <EmptyState onConnectSheet={props.onConnectSheet} />}
        {props.status === 'blocked' && (
          <Blocked
            title={props.blockedTitle ?? 'Something is wrong with this sheet'}
            message={props.blockedMessage}
            actions={props.blockedActions}
          />
        )}
        {props.status === 'loading' && <SkeletonRows />}
        {props.status === 'ready' && activeDivision && (
          <>
            {(props.issues ?? []).map((issue, i) => (
              <IssueNotice key={i} issue={issue} />
            ))}
            {activeDivision.leaders && activeDivision.leaders.topThree.length > 0 && (
              <Podium rows={activeDivision.leaders.topThree} onSelect={selectPlayer} />
            )}
            <Table
              standings={activeDivision.standings}
              expandedKey={expandedKey}
              onToggle={(key) => setExpandedKey((k) => (k === key ? null : key))}
              detail={{
                matchLog: props.matchLog,
                challengeOptions: props.challengeOptions,
                openChallengeFor: props.openChallengeFor,
                challengeRange: props.challengeRange ?? 3,
                movementWindowDays: windowDays,
                minMatchesForRating: props.minMatchesForRating ?? 3,
              }}
              caption={
                props.orderedBy === 'challenge'
                  ? 'Ladder standings, in challenge ladder order.'
                  : 'Ladder standings, ordered by rating.'
              }
            />
            {activeDivision.leaders && activeDivision.standings.length > 0 && (
              <Leaderboards
                leaders={activeDivision.leaders}
                windowDays={windowDays}
                hasDates={props.hasDates ?? true}
                onSelect={selectPlayer}
              />
            )}
          </>
        )}

        {props.afterTable}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- spotlight

const PLACE = ['1st', '2nd', '3rd'];

function Podium({ rows, onSelect }: { rows: StandingRow[]; onSelect: (key: string) => void }) {
  return (
    <section className="ds-spotlight" aria-labelledby="ds-spotlight-title">
      <h2 className="ds-section-title" id="ds-spotlight-title">
        Leaders spotlight
      </h2>
      <ol className="ds-podium">
        {rows.map((r, i) => (
          <li key={r.key}>
            <button className="ds-podium-item" onClick={() => onSelect(r.key)}>
              <span className="ds-podium-place">{PLACE[i]}</span>
              <Avatar row={r} />
              <span className="ds-podium-body">
                <span className="ds-podium-name">{r.displayName}</span>
                <span className="ds-podium-meta ds-num">
                  {r.record.matches > 0 ? r.rating.toFixed(2) + ' · ' : ''}
                  {r.record.wins}–{r.record.losses}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Leaderboards({
  leaders,
  windowDays,
  hasDates,
  onSelect,
}: {
  leaders: Leaders;
  windowDays: number;
  hasDates: boolean;
  onSelect: (key: string) => void;
}) {
  const boards: Array<{ title: string; entries: LeaderEntry[]; empty: string }> = [
    { title: 'Most wins', entries: leaders.mostWins, empty: 'No completed matches yet.' },
    {
      title: 'Longest active streak',
      entries: leaders.longestStreak,
      empty: 'Nobody is on a winning run right now.',
    },
    {
      title: 'Top climber · ' + windowDays + ' days',
      entries: leaders.topClimber,
      empty: hasDates
        ? 'No one has gained ground in this window yet.'
        : 'Add a Date column to the sheet to track climbers.',
    },
  ];

  return (
    <section className="ds-boards" aria-label="Performance leaderboards">
      {boards.map((board) => (
        <div className="ds-board" key={board.title}>
          <h3 className="ds-board-title">{board.title}</h3>
          {board.entries.length === 0 ? (
            <p className="ds-board-empty">{board.empty}</p>
          ) : (
            <ol className="ds-board-list">
              {board.entries.map((entry) => (
                <li key={entry.key}>
                  <button className="ds-board-name" onClick={() => onSelect(entry.key)}>
                    {entry.displayName}
                    {entry.tied && <span className="ds-board-tied"> (tied)</span>}
                  </button>
                  <span className="ds-board-value ds-num">{entry.value}</span>
                  <span className="ds-board-detail">{entry.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------------- table

interface DetailSources {
  matchLog: (row: StandingRow) => MatchLogEntry[];
  challengeOptions?: (row: StandingRow) => ChallengeOption[];
  openChallengeFor?: (row: StandingRow) => string | null;
  challengeRange: number;
  movementWindowDays: number;
  minMatchesForRating: number;
}

function Table({
  standings,
  expandedKey,
  onToggle,
  detail,
  caption,
}: {
  standings: StandingRow[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
  detail: DetailSources;
  caption: string;
}) {
  if (standings.length === 0) {
    return (
      <div className="ds-notice">
        <p className="ds-notice-label">No players yet</p>
        <p>Add match results to the sheet and they will appear here.</p>
      </div>
    );
  }

  const rankCounts = new Map<number, number>();
  for (const r of standings) rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1);

  return (
    <table className="ds-table">
      <caption className="ds-sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Player</th>
          <th scope="col" className="ds-col-status">Status</th>
          <th scope="col" className="ds-col-num">Record</th>
          <th scope="col" className="ds-col-num">Rating</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((r) => (
          <Row
            key={r.key}
            r={r}
            isOpen={expandedKey === r.key}
            onToggle={onToggle}
            tie={(rankCounts.get(r.rank) ?? 0) > 1}
            detail={detail}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  r,
  isOpen,
  onToggle,
  tie,
  detail,
}: {
  r: StandingRow;
  isOpen: boolean;
  onToggle: (key: string) => void;
  tie: boolean;
  detail: DetailSources;
}) {
  const unplayed = r.record.matches === 0;
  return (
    <>
      <tr
        className="ds-row"
        data-row-key={r.key}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={'View ' + r.displayName + ', rank ' + r.rank + ', ' + r.displayStatus}
        onClick={() => onToggle(r.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(r.key);
          }
        }}
      >
        <td className="ds-cell-rank">
          <span className="ds-rank-cell">
            <span className="ds-rank-num ds-num">
              {tie && <span className="ds-rank-tie">T</span>}
              {r.rank}
            </span>
            <Movement movement={r.movement} />
          </span>
        </td>

        <td className="ds-cell-player">
          <span className="ds-player-wrap">
            <Avatar row={r} />
            <span className="ds-player">
              <span className="ds-player-name">{r.displayName}</span>
              <span className="ds-player-meta">{playerMeta(r)}</span>
              <span className="ds-status-inline">
                <StatusBadge status={r.displayStatus} />
              </span>
            </span>
          </span>
        </td>

        <td className="ds-cell-status ds-col-status">
          <StatusBadge status={r.displayStatus} />
        </td>

        <td className="ds-cell-record ds-col-record">
          <span className="ds-record ds-num">
            {r.record.wins}–{r.record.losses}
          </span>
        </td>

        <td className="ds-cell-rating ds-col-rating">
          {unplayed ? (
            <>
              <span className="ds-rating ds-rating-none" aria-label="No rating yet">
                —
              </span>
              <span className="ds-prov">no matches</span>
            </>
          ) : (
            <>
              <span className="ds-rating ds-num">{r.rating.toFixed(2)}</span>
              {r.provisional && <span className="ds-prov">prov.</span>}
            </>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="ds-detail-row">
          <td colSpan={5}>
            <PlayerDetail r={r} sources={detail} />
          </td>
        </tr>
      )}
    </>
  );
}

function PlayerDetail({ r, sources }: { r: StandingRow; sources: DetailSources }) {
  const log = sources.matchLog(r);
  const openChallenge = sources.openChallengeFor?.(r) ?? null;
  const options = sources.challengeOptions?.(r);
  const streak =
    r.streak.current === 0 ? '–' : (r.streak.current > 0 ? 'W' : 'L') + Math.abs(r.streak.current);

  return (
    <div className="ds-detail">
      {r.record.matches > 0 && (
        <dl className="ds-stats">
          <div>
            <dt>Win %</dt>
            <dd className="ds-num">{Math.round(r.winPct * 100)}%</dd>
          </div>
          <div>
            <dt>Games won</dt>
            <dd className="ds-num">{Math.round(r.gamesWonPct * 100)}%</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd className="ds-num">{streak}</dd>
          </div>
          <div>
            <dt>Best run</dt>
            <dd className="ds-num">{r.streak.longestWin}</dd>
          </div>
          {r.previousRank !== null && (
            <div>
              <dt>{sources.movementWindowDays} days ago</dt>
              <dd className="ds-num">#{r.previousRank}</dd>
            </div>
          )}
        </dl>
      )}

      {r.provisional && r.record.matches > 0 && (
        <p className="ds-detail-note">
          Provisional rating — {r.record.matches} of the {sources.minMatchesForRating} matches
          needed for an established rating.
        </p>
      )}

      {openChallenge && (
        <p className="ds-detail-note">
          <strong>Open challenge:</strong> {openChallenge}
        </p>
      )}

      {options && <ChallengeList row={r} options={options} range={sources.challengeRange} />}

      <p className="ds-detail-label">Recent matches</p>
      <ul className="ds-match-log">
        {log.length === 0 && <li>No matches recorded yet.</li>}
        {log.map((m, i) => (
          <li key={i}>
            <span className={'ds-result' + (m.result === 'L' ? ' is-loss' : '')}>{m.result}</span>
            <span className="ds-opponent">
              {m.opponent}
              {m.pending && <span className="ds-pending">Pending</span>}
            </span>
            <span className="ds-score ds-num">{m.score}</span>
            <span className="ds-when">{m.date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Who this player may challenge (AC-2.1.1, AC-2.1.2). Players within range are listed
 * with a verdict and, when blocked, the reason; everyone further up is summarized in one
 * line rather than listed as a wall of "too far ahead".
 */
function ChallengeList({
  row,
  options,
  range,
}: {
  row: StandingRow;
  options: ChallengeOption[];
  range: number;
}) {
  const inRange = options.filter((o) => o.spotsAhead <= range);
  const beyond = options.length - inRange.length;

  // When the player themself cannot challenge (injured, already in a challenge), every
  // option carries the same reason - say it once instead of three times.
  // Nobody signs in, so the reason is written about the player rather than to "you".
  const first = inRange[0];
  const selfReason =
    first &&
    !first.eligible &&
    first.reason?.startsWith('You ') &&
    inRange.every((o) => !o.eligible && o.reason === first.reason)
      ? first.reason
          .replace(/^You are /, row.displayName + ' is ')
          .replace(/^You already have /, row.displayName + ' already has ')
      : null;

  return (
    <div className="ds-challenges">
      <p className="ds-detail-label">Can challenge</p>
      {options.length === 0 ? (
        <p className="ds-detail-note">
          {row.rank === 1 ? 'Top of the ladder — nobody to challenge.' : 'Nobody above to challenge.'}
        </p>
      ) : (
        <>
          {selfReason && <p className="ds-detail-note">{selfReason}</p>}
          <ul className="ds-challenge-list">
            {inRange.map((o) => (
              <li key={o.key} className={o.eligible ? 'is-eligible' : 'is-blocked'}>
                <span className="ds-challenge-rank ds-num">{o.rank}</span>
                <span className="ds-challenge-name">
                  {o.displayName}
                  {!o.eligible && !selfReason && (
                    <span className="ds-challenge-reason">{o.reason}</span>
                  )}
                </span>
                <span className="ds-challenge-verdict">{o.eligible ? 'Eligible' : 'Blocked'}</span>
              </li>
            ))}
          </ul>
          {beyond > 0 && (
            <p className="ds-detail-note">
              {beyond === 1 ? 'Rank 1 is' : 'Ranks 1–' + beyond + ' are'} more than {range} spot
              {range === 1 ? '' : 's'} ahead, so out of challenge range.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- row pieces

function Movement({ movement }: { movement: number | null }) {
  // AC-1.2.2. A null movement means there is no history to compare against - showing a
  // dash is honest, showing a flat marker would imply the player held their position.
  if (movement === null) {
    return (
      <span className="ds-movement none" title="No ranking history yet for this window">
        –
      </span>
    );
  }
  if (movement === 0) {
    return (
      <span className="ds-movement flat" title="Unchanged">
        <span aria-hidden="true">·</span>
        <span className="ds-sr-only">Unchanged</span>
      </span>
    );
  }
  const up = movement > 0;
  const places = Math.abs(movement);
  const label = (up ? 'Up ' : 'Down ') + places + (places === 1 ? ' place' : ' places');
  return (
    <span className={'ds-movement ' + (up ? 'up' : 'down')} title={label}>
      <span className="ds-tri" aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="ds-num" aria-hidden="true">{places}</span>
      <span className="ds-sr-only">{label}</span>
    </span>
  );
}

const STATUS_CLASS: Record<DisplayStatus, string> = {
  Available: 'is-available',
  'Challenge Pending': 'is-pending',
  'Injury Hold': 'is-injury',
  Inactive: 'is-inactive',
};

function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={'ds-badge ' + STATUS_CLASS[status]}>{status}</span>;
}

function Avatar({ row }: { row: StandingRow }) {
  // A photo link that is not an image (a Drive page, a typo) must fall back to initials
  // rather than leave a broken-image icon on the board.
  const [failed, setFailed] = useState(false);
  if (row.avatarUrl && !failed && /^https:\/\//i.test(row.avatarUrl)) {
    return (
      <img
        className="ds-avatar"
        src={row.avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="ds-avatar" aria-hidden="true">
      {initials(row.displayName)}
    </span>
  );
}

const GRADE_NAME: Record<number, string> = {
  9: 'Freshman',
  10: 'Sophomore',
  11: 'Junior',
  12: 'Senior',
};

/** Grade and division, e.g. "Junior · Varsity". Omits whatever the sheet did not supply. */
function playerMeta(r: StandingRow): string {
  const bits: string[] = [];
  if (r.grade) bits.push(GRADE_NAME[r.grade] ?? 'Grade ' + r.grade);
  if (r.division !== 'Unassigned') bits.push(r.division);
  return bits.join(' · ');
}

// ------------------------------------------------------------ non-table states

function EmptyState({ onConnectSheet }: { onConnectSheet?: () => void }) {
  return (
    <div className="ds-empty">
      <h2>No sheet connected</h2>
      <p>
        Ask your coach for the team&rsquo;s ladder link, or connect your own scores sheet to start
        a ladder.
      </p>
      {onConnectSheet && (
        <button className="ds-text-link" onClick={onConnectSheet}>
          Connect a sheet →
        </button>
      )}
    </div>
  );
}

function Blocked({
  title,
  message,
  actions,
}: {
  title: string;
  message?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <h2>{title}</h2>
      {message && <div className="ds-empty-message">{message}</div>}
      {actions && <div className="ds-blocked-actions">{actions}</div>}
    </div>
  );
}

function IssueNotice({ issue }: { issue: DataIssue }) {
  return (
    <div className="ds-notice">
      <p className="ds-notice-label">{issue.sheetRow ? 'Row ' + issue.sheetRow : 'Data issue'}</p>
      <p>
        {issue.message}
        {issue.context ? ' (' + issue.context + ')' : ''}
      </p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="ds-sr-only">Loading the ladder…</span>
      {Array.from({ length: 10 }).map((_, i) => (
        <div className="ds-skeleton-row" key={i}>
          <span className="ds-skel w-rank" />
          <span className="ds-skel w-name" />
          <span className="ds-skel w-record" />
          <span className="ds-skel w-rating" />
        </div>
      ))}
    </div>
  );
}
