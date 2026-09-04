import { describe, expect, it } from 'vitest';
import { canChallenge, challengeOptions, daysSinceLastMeeting, eligibleTargets, pendingChallengeKeys } from '../lib/challenge';
import { buildLadder } from '../lib/ladder';
import { playerKey } from '../lib/schema';
import { DEFAULT_LADDER_CONFIG, type LadderConfig, type RosterEntry, type StandingRow } from '../lib/types';
import { match, names } from './helpers';

const k = playerKey;
const config: LadderConfig = { ...DEFAULT_LADDER_CONFIG };

/** Build a synthetic 8-player ladder with known ranks, matching the QA pre-conditions. */
function ladderOf(count: number, overrides: Partial<Record<number, Partial<StandingRow>>> = {}): StandingRow[] {
  return Array.from({ length: count }, (_, i) => {
    const rank = i + 1;
    const name = 'P' + rank;
    return {
      key: k(name),
      displayName: name,
      team: null,
      grade: null,
      division: 'Unassigned',
      activeStatus: 'Active',
      displayStatus: 'Available',
      avatarUrl: null,
      rank,
      previousRank: null,
      movement: null,
      rating: 5 - i * 0.1,
      provisional: false,
      confidence: 1,
      record: { wins: 0, losses: 0, matches: 0, gamesWon: 0, gamesLost: 0, setsWon: 0, setsLost: 0 },
      winPct: 0,
      gamesWonPct: 0,
      streak: { current: 0, longestWin: 0, last5: [] },
      beat: [],
      lostTo: [],
      ...(overrides[rank] ?? {}),
    } satisfies StandingRow;
  });
}

describe('challenge range (AC-2.1.1)', () => {
  const standings = ladderOf(8);

  it('offers exactly ranks 7, 6 and 5 to the player at rank 8', () => {
    const eligible = eligibleTargets({ challengerKey: k('P8'), standings, matches: [], config });
    expect(eligible.map((o) => o.rank)).toEqual([5, 6, 7]);
  });

  it('marks rank 4 as too far ahead rather than hiding it', () => {
    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: [], config });
    const p4 = options.find((o) => o.rank === 4)!;
    expect(p4.eligible).toBe(false);
    expect(p4.reason).toMatch(/too far ahead/i);
    // TC-2.1.1 step 2 wants it present but disabled, not absent.
    expect(p4.reason).toContain('5-7');
  });

  it('never offers players ranked below the challenger', () => {
    const options = challengeOptions({ challengerKey: k('P5'), standings, matches: [], config });
    expect(options.every((o) => o.rank < 5)).toBe(true);
  });

  it('gives the top player nobody to challenge', () => {
    expect(eligibleTargets({ challengerKey: k('P1'), standings, matches: [], config })).toEqual([]);
  });

  it('honours a custom challenge range', () => {
    const narrow = eligibleTargets({
      challengerKey: k('P8'),
      standings,
      matches: [],
      config: { ...config, challengeRange: 1 },
    });
    expect(narrow.map((o) => o.rank)).toEqual([7]);
  });
});

describe('challenge blocking (AC-2.1.2, AC-3.1.2)', () => {
  it('blocks a challenge when the defender is on injury hold', () => {
    const standings = ladderOf(8, { 6: { activeStatus: 'Injured', displayStatus: 'Injury Hold' } });
    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: [], config });
    const p6 = options.find((o) => o.rank === 6)!;
    expect(p6.eligible).toBe(false);
    expect(p6.reason).toMatch(/injury hold/i);
  });

  it('blocks every challenge when the challenger is on injury hold', () => {
    const standings = ladderOf(8, { 8: { activeStatus: 'Injured', displayStatus: 'Injury Hold' } });
    expect(eligibleTargets({ challengerKey: k('P8'), standings, matches: [], config })).toEqual([]);
  });

  it('blocks a challenge when either player already has one open', () => {
    const standings = ladderOf(8);
    const open = [{ challengerKey: k('P7'), defenderKey: k('P5'), createdAt: null }];

    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: [], config, openChallenges: open });
    expect(options.find((o) => o.rank === 7)!.eligible).toBe(false);
    expect(options.find((o) => o.rank === 5)!.eligible).toBe(false);
    expect(options.find((o) => o.rank === 6)!.eligible).toBe(true);
  });

  it('blocks a player who is inactive', () => {
    const standings = ladderOf(8, { 7: { activeStatus: 'Inactive', displayStatus: 'Inactive' } });
    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: [], config });
    expect(options.find((o) => o.rank === 7)!.eligible).toBe(false);
  });
});

