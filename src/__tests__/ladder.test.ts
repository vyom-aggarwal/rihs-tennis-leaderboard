import { describe, expect, it } from 'vitest';
import {
  applyChallengeResult,
  buildLadder,
  compareForRank,
  countableMatches,
  listTeams,
  matchesForTeam,
  resolveTeams,
} from '../lib/ladder';
import { computeRatings } from '../lib/rating';
import { computeStats } from '../lib/stats';
import { playerKey } from '../lib/schema';
import { DEFAULT_LADDER_CONFIG, type LadderConfig, type RosterEntry } from '../lib/types';
import { daysAgo, match, names, order } from './helpers';

const k = playerKey;
const config: LadderConfig = { ...DEFAULT_LADDER_CONFIG };

function roster(...entries: Array<Partial<RosterEntry> & { displayName: string }>) {
  const map = new Map<string, RosterEntry>();
  for (const e of entries) {
    const key = playerKey(e.displayName);
    map.set(key, {
      key,
      displayName: e.displayName,
      team: e.team ?? null,
      grade: e.grade ?? null,
      division: e.division ?? 'Unassigned',
      activeStatus: e.activeStatus ?? 'Active',
      seedRank: e.seedRank ?? null,
      avatarUrl: e.avatarUrl ?? null,
    });
  }
  return map;
}

describe('applyChallengeResult (DEV-301)', () => {
  const ladder = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

  it('moves a winning challenger into the defender spot and slides the rest down one', () => {
    // TC-2.2.1 step 4: #8 beats #6 -> challenger to #6, defender to #7.
    const next = applyChallengeResult(ladder, 'p8', 'p6', true);
    expect(next).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p8', 'p6', 'p7']);
    expect(next.indexOf('p8')).toBe(5); // rank 6
    expect(next.indexOf('p6')).toBe(6); // rank 7
  });

  it('leaves the ladder untouched when the defender holds', () => {
    expect(applyChallengeResult(ladder, 'p8', 'p6', false)).toEqual(ladder);
  });

  it('swaps adjacent players cleanly', () => {
    expect(applyChallengeResult(ladder, 'p4', 'p3', true).slice(0, 4)).toEqual([
      'p1',
      'p2',
      'p4',
      'p3',
    ]);
  });

  it('ignores a "challenge" from someone already ranked above the defender', () => {
    expect(applyChallengeResult(ladder, 'p2', 'p5', true)).toEqual(ladder);
  });

  it('ignores unknown players and never mutates the input', () => {
    const copy = ladder.slice();
    expect(applyChallengeResult(ladder, 'ghost', 'p3', true)).toEqual(ladder);
    expect(ladder).toEqual(copy);
  });
});

describe('compareForRank tiebreakers', () => {
  it('orders by rating first', () => {
    const matches = [match('A', 'B', '6-0')];
    const ratings = computeRatings({ matches, config }).ratings;
    const stats = computeStats(matches);
    expect(compareForRank(k('A'), k('B'), ratings, stats, names('A', 'B'))).toBeLessThan(0);
  });

  it('falls back to head-to-head when ratings tie exactly', () => {
    // Neither player has any rating evidence, so both sit at the base rating.
    const stats = computeStats([match('A', 'B', '6-3')]);
    const tied = new Map([
      [k('A'), { key: k('A'), rating: 3.5, matches: 1, distinctOpponents: 1, provisional: true, confidence: 0.3 }],
      [k('B'), { key: k('B'), rating: 3.5, matches: 1, distinctOpponents: 1, provisional: true, confidence: 0.3 }],
    ]);
    expect(compareForRank(k('A'), k('B'), tied, stats, names('A', 'B'))).toBeLessThan(0);
  });

  it('falls back to alphabetical order when nothing else separates players', () => {
    const stats = computeStats([]);
    const tied = new Map([
      [k('Zoe'), { key: k('Zoe'), rating: 3.5, matches: 0, distinctOpponents: 0, provisional: true, confidence: 0 }],
      [k('Amy'), { key: k('Amy'), rating: 3.5, matches: 0, distinctOpponents: 0, provisional: true, confidence: 0 }],
    ]);
    expect(compareForRank(k('Amy'), k('Zoe'), tied, stats, names('Amy', 'Zoe'))).toBeLessThan(0);
  });
});

