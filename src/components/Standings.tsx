/**
 * The standings table (PRD 6.1, AC-1.2.1).
 *
 * Below 720px the table reflows into cards - see styles.css. A horizontally scrolling
 * table is unusable one-handed on a phone at the side of a court, which is where this
 * screen is actually read.
 */

import { Avatar, FormRun, Movement, playerMeta, StatusBadge } from './common';
import type { StandingRow } from '../lib/types';

interface Props {
  standings: StandingRow[];
  onSelect: (row: StandingRow) => void;
  movementWindowDays: number;
}

export function Standings({ standings, onSelect, movementWindowDays }: Props) {
  if (standings.length === 0) {
    return (
      <div className="card panel">
        <p className="muted" style={{ margin: 0 }}>
          No players on this ladder yet. Add match results to the sheet and they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="standings">
        <caption className="sr-only">
          Ladder standings, ordered by rating. Movement is measured against {movementWindowDays} days ago.
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <th scope="col">Status</th>
            <th scope="col" className="col-num">Rating</th>
            <th scope="col" className="col-num">W–L</th>
            <th scope="col" className="col-num">Games</th>
            <th scope="col">Form</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr
              key={row.key}
              className="is-clickable"
              tabIndex={0}
              role="button"
              aria-label={'View ' + row.displayName + ', rank ' + row.rank}
              onClick={() => onSelect(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(row);
                }
              }}
            >
              <td className="cell-primary">
                <span className="rank-cell">
                  <span className="rank-number">{row.rank}</span>
                  <Movement movement={row.movement} />
                </span>
              </td>

              <td>
                <span className="player-cell">
                  <Avatar row={row} />
                  <span style={{ minWidth: 0 }}>
                    <span className="player-name">{row.displayName}</span>
                    {playerMeta(row) && <span className="player-sub"> {playerMeta(row)}</span>}
                  </span>
                </span>
              </td>

              <td data-label="Status" className="cell-inline">
                <StatusBadge status={row.displayStatus} />
              </td>

              <td data-label="Rating" className="col-num cell-inline">
                <span className="rating">{row.rating.toFixed(2)}</span>
                {row.provisional && (
                  <span
                    className="badge badge-provisional"
                    title={'Fewer than the minimum matches needed for an established rating (' + row.record.matches + ' so far)'}
                  >
                    Provisional
                  </span>
                )}
              </td>

              <td data-label="Record" className="col-num cell-inline">
                <span className="mono">
                  {row.record.wins}–{row.record.losses}
                </span>
              </td>

              <td data-label="Games" className="col-num cell-inline">
                <span className="mono">
                  {row.record.gamesWon}–{row.record.gamesLost}
                </span>
                <span className="rating-sub"> {(row.gamesWonPct * 100).toFixed(0)}%</span>
              </td>

              <td data-label="Form" className="cell-inline">
                <FormRun results={row.streak.last5} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
