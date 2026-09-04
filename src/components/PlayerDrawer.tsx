/**
 * Player detail: full record, match log, and who this player may challenge.
 *
 * The challenge list is the answer to the question a player opens this screen to ask,
 * so ineligible opponents are shown with the reason rather than omitted.
 */

import { useEffect, useRef } from 'react';
import { challengeOptions, type OpenChallenge } from '../lib/challenge';
import { formatScoreFor } from '../lib/score';
import { sortChronologically } from '../lib/stats';
import { Avatar, formatDate, Movement, playerMeta, StatusBadge } from './common';
import type { LadderConfig, Match, StandingRow } from '../lib/types';

interface Props {
  row: StandingRow;
  standings: StandingRow[];
  matches: Match[];
  config: LadderConfig;
  openChallenges: OpenChallenge[];
  now: Date;
  onClose: () => void;
  onSelectPlayer: (key: string) => void;
}

export function PlayerDrawer({
  row,
  standings,
  matches,
  config,
  openChallenges,
  now,
  onClose,
  onSelectPlayer,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const played = sortChronologically(
    matches.filter((m) => m.playerA === row.key || m.playerB === row.key),
  ).reverse();

  const options = challengeOptions({
    challengerKey: row.key,
    standings,
    matches,
    config,
    openChallenges,
    now,
  });

  const nameFor = (key: string) => standings.find((s) => s.key === key)?.displayName ?? key;

  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-head">
          <div className="row" style={{ gap: 12 }}>
            <Avatar row={row} />
            <div>
              <h2 id="drawer-title">{row.displayName}</h2>
              <div className="small muted">
                Rank {row.rank}
                {playerMeta(row) ? ' · ' + playerMeta(row) : ''}
              </div>
            </div>
          </div>
          <button ref={closeRef} className="btn btn-sm" onClick={onClose} aria-label="Close player details">
            Close
          </button>
        </div>

        <div className="row" style={{ margin: '10px 0 4px' }}>
          <StatusBadge status={row.displayStatus} />
          <Movement movement={row.movement} />
          {row.provisional && (
            <span className="badge badge-provisional">Provisional rating</span>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Rating</div>
            <div className="stat-value">{row.rating.toFixed(2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Record</div>
            <div className="stat-value">
              {row.record.wins}–{row.record.losses}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Win %</div>
            <div className="stat-value">{(row.winPct * 100).toFixed(0)}%</div>
          </div>
          <div className="stat">
            <div className="stat-label">Games %</div>
            <div className="stat-value">{(row.gamesWonPct * 100).toFixed(0)}%</div>
          </div>
          <div className="stat">
            <div className="stat-label">Streak</div>
            <div className="stat-value">
              {row.streak.current === 0
                ? '–'
                : (row.streak.current > 0 ? 'W' : 'L') + Math.abs(row.streak.current)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Best run</div>
            <div className="stat-value">{row.streak.longestWin}</div>
          </div>
        </div>

        {row.provisional && (
          <div className="notice notice-info">
            <strong>Rating still settling</strong>
            {row.displayName} has played {row.record.matches}{' '}
            {row.record.matches === 1 ? 'match' : 'matches'}. Ratings are marked provisional
            until {config.minMatchesForRating}, the same minimum USTA uses before publishing a
            year-end rating.
          </div>
        )}

        <section className="section">
          <div className="section-head">
            <h2>Can challenge</h2>
            <span className="section-note">up to {config.challengeRange} spots ahead</span>
          </div>
          <div className="card panel">
            {options.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                {row.rank === 1
                  ? 'Top of the ladder — nobody to challenge.'
                  : 'No opponents available.'}
              </p>
            ) : (
              <ul className="challenge-list">
                {options.map((option) => (
                  <li
                    key={option.key}
                    className={'challenge-item' + (option.eligible ? '' : ' blocked')}
                  >
                    <span className="rank-number" style={{ fontSize: 15 }}>
                      {option.rank}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="player-name">{option.displayName}</span>
                      {!option.eligible && <div className="challenge-reason">{option.reason}</div>}
                    </span>
                    {option.eligible ? (
                      <span className="badge badge-available">Eligible</span>
                    ) : (
                      <span className="badge badge-muted">Blocked</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Match log</h2>
            <span className="section-note">{played.length} played</span>
          </div>
          <div className="card panel">
            {played.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                No matches recorded yet.
              </p>
            ) : (
              <ul className="match-log">
                {played.map((m) => {
                  const isA = m.playerA === row.key;
                  const won = (isA && m.winner === 'a') || (!isA && m.winner === 'b');
                  const opponentKey = isA ? m.playerB : m.playerA;
                  return (
                    <li key={m.id}>
                      <span className={'result-pill ' + (won ? 'w' : 'l')}>{won ? 'W' : 'L'}</span>
                      <button
                        className="leader-name"
                        style={{ textAlign: 'left', flex: 1 }}
                        onClick={() => onSelectPlayer(opponentKey)}
                      >
                        {nameFor(opponentKey)}
                        {m.approval === 'Pending' && (
                          <span className="badge badge-pending" style={{ marginLeft: 6 }}>
                            Pending
                          </span>
                        )}
                        <br />
                        <span className="leader-detail">{formatDate(m.date)}</span>
                      </button>
                      <span className="match-score">{formatScoreFor(m.score, isA ? 'a' : 'b')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