describe('countableMatches', () => {
  it('always excludes rejected results', () => {
    const matches = [match('A', 'B', '6-1', { approval: 'Rejected' })];
    expect(countableMatches(matches, config)).toHaveLength(0);
  });

  it('includes pending results only when configured to (AC-2.2.2)', () => {
    const matches = [match('A', 'B', '6-1', { approval: 'Pending' })];
    expect(countableMatches(matches, { ...config, countPendingMatches: true })).toHaveLength(1);
    expect(countableMatches(matches, { ...config, countPendingMatches: false })).toHaveLength(0);
  });
});

describe('buildLadder', () => {
  it('ranks a transitive set in the expected order', () => {
    const matches = [
      match('Ana', 'Bea', '6-1'),
      match('Bea', 'Cat', '6-2'),
      match('Ana', 'Cat', '6-0'),
    ];
    const result = buildLadder({
      matches,
      roster: new Map(),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config,
    });
    expect(order(result.standings)).toEqual(['Ana', 'Bea', 'Cat']);
    expect(result.standings[0]!.rank).toBe(1);
    expect(result.standings[2]!.rank).toBe(3);
  });

  it('includes rostered players who have not played yet', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Bea', '6-1')],
      roster: roster({ displayName: 'Cat' }),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config,
    });
    expect(order(result.standings)).toContain('Cat');
    expect(result.standings.find((s) => s.displayName === 'Cat')!.record.matches).toBe(0);
  });

  it('carries roster metadata onto the standings row', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Bea', '6-1')],
      roster: roster({ displayName: 'Ana', grade: 11, division: 'Varsity', team: 'Girls' }),
      displayNames: names('Ana', 'Bea'),
      config,
    });
    const ana = result.standings.find((s) => s.displayName === 'Ana')!;
    expect(ana.grade).toBe(11);
    expect(ana.division).toBe('Varsity');
    expect(ana.team).toBe('Girls');
  });

  it('shows Injury Hold and blocks nothing else about the record (AC-3.1.2)', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Bea', '6-1')],
      roster: roster({ displayName: 'Ana', activeStatus: 'Injured' }),
      displayNames: names('Ana', 'Bea'),
      config,
    });
    const ana = result.standings.find((s) => s.displayName === 'Ana')!;
    expect(ana.displayStatus).toBe('Injury Hold');
    // Historical record survives the status change.
    expect(ana.record.wins).toBe(1);
  });

  it('shows Challenge Pending for players with an open challenge (AC-1.2.3)', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Bea', '6-1')],
      roster: new Map(),
      displayNames: names('Ana', 'Bea'),
      config,
      pendingChallengeKeys: new Set([k('Bea')]),
    });
    expect(result.standings.find((s) => s.displayName === 'Bea')!.displayStatus).toBe(
      'Challenge Pending',
    );
    expect(result.standings.find((s) => s.displayName === 'Ana')!.displayStatus).toBe('Available');
  });

  it('computes movement against the ladder as it stood 30 days ago (AC-1.2.2)', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const matches = [
      // Old results: Bea clearly ahead of Ana.
      match('Bea', 'Ana', '6-0', { date: daysAgo(60, now) }),
      match('Bea', 'Cat', '6-1', { date: daysAgo(55, now) }),
      match('Cat', 'Ana', '6-2', { date: daysAgo(50, now) }),
      // Recent: Ana turns it around.
      match('Ana', 'Bea', '6-0', { date: daysAgo(5, now) }),
      match('Ana', 'Cat', '6-0', { date: daysAgo(3, now) }),
    ];
    const result = buildLadder({
      matches,
      roster: new Map(),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config,
      now,
    });
    const ana = result.standings.find((s) => s.displayName === 'Ana')!;
    expect(ana.previousRank).not.toBeNull();
    expect(ana.movement).not.toBeNull();
    expect(ana.movement!).toBeGreaterThan(0); // climbed
    expect(ana.previousRank!).toBeGreaterThan(ana.rank);
  });

  it('reports no movement at all when the sheet has no dates', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Bea', '6-1'), match('Bea', 'Cat', '6-2')],
      roster: new Map(),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config,
    });
    // Inventing arrows from undated data would be a fabrication.
    for (const row of result.standings) {
      expect(row.previousRank).toBeNull();
      expect(row.movement).toBeNull();
    }
  });

  it('warns when part of the ladder has never played the rest', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Bea', '6-1'), match('Cat', 'Dee', '6-1')],
      roster: new Map(),
      displayNames: names('Ana', 'Bea', 'Cat', 'Dee'),
      config,
    });
    expect(result.issues.some((i) => i.code === 'disconnected-ladder')).toBe(true);
  });

  it('produces an identical board on repeated runs', () => {
    const build = () =>
      buildLadder({
        matches: [match('Ana', 'Bea', '6-2'), match('Cat', 'Ana', '7-5'), match('Bea', 'Cat', '6-4')],
        roster: new Map(),
        displayNames: names('Ana', 'Bea', 'Cat'),
        config,
      });
    expect(order(build().standings)).toEqual(order(build().standings));
  });
});

