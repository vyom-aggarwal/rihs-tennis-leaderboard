/**
 * Acceptance tests traced to the QA Test Suite and the User Stories documents.
 *
 * Each block names the test case or acceptance criterion it covers, so a failure points
 * straight at the requirement it breaks. UI-only criteria (render timings, tab
 * highlight styling) are noted where they are verified in the browser instead - see
 * docs/TRACEABILITY.md for the full matrix.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { challengeOptions, eligibleTargets } from '../lib/challenge';
import { buildDashboard } from '../lib/dashboard';
import { applyChallengeResult } from '../lib/ladder';
import { parseScoreString, validateScore } from '../lib/score';
import { playerKey } from '../lib/schema';
import { DEFAULT_LADDER_CONFIG, type LadderConfig } from '../lib/types';
import { SAMPLE_CSV } from './helpers';

const k = playerKey;
const NOW = new Date('2026-09-04T12:00:00Z');
const config: LadderConfig = { ...DEFAULT_LADDER_CONFIG };

const demoMatches = readFileSync('sample-data/demo-matches.csv', 'utf8');
const demoRoster = readFileSync('sample-data/demo-roster.csv', 'utf8');

const demo = () =>
  buildDashboard({ matchesCsv: demoMatches, rosterCsv: demoRoster, config, now: NOW });

// ---------------------------------------------------------------------------
// The supplied sample sheet must work untouched.
// ---------------------------------------------------------------------------
describe('the supplied sample sheet', () => {
  const board = () => buildDashboard({ matchesCsv: SAMPLE_CSV, config, now: NOW });

  it('imports all seven rows with no errors', () => {
    const d = board();
    expect(d.matches).toHaveLength(7);
    expect(d.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('produces a single combined ladder when the sheet has no team column', () => {
    const d = board();
    expect(d.singleLadder).toBe(true);
    expect(d.boards).toHaveLength(1);
    expect(d.boards[0]!.standings).toHaveLength(6);
  });

  it('puts the undefeated player top', () => {
    const top = board().boards[0]!.standings[0]!;
    expect(top.displayName).toBe('Jake');
    expect(top.record).toMatchObject({ wins: 3, losses: 0 });
  });

  it('flags the 6-5 scoreline without discarding the match', () => {
    const d = board();
    const issue = d.issues.find((i) => i.code === 'score-format')!;
    expect(issue.severity).toBe('warning');
    expect(issue.sheetRow).toBe(8); // Mike v Jake, the last row
    expect(d.matches).toHaveLength(7); // still counted
  });

  it('marks players under three matches as provisional', () => {
    const mike = board().boards[0]!.standings.find((s) => s.displayName === 'Mike')!;
    expect(mike.record.matches).toBe(1);
    expect(mike.provisional).toBe(true);
  });

  it('shows no movement arrows, because the sheet has no dates', () => {
    for (const row of board().boards[0]!.standings) {
      expect(row.movement).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// TC-1.1 / US-1.1: dual ladder standings
// ---------------------------------------------------------------------------
describe('TC-1.1 dual ladder standings (AC-1.1.1)', () => {
  it('produces separate Boys and Girls ladders', () => {
    const d = demo();
    expect(d.boards.map((b) => b.label)).toEqual(['Boys Ladder', 'Girls Ladder']);
    expect(d.singleLadder).toBe(false);
  });

  it('keeps the two rosters completely separate', () => {
    const d = demo();
    const boys = new Set(d.boards[0]!.standings.map((s) => s.displayName));
    const girls = new Set(d.boards[1]!.standings.map((s) => s.displayName));
    for (const name of boys) expect(girls.has(name)).toBe(false);
    expect(boys.size).toBe(10);
    expect(girls.size).toBe(10);
  });

  it('precomputes both boards in one pass, so switching tabs needs no refetch (AC-1.1.2)', () => {
    // The <500ms tab-switch requirement is met by having both boards already in memory;
    // the render itself is verified in the browser.
    const d = demo();
    expect(d.boards.every((b) => b.standings.length > 0 && b.leaders !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-1.2 / US-1.2: positions, movement and status badges
// ---------------------------------------------------------------------------
describe('TC-1.2 positions, movement and status (AC-1.2.1, AC-1.2.2, AC-1.2.3)', () => {
  it('supplies every column the standings table needs (AC-1.2.1)', () => {
    const row = demo().boards[0]!.standings[0]!;
    expect(row).toMatchObject({
      rank: 1,
      displayName: expect.any(String),
      division: expect.any(String),
      displayStatus: expect.any(String),
    });
    expect(row.grade).toBeGreaterThanOrEqual(9);
    expect(row.record.wins).toBeGreaterThanOrEqual(0);
  });

  it('numbers ranks 1..N with no gaps or repeats', () => {
    for (const board of demo().boards) {
      expect(board.standings.map((s) => s.rank)).toEqual(
        Array.from({ length: board.standings.length }, (_, i) => i + 1),
      );
    }
  });

  it('computes real movement against the ladder 30 days ago (AC-1.2.2)', () => {
    const d = demo();
    const moved = d.boards.flatMap((b) => b.standings).filter((s) => s.movement !== null && s.movement !== 0);
    expect(moved.length).toBeGreaterThan(0);
    for (const row of moved) {
      expect(row.previousRank).not.toBeNull();
      expect(row.movement).toBe(row.previousRank! - row.rank);
    }
  });

  it('shows Injury Hold for injured players (AC-1.2.3, AC-3.1.2)', () => {
    const all = demo().boards.flatMap((b) => b.standings);
    const injured = all.filter((s) => s.displayStatus === 'Injury Hold');
    expect(injured.map((s) => s.displayName).sort()).toEqual(['Lena Fischer', 'Marcus Webb']);
    // AC-3.1.2: the historical record survives the status change.
    for (const row of injured) expect(row.record.matches).toBeGreaterThan(0);
  });

  it('shows Challenge Pending for both sides of an open challenge (AC-1.2.3)', () => {
    const d = buildDashboard({
      matchesCsv: demoMatches,
      rosterCsv: demoRoster,
      config,
      now: NOW,
      openChallenges: [{ challengerKey: k('Ravi Menon'), defenderKey: k('Pedro Alvarez'), createdAt: null }],
    });
    const boys = d.boards[0]!.standings;
    expect(boys.find((s) => s.displayName === 'Ravi Menon')!.displayStatus).toBe('Challenge Pending');
    expect(boys.find((s) => s.displayName === 'Pedro Alvarez')!.displayStatus).toBe('Challenge Pending');
    expect(boys.find((s) => s.displayName === 'Jake Whitmore')!.displayStatus).toBe('Available');
  });
});

// ---------------------------------------------------------------------------
// PRD 6.2: Leaders Spotlight
// ---------------------------------------------------------------------------
describe('PRD 6.2 leaders spotlight', () => {
  it('spotlights the top three of each ladder', () => {
    for (const board of demo().boards) {
      expect(board.leaders.topThree.map((s) => s.rank)).toEqual([1, 2, 3]);
    }
  });

  it('ranks Most Wins by actual win count', () => {
    for (const board of demo().boards) {
      const wins = board.leaders.mostWins.map((l) => l.value);
      expect(wins).toEqual([...wins].sort((a, b) => b - a));
      const best = Math.max(...board.standings.map((s) => s.record.wins));
      expect(wins[0]).toBe(best);
    }
  });

  it('counts only streaks that are still running', () => {
    for (const board of demo().boards) {
      for (const leader of board.leaders.longestStreak) {
        const row = board.standings.find((s) => s.key === leader.key)!;
        expect(row.streak.current).toBe(leader.value);
        expect(row.streak.current).toBeGreaterThan(0);
      }
    }
  });

  it('lists only genuine climbers over the 30-day window', () => {
    for (const board of demo().boards) {
      for (const leader of board.leaders.topClimber) {
        expect(leader.value).toBeGreaterThan(0);
        expect(leader.detail).toContain('30 days');
      }
    }
  });

  it('marks shared values as tied rather than picking one name', () => {
    const board = demo().boards[0]!;
    for (const leader of board.leaders.mostWins) {
      const sharing = board.standings.filter((s) => s.record.wins === leader.value).length;
      expect(leader.tied).toBe(sharing > 1);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-2.1 / US-2.1: challenge eligibility
// ---------------------------------------------------------------------------
describe('TC-2.1 challenge eligibility (AC-2.1.1, AC-2.1.2)', () => {
  const standings = () => demo().boards[0]!.standings;

  it('offers a rank-8 player exactly ranks 5, 6 and 7 (TC-2.1.1 step 1)', () => {
    const rows = standings();
    const eighth = rows.find((s) => s.rank === 8)!;
    const eligible = eligibleTargets({ challengerKey: eighth.key, standings: rows, matches: [], config });
    expect(eligible.map((o) => o.rank).sort()).toEqual([5, 6, 7]);
  });

  it('disables rank 4 for a rank-8 player rather than hiding it (TC-2.1.1 step 2)', () => {
    const rows = standings();
    const eighth = rows.find((s) => s.rank === 8)!;
    const fourth = challengeOptions({ challengerKey: eighth.key, standings: rows, matches: [], config }).find(
      (o) => o.rank === 4,
    )!;
    expect(fourth.eligible).toBe(false);
    expect(fourth.reason).toMatch(/too far ahead/i);
  });

  it('never lets an injured player be challenged (TC-3.1.1 step 3)', () => {
    const rows = standings();
    const injured = rows.find((s) => s.displayStatus === 'Injury Hold')!;
    for (const row of rows.filter((s) => s.rank > injured.rank)) {
      const option = challengeOptions({ challengerKey: row.key, standings: rows, matches: [], config }).find(
        (o) => o.key === injured.key,
      );
      if (option) expect(option.eligible).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-2.2 / US-2.2: score entry and coach verification
// ---------------------------------------------------------------------------
describe('TC-2.2 score entry and verification (AC-2.2.1, AC-2.2.2, AC-2.2.3)', () => {
  it('blocks an invalid score format (TC-2.2.1 step 1)', () => {
    expect(validateScore(parseScoreString('10-2')!, true).valid).toBe(false);
  });

  it('accepts a valid two-set score (TC-2.2.1 step 2)', () => {
    expect(validateScore(parseScoreString('6-4, 7-5')!, true).valid).toBe(true);
  });

  it('accepts a super-tiebreak decider (AC-2.2.1)', () => {
    expect(validateScore(parseScoreString('6-3, 4-6, 10-8')!, true).valid).toBe(true);
  });

  it('holds pending results out of the ladder when configured to (AC-2.2.2)', () => {
    const strict = buildDashboard({
      matchesCsv: demoMatches,
      rosterCsv: demoRoster,
      config: { ...config, countPendingMatches: false },
      now: NOW,
    });
    const lenient = demo();
    const countedStrict = strict.boards.reduce((n, b) => n + b.matches.length, 0);
    const countedLenient = lenient.boards.reduce((n, b) => n + b.matches.length, 0);
    expect(countedStrict).toBeLessThan(countedLenient);
  });

  it('moves the challenger into the defender spot on approval (TC-2.2.1 step 4, AC-2.2.3)', () => {
    const ladder = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const after = applyChallengeResult(ladder, 'p8', 'p6', true);
    expect(after.indexOf('p8') + 1).toBe(6); // challenger to rank 6
    expect(after.indexOf('p6') + 1).toBe(7); // defender drops to 7
    expect(after.indexOf('p7') + 1).toBe(8);
    expect(after.slice(0, 5)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']); // above untouched
  });
});

// ---------------------------------------------------------------------------
// Data integrity - the promises the dashboard makes about its own numbers.
// ---------------------------------------------------------------------------
describe('data integrity', () => {
  it('imports the demo season with zero errors', () => {
    const d = demo();
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('produces a byte-identical board on repeated builds', () => {
    const a = demo();
    const b = demo();
    for (let i = 0; i < a.boards.length; i++) {
      expect(b.boards[i]!.standings.map((s) => s.key)).toEqual(a.boards[i]!.standings.map((s) => s.key));
      expect(b.boards[i]!.standings.map((s) => s.rating)).toEqual(a.boards[i]!.standings.map((s) => s.rating));
    }
  });

  it('balances wins against losses across each ladder', () => {
    for (const board of demo().boards) {
      const wins = board.standings.reduce((n, s) => n + s.record.wins, 0);
      const losses = board.standings.reduce((n, s) => n + s.record.losses, 0);
      expect(wins).toBe(losses);
      expect(wins).toBe(board.matches.length);
    }
  });

  it('balances games won against games lost across each ladder', () => {
    for (const board of demo().boards) {
      const won = board.standings.reduce((n, s) => n + s.record.gamesWon, 0);
      const lost = board.standings.reduce((n, s) => n + s.record.gamesLost, 0);
      expect(won).toBe(lost);
    }
  });

  it('keeps every rating inside the NTRP scale', () => {
    for (const board of demo().boards) {
      for (const row of board.standings) {
        expect(row.rating).toBeGreaterThanOrEqual(1.0);
        expect(row.rating).toBeLessThanOrEqual(7.0);
      }
    }
  });

  it('orders every ladder by descending rating', () => {
    for (const board of demo().boards) {
      const ratings = board.standings.map((s) => s.rating);
      expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    }
  });

  it('handles an empty sheet without throwing', () => {
    const d = buildDashboard({ matchesCsv: 'Person 1,Person 2,Score\n', config, now: NOW });
    expect(d.boards.flatMap((b) => b.standings)).toEqual([]);
    expect(d.issues.some((i) => i.code === 'no-matches')).toBe(true);
  });

  it('reports unusable headers instead of guessing', () => {
    const d = buildDashboard({ matchesCsv: 'Foo,Bar\n1,2', config, now: NOW });
    expect(d.issues.some((i) => i.code === 'mapping-incomplete')).toBe(true);
    expect(d.boards).toEqual([]);
  });

  it('flags a player in results who is missing from the roster', () => {
    const d = buildDashboard({
      matchesCsv: demoMatches + '\n2026-09-01,Boys,Jake Whitmore,Ghost Player,"6-1, 6-1",Verified,',
      rosterCsv: demoRoster,
      config,
      now: NOW,
    });
    const issue = d.issues.find((i) => i.code === 'unrostered-player')!;
    expect(issue.message).toContain('Ghost Player');
  });
});
