import { describe, expect, it } from 'vitest';
import {
  computeRatings,
  connectedComponents,
  gameMargin,
  MAX_RATING,
  MIN_RATING,
  toNtrpLevel,
} from '../lib/rating';
import { playerKey } from '../lib/schema';
import { DEFAULT_LADDER_CONFIG } from '../lib/types';
import { match } from './helpers';

const config = { baseRating: 3.5, minMatchesForRating: 3 };
const k = playerKey;

describe('gameMargin', () => {
  it('is +1 for a shutout and 0 for an even split', () => {
    expect(gameMargin(match('A', 'B', '6-0'))).toBe(1);
    expect(gameMargin(match('A', 'B', '6-4'))).toBeCloseTo(0.2, 10);
    expect(gameMargin(match('A', 'B', '4-6'))).toBeCloseTo(-0.2, 10);
  });

  it('is symmetric between the two players', () => {
    const m = match('A', 'B', '6-2');
    expect(gameMargin(m)).toBeCloseTo(0.5, 10);
  });
});

describe('computeRatings', () => {
  it('rates the winner above the loser', () => {
    const { ratings } = computeRatings({ matches: [match('A', 'B', '6-2')], config });
    expect(ratings.get(k('A'))!.rating).toBeGreaterThan(ratings.get(k('B'))!.rating);
  });

  it('anchors the squad mean at the base rating', () => {
    const matches = [match('A', 'B', '6-2'), match('B', 'C', '6-3'), match('C', 'A', '6-4')];
    const { ratings } = computeRatings({ matches, config });
    const values = [...ratings.values()].map((r) => r.rating);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeCloseTo(3.5, 6);
  });

  it('separates players by roughly half a level at a 6-2 margin', () => {
    // The calibration anchor from the module header: m = 0.5 => a 0.5 rating gap.
    const { ratings } = computeRatings({ matches: [match('A', 'B', '6-2')], config });
    const gap = ratings.get(k('A'))!.rating - ratings.get(k('B'))!.rating;
    expect(gap).toBeCloseTo(0.5, 2);
  });

  it('rewards beating a stronger opponent more than beating a weaker one', () => {
    // Strong beats Weak badly, establishing the gap. Then Rise beats Strong and
    // Fall beats Weak, by identical margins.
    const matches = [
      match('Strong', 'Weak', '6-0'),
      match('Strong', 'Weak', '6-0'),
      match('Rise', 'Strong', '6-4'),
      match('Fall', 'Weak', '6-4'),
    ];
    const { ratings } = computeRatings({ matches, config });
    expect(ratings.get(k('Rise'))!.rating).toBeGreaterThan(ratings.get(k('Fall'))!.rating);
  });

  it('converges on a transitive set of results', () => {
    const matches = [
      match('A', 'B', '6-2'),
      match('B', 'C', '6-2'),
      match('A', 'C', '6-1'),
      match('C', 'D', '6-3'),
    ];
    const result = computeRatings({ matches, config });
    expect(result.converged).toBe(true);
    const r = result.ratings;
    expect(r.get(k('A'))!.rating).toBeGreaterThan(r.get(k('B'))!.rating);
    expect(r.get(k('B'))!.rating).toBeGreaterThan(r.get(k('C'))!.rating);
    expect(r.get(k('C'))!.rating).toBeGreaterThan(r.get(k('D'))!.rating);
  });

  it('stays inside the NTRP scale even for extreme results', () => {
    const matches = Array.from({ length: 30 }, () => match('Ace', 'Novice', '6-0'));
    const { ratings } = computeRatings({ matches, config });
    for (const r of ratings.values()) {
      expect(r.rating).toBeGreaterThanOrEqual(MIN_RATING);
      expect(r.rating).toBeLessThanOrEqual(MAX_RATING);
    }
  });

  it('marks players provisional below the minimum match count', () => {
    const matches = [match('A', 'B', '6-2'), match('A', 'C', '6-3')];
    const { ratings } = computeRatings({ matches, config });
    expect(ratings.get(k('A'))!.matches).toBe(2);
    expect(ratings.get(k('A'))!.provisional).toBe(true);
    expect(ratings.get(k('B'))!.provisional).toBe(true);
  });

  it('clears provisional once the minimum is met', () => {
    const matches = [match('A', 'B', '6-2'), match('A', 'C', '6-3'), match('A', 'D', '6-4')];
    const { ratings } = computeRatings({ matches, config });
    expect(ratings.get(k('A'))!.provisional).toBe(false);
    expect(ratings.get(k('A'))!.distinctOpponents).toBe(3);
  });

  it('gives more confidence to varied opposition than to repeat opponents', () => {
    const varied = computeRatings({
      matches: [match('A', 'B', '6-2'), match('A', 'C', '6-2'), match('A', 'D', '6-2')],
      config,
    });
    const repeat = computeRatings({
      matches: [match('A', 'B', '6-2'), match('A', 'B', '6-2'), match('A', 'B', '6-2')],
      config,
    });
    expect(varied.ratings.get(k('A'))!.confidence).toBeGreaterThan(
      repeat.ratings.get(k('A'))!.confidence,
    );
  });

  it('weights recent results above old ones', () => {
    const now = new Date('2026-09-01');
    const old = new Date('2026-01-01'); // ~8 months earlier
    const matches = [
      match('A', 'B', '6-0', { date: old }),
      match('B', 'A', '6-0', { date: now }),
    ];
    const { ratings } = computeRatings({ matches, config, now });
    // The recent win should carry the day despite the identical earlier loss.
    expect(ratings.get(k('B'))!.rating).toBeGreaterThan(ratings.get(k('A'))!.rating);
  });

  it('ignores matches after the asOf cutoff', () => {
    const matches = [
      match('A', 'B', '6-0', { date: new Date('2026-03-01') }),
      match('B', 'A', '6-0', { date: new Date('2026-08-01') }),
    ];
    const cutoff = new Date('2026-05-01');
    const { ratings } = computeRatings({ matches, config, asOf: cutoff, now: cutoff });
    expect(ratings.get(k('A'))!.matches).toBe(1);
    expect(ratings.get(k('A'))!.rating).toBeGreaterThan(ratings.get(k('B'))!.rating);
  });

  it('is deterministic across runs', () => {
    const build = () => [
      match('A', 'B', '6-2'),
      match('C', 'A', '7-5'),
      match('B', 'C', '6-4'),
    ];
    const first = computeRatings({ matches: build(), config });
    const second = computeRatings({ matches: build(), config });
    for (const [key, value] of first.ratings) {
      expect(second.ratings.get(key)!.rating).toBe(value.rating);
    }
  });

  it('handles an empty match list', () => {
    const result = computeRatings({ matches: [], config });
    expect(result.ratings.size).toBe(0);
    expect(result.components).toEqual([]);
  });
});