describe('challenge ladder mode', () => {
  const challengeConfig: LadderConfig = { ...config, ladderMode: 'challenge' };

  it('starts from the coach seeds when no challenges have been played', () => {
    const result = buildLadder({
      matches: [],
      roster: roster(
        { displayName: 'Ana', seedRank: 2 },
        { displayName: 'Bea', seedRank: 1 },
        { displayName: 'Cat', seedRank: 3 },
      ),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config: challengeConfig,
    });
    expect(order(result.standings)).toEqual(['Bea', 'Ana', 'Cat']);
  });

  it('replays challenge wins over the seeds in chronological order', () => {
    const result = buildLadder({
      // Cat (seed 3) beats Bea (seed 1) -> Cat takes #1, Bea to #2, Ana to #3.
      matches: [match('Cat', 'Bea', '6-4', { sheetRow: 2 })],
      roster: roster(
        { displayName: 'Bea', seedRank: 1 },
        { displayName: 'Ana', seedRank: 2 },
        { displayName: 'Cat', seedRank: 3 },
      ),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config: challengeConfig,
    });
    expect(order(result.standings)).toEqual(['Cat', 'Bea', 'Ana']);
  });

  it('leaves the order alone when the defender holds serve', () => {
    const result = buildLadder({
      matches: [match('Cat', 'Bea', '4-6', { sheetRow: 2 })],
      roster: roster(
        { displayName: 'Bea', seedRank: 1 },
        { displayName: 'Ana', seedRank: 2 },
        { displayName: 'Cat', seedRank: 3 },
      ),
      displayNames: names('Ana', 'Bea', 'Cat'),
      config: challengeConfig,
    });
    expect(order(result.standings)).toEqual(['Bea', 'Ana', 'Cat']);
  });

  it('appends unseeded players below the seeded block', () => {
    const result = buildLadder({
      matches: [match('Ana', 'Dee', '6-1', { sheetRow: 2 })],
      roster: roster({ displayName: 'Ana', seedRank: 1 }, { displayName: 'Bea', seedRank: 2 }),
      displayNames: names('Ana', 'Bea', 'Dee'),
      config: challengeConfig,
    });
    expect(order(result.standings).slice(0, 2)).toEqual(['Ana', 'Bea']);
    expect(order(result.standings)).toContain('Dee');
  });
});

describe('team splitting (PRD 6.1)', () => {
  it('reads teams from the roster', () => {
    const teams = resolveTeams(
      [match('Ana', 'Bea', '6-1')],
      roster({ displayName: 'Ana', team: 'Girls' }, { displayName: 'Bea', team: 'Girls' }),
    );
    expect(teams.get(k('Ana'))).toBe('Girls');
    expect(listTeams(teams)).toEqual(['Girls']);
  });

  it('reads teams from a Team column on the matches', () => {
    const matches = [
      match('Ana', 'Bea', '6-1', { team: 'Girls' }),
      match('Cal', 'Dan', '6-1', { team: 'Boys' }),
    ];
    const teams = resolveTeams(matches, new Map());
    expect(listTeams(teams)).toEqual(['Boys', 'Girls']); // Boys first, then Girls
    expect(matchesForTeam(matches, 'Boys', teams)).toHaveLength(1);
    expect(matchesForTeam(matches, 'Girls', teams)).toHaveLength(1);
  });

  it('keeps the two ladders completely separate', () => {
    const matches = [
      match('Ana', 'Bea', '6-1', { team: 'Girls' }),
      match('Cal', 'Dan', '6-1', { team: 'Boys' }),
    ];
    const teams = resolveTeams(matches, new Map());
    const girls = buildLadder({
      matches: matchesForTeam(matches, 'Girls', teams),
      roster: new Map(),
      displayNames: names('Ana', 'Bea', 'Cal', 'Dan'),
      config,
    });
    expect(order(girls.standings)).toEqual(['Ana', 'Bea']);
  });
});
