/** Leaders Spotlight: top-three podium plus the three metric leaderboards (PRD 6.2). */

import { Avatar, Movement, playerMeta } from './common';
import type { LeaderEntry, Leaders } from '../lib/leaders';
import type { StandingRow } from '../lib/types';

const PLACE = ['1st', '2nd', '3rd'];

function Podium({ row, place }: { row: StandingRow; place: number }) {
  return (
    <div className={'podium podium-' + (place + 1)}>
      <div className="podium-place">{PLACE[place]}</div>
      <div className="podium-name">{row.displayName}</div>
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <Avatar row={row} />
        <div>
          <div className="rating">{row.rating.toFixed(2)}</div>
          <div className="rating-sub">team rating</div>
        </div>
        <Movement movement={row.movement} />
      </div>
      <div className="podium-meta">
        <span className="mono">
          {row.record.wins}–{row.record.losses}
        </span>
        {playerMeta(row) && <span>{playerMeta(row)}</span>}
        {row.provisional && <span className="badge badge-provisional">Provisional</span>}
      </div>
    </div>
  );
}

function Board({
  title,
  entries,
  empty,
  onSelect,
}: {
  title: string;
  entries: LeaderEntry[];
  empty: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="card leaderboard">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="leader-empty" style={{ margin: 0 }}>
          {empty}
        </p>
      ) : (
        entries.map((entry) => (
          <button
            key={entry.key}
            className="leader-row"
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => onSelect(entry.key)}
          >
            <span className="leader-name">
              {entry.displayName}
              {entry.tied && (
                <span className="leader-detail" title="Another player shares this total">
                  {' '}
                  (tied)
                </span>
              )}
              <br />
              <span className="leader-detail">{entry.detail}</span>
            </span>
            <span className="leader-value">{entry.value}</span>
          </button>
        ))
      )}
    </div>
  );
}

interface Props {
  leaders: Leaders;
  movementWindowDays: number;
  hasDates: boolean;
  onSelect: (key: string) => void;
}

export function Spotlight({ leaders, movementWindowDays, hasDates, onSelect }: Props) {
  return (
    <>
      {leaders.topThree.length > 0 && (
        <section className="section" aria-labelledby="spotlight-heading">
          <div className="section-head">
            <h2 id="spotlight-heading" data-eyebrow="Top of the ladder">
              Leaders Spotlight
            </h2>
          </div>
          <div className="spotlight">
            {leaders.topThree.map((row, i) => (
              <Podium key={row.key} row={row} place={i} />
            ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="metrics-heading">
        <div className="section-head">
          <h2 id="metrics-heading" data-eyebrow="Season metrics">
            Performance Leaderboards
          </h2>
        </div>
        <div className="leaderboards">
          <Board
            title="Most Wins"
            entries={leaders.mostWins}
            empty="No completed matches yet."
            onSelect={onSelect}
          />
          <Board
            title="Longest Active Streak"
            entries={leaders.longestStreak}
            empty="Nobody is on a winning run right now."
            onSelect={onSelect}
          />
          <Board
            title={'Top Climber · ' + movementWindowDays + ' days'}
            entries={leaders.topClimber}
            empty={
              hasDates
                ? 'No one has gained ground in this window yet.'
                : 'Add a Date column to the sheet to track climbers.'
            }
            onSelect={onSelect}
          />
        </div>
      </section>
    </>
  );
}