describe('cooling-off period', () => {
  const standings = ladderOf(8);
  const now = new Date('2026-09-01T12:00:00Z');

  it('blocks a rematch inside the window and says when it reopens', () => {
    const recent = [
      match('P8', 'P6', '6-4, 6-3', { date: new Date('2026-08-29T12:00:00Z') }), // 3 days ago
    ];
    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: recent, config, now });
    const p6 = options.find((o) => o.rank === 6)!;
    expect(p6.eligible).toBe(false);
    expect(p6.reason).toMatch(/cooling-off/i);
    expect(p6.reason).toMatch(/4 days/); // 7-day window, played 3 days ago
  });

  it('allows the rematch once the window has passed', () => {
    const old = [match('P8', 'P6', '6-4, 6-3', { date: new Date('2026-08-20T12:00:00Z') })];
    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: old, config, now });
    expect(options.find((o) => o.rank === 6)!.eligible).toBe(true);
  });

  it('does not restrict a pair that has never played', () => {
    const options = challengeOptions({ challengerKey: k('P8'), standings, matches: [], config, now });
    expect(options.find((o) => o.rank === 6)!.eligible).toBe(true);
  });
});

describe('daysSinceLastMeeting', () => {
  const now = new Date('2026-09-01T12:00:00Z');

  it('finds the most recent meeting in either column order', () => {
    const matches = [
      match('A', 'B', '6-1', { date: new Date('2026-08-01T12:00:00Z') }),
      match('B', 'A', '6-2', { date: new Date('2026-08-25T12:00:00Z') }),
    ];
    expect(daysSinceLastMeeting(matches, k('A'), k('B'), now)).toBe(7);
  });

  it('returns null when they have never met or the meeting is undated', () => {
    expect(daysSinceLastMeeting([], k('A'), k('B'), now)).toBeNull();
    expect(daysSinceLastMeeting([match('A', 'B', '6-1')], k('A'), k('B'), now)).toBeNull();
  });
});

describe('canChallenge', () => {
  const standings = ladderOf(8);

  it('allows a legal challenge', () => {
    expect(canChallenge({ challengerKey: k('P8'), defenderKey: k('P6'), standings, matches: [], config }).allowed).toBe(true);
  });

  it('rejects a challenge beyond the range with a reason', () => {
    const r = canChallenge({ challengerKey: k('P8'), defenderKey: k('P4'), standings, matches: [], config });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/too far ahead/i);
  });

  it('rejects challenging downward', () => {
    const r = canChallenge({ challengerKey: k('P4'), defenderKey: k('P8'), standings, matches: [], config });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/above you/i);
  });

  it('rejects a player who is not on the ladder', () => {
    const r = canChallenge({ challengerKey: k('P4'), defenderKey: k('ghost'), standings, matches: [], config });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not on this ladder/i);
  });
});

describe('pendingChallengeKeys', () => {
  it('collects both sides of every open challenge', () => {
    const keys = pendingChallengeKeys([
      { challengerKey: 'a', defenderKey: 'b', createdAt: null },
      { challengerKey: 'c', defenderKey: 'd', createdAt: null },
    ]);
    expect([...keys].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('end-to-end against a real computed ladder', () => {
  it('derives eligibility from the ranks the engine produced', () => {
    const matches = [
      match('Ana', 'Bea', '6-1'),
      match('Bea', 'Cat', '6-2'),
      match('Cat', 'Dee', '6-2'),
      match('Ana', 'Cat', '6-0'),
      match('Bea', 'Dee', '6-1'),
      match('Ana', 'Dee', '6-0'),
    ];
    const roster = new Map<string, RosterEntry>();
    const ladder = buildLadder({ matches, roster, displayNames: names('Ana', 'Bea', 'Cat', 'Dee'), config });
    expect(ladder.standings.map((s) => s.displayName)).toEqual(['Ana', 'Bea', 'Cat', 'Dee']);

    // Dee is rank 4; with a 3-spot range she may challenge everyone above her.
    const dee = eligibleTargets({ challengerKey: k('Dee'), standings: ladder.standings, matches: [], config });
    expect(dee.map((o) => o.displayName)).toEqual(['Ana', 'Bea', 'Cat']);

    // With a 1-spot range she may only challenge Cat.
    const narrow = eligibleTargets({
      challengerKey: k('Dee'),
      standings: ladder.standings,
      matches: [],
      config: { ...config, challengeRange: 1 },
    });
    expect(narrow.map((o) => o.displayName)).toEqual(['Cat']);
  });
});
