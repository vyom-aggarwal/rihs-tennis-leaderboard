/**
 * Draw-sheet leaderboard - design review pass (static, sample data only).
 *
 * Modeled on a printed tournament draw sheet: the table is the whole product, hairline
 * rules stand in for cards/borders, and the one accent color is reserved for exactly one
 * thing - rank-movement triangles. There is no login, so nothing on the page is scoped to
 * "you". Nothing here reads from src/lib; it takes the real StandingRow/DataIssue shapes
 * as props so it can be dropped into the live app later without changing this file's
 * contract.
 */

import { useState, type ReactNode } from 'react';
import { relativeTime } from '../components/common';
import type { DataIssue, StandingRow } from '../lib/types';
import './draw-sheet.css';

export interface MatchLogEntry {
  date: string;
  opponent: string;
  score: string;
  result: 'W' | 'L';
}

export interface DrawSheetDivision {
  id: string;
  label: string;
  standings: StandingRow[];
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
  const activeDivision =
    props.divisions.find((d) => d.id === props.activeDivisionId) ?? props.divisions[0] ?? null;

  const staleAfter = props.staleAfterMinutes ?? 15;
  const stale = Boolean(
    props.lastSynced && (props.now.getTime() - props.lastSynced.getTime()) / 60000 > staleAfter,
  );

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
            <Table
              standings={activeDivision.standings}
              expandedKey={expandedKey}
              onToggle={(key) => setExpandedKey((k) => (k === key ? null : key))}
              matchLog={props.matchLog}
            />
          </>
        )}

        {props.afterTable}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- table

function Table({
  standings,
  expandedKey,
  onToggle,
  matchLog,
}: {
  standings: StandingRow[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
  matchLog: (row: StandingRow) => MatchLogEntry[];
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
      <caption className="ds-sr-only">Ladder standings, ordered by rating.</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Player</th>
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
            matchLog={matchLog}
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
  matchLog,
}: {
  r: StandingRow;
  isOpen: boolean;
  onToggle: (key: string) => void;
  tie: boolean;
  matchLog: (row: StandingRow) => MatchLogEntry[];
}) {
  return (
    <>
      <tr
        className="ds-row"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={'View ' + r.displayName + ', rank ' + r.rank}
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
          <span className="ds-player">
            <span className="ds-player-name">{r.displayName}</span>
            <span className="ds-player-meta">
              <PlayerMeta r={r} />
            </span>
          </span>
        </td>

        <td className="ds-cell-record ds-col-record">
          <span className="ds-record ds-num">
            {r.record.wins}–{r.record.losses}
          </span>
        </td>

        <td className="ds-cell-rating ds-col-rating">
          <span className="ds-rating ds-num">{r.rating.toFixed(2)}</span>
          {r.provisional && <span className="ds-prov">prov.</span>}
        </td>
      </tr>

      {isOpen && (
        <tr className="ds-detail-row">
          <td colSpan={4}>
            <div className="ds-detail">
              <p className="ds-detail-label">Recent matches</p>
              <ul className="ds-match-log">
                {matchLog(r).length === 0 && <li>No matches recorded yet.</li>}
                {matchLog(r).map((m, i) => (
                  <li key={i}>
                    <span className={'ds-result' + (m.result === 'L' ? ' is-loss' : '')}>
                      {m.result}
                    </span>
                    <span className="ds-opponent">{m.opponent}</span>
                    <span className="ds-score ds-num">{m.score}</span>
                    <span className="ds-when">{m.date}</span>
                  </li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Movement({ movement }: { movement: number | null }) {
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
      <span className="ds-num">{places}</span>
      <span className="ds-sr-only">{label}</span>
    </span>
  );
}

const GRADE_NAME: Record<number, string> = {
  9: 'Freshman',
  10: 'Sophomore',
  11: 'Junior',
  12: 'Senior',
};

function PlayerMeta({ r }: { r: StandingRow }) {
  const bits: string[] = [];
  if (r.grade) bits.push(GRADE_NAME[r.grade] ?? 'Grade ' + r.grade);
  if (r.division !== 'Unassigned') bits.push(r.division);
  return (
    <>
      {bits.join(' · ')}
      {r.displayStatus === 'Injury Hold' && <span className="ds-hold"> · Injury hold</span>}
    </>
  );
}

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
      {message && <p>{message}</p>}
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