describe('connectedComponents', () => {
  it('finds a single group when everyone is linked', () => {
    const matches = [match('A', 'B', '6-2'), match('B', 'C', '6-2')];
    const groups = connectedComponents(matches, [k('A'), k('B'), k('C')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('detects two groups that have never met', () => {
    const matches = [match('A', 'B', '6-2'), match('C', 'D', '6-2')];
    const groups = connectedComponents(matches, [k('A'), k('B'), k('C'), k('D')]);
    expect(groups).toHaveLength(2);
  });

  it('reports disconnection through computeRatings', () => {
    const matches = [match('A', 'B', '6-2'), match('C', 'D', '6-2')];
    expect(computeRatings({ matches, config }).components).toHaveLength(2);
  });
});

describe('toNtrpLevel', () => {
  it('rounds to the nearest published half step', () => {
    expect(toNtrpLevel(3.6)).toBe(3.5);
    expect(toNtrpLevel(3.8)).toBe(4.0);
    expect(toNtrpLevel(0.2)).toBe(MIN_RATING);
    expect(toNtrpLevel(9)).toBe(MAX_RATING);
  });
});

describe('default configuration', () => {
  it('matches the PRD values', () => {
    expect(DEFAULT_LADDER_CONFIG.challengeRange).toBe(3); // AC-2.1.1
    expect(DEFAULT_LADDER_CONFIG.movementWindowDays).toBe(30); // PRD 6.2
    expect(DEFAULT_LADDER_CONFIG.minMatchesForRating).toBe(3); // USTA year-end minimum
  });
});
