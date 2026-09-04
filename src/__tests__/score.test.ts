import { describe, expect, it } from 'vitest';
import {
  formatScore,
  parseGameColumns,
  parseScoreString,
  validateScore,
  validateSet,
} from '../lib/score';

describe('validateSet', () => {
  it('accepts standard sets to 6', () => {
    for (const [a, b] of [
      [6, 0],
      [6, 1],
      [6, 2],
      [6, 3],
      [6, 4],
      [7, 5],
      [7, 6],
    ] as const) {
      const r = validateSet(a, b);
      expect(r.valid, a + '-' + b).toBe(true);
      expect(r.format).toBe('standard');
    }
  });

  it('accepts short sets to 4, including a 4-3 tiebreak finish', () => {
    for (const [a, b] of [
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
      [5, 3],
      [5, 4],
    ] as const) {
      const r = validateSet(a, b);
      expect(r.valid, a + '-' + b).toBe(true);
      expect(r.format).toBe('short');
    }
  });

  it('accepts pro sets to 8', () => {
    expect(validateSet(8, 6).format).toBe('proset');
    expect(validateSet(9, 7).valid).toBe(true);
  });

  it('rejects a set that is not finished', () => {
    expect(validateSet(6, 5).valid).toBe(false);
    expect(validateSet(6, 5).reason).toMatch(/not a completed set/i);
    expect(validateSet(3, 2).valid).toBe(false);
  });

  it('rejects a tied set', () => {
    expect(validateSet(6, 6).valid).toBe(false);
    expect(validateSet(0, 0).valid).toBe(false);
  });

  it('allows a match tiebreak only as a deciding set', () => {
    expect(validateSet(10, 8, true).valid).toBe(true);
    expect(validateSet(10, 8, false).valid).toBe(false);
    // TC-2.2.1 step 1: a bare "10-2" is not a valid match score.
    expect(validateSet(10, 2, false).valid).toBe(false);
    expect(validateSet(10, 2, false).reason).toMatch(/deciding set/i);
  });

  it('rejects non-integer and negative scores', () => {
    expect(validateSet(6.5, 3).valid).toBe(false);
    expect(validateSet(-1, 3).valid).toBe(false);
  });
});

describe('parseScoreString', () => {
  it('parses a two-set match (AC-2.2.1)', () => {
    const s = parseScoreString('6-4, 7-5')!;
    expect(s.sets).toHaveLength(2);
    expect(s.setsA).toBe(2);
    expect(s.setsB).toBe(0);
    expect(s.gamesA).toBe(13);
    expect(s.gamesB).toBe(9);
    expect(s.winner).toBe('a');
  });

  it('parses a super-tiebreak decider (AC-2.2.1)', () => {
    const s = parseScoreString('6-3, 4-6, 10-8')!;
    expect(s.sets).toHaveLength(3);
    expect(s.sets[2]!.isMatchTiebreak).toBe(true);
    expect(s.winner).toBe('a');
    // The tiebreak counts as one game, not ten, so it cannot swamp the margin.
    expect(s.gamesA).toBe(6 + 4 + 1);
    expect(s.gamesB).toBe(3 + 6 + 0);
    expect(validateScore(s, true).valid).toBe(true);
  });

  it('ignores tiebreak point scores in parentheses', () => {
    const s = parseScoreString('7-6(5), 6-4')!;
    expect(s.gamesA).toBe(13);
    expect(s.winner).toBe('a');
  });

  it('handles whitespace, semicolons and en dashes as separators', () => {
    expect(parseScoreString('6-4 7-5')!.sets).toHaveLength(2);
    expect(parseScoreString('6-4; 7-5')!.sets).toHaveLength(2);
    expect(parseScoreString('6–4, 7–5')!.sets).toHaveLength(2);
  });

  it('awards a retirement to whoever was ahead', () => {
    const s = parseScoreString('6-4, 2-1 ret.')!;
    expect(s.winner).toBe('a');
  });

  it('returns null when there is no score at all', () => {
    expect(parseScoreString('')).toBeNull();
    expect(parseScoreString('   ')).toBeNull();
    expect(parseScoreString('TBD')).toBeNull();
  });

  it('identifies the winner by sets, not games', () => {
    // B wins the match 2 sets to 1 despite A winning more games overall.
    const s = parseScoreString('6-0, 4-6, 4-6')!;
    expect(s.gamesA).toBe(14);
    expect(s.gamesB).toBe(12);
    expect(s.winner).toBe('b');
  });
});

describe('parseGameColumns (the sample sheet shape)', () => {
  it('reads two numeric columns as a one-set match', () => {
    const s = parseGameColumns('6', '1')!;
    expect(s.gamesA).toBe(6);
    expect(s.gamesB).toBe(1);
    expect(s.winner).toBe('a');
    expect(formatScore(s)).toBe('6-1');
  });

  it('reads a win by the second player', () => {
    const s = parseGameColumns('2', '4')!;
    expect(s.winner).toBe('b');
  });

  it('tolerates a full summary pasted into the first score column', () => {
    const s = parseGameColumns('6-4, 7-5', '')!;
    expect(s.sets).toHaveLength(2);
  });

  it('returns null for non-numeric input', () => {
    expect(parseGameColumns('abc', 'def')).toBeNull();
    expect(parseGameColumns('', '')).toBeNull();
  });
});

describe('validateScore', () => {
  it('blocks a bare 10-2 in strict mode (TC-2.2.1 step 1)', () => {
    const s = parseScoreString('10-2')!;
    const strict = validateScore(s, true);
    expect(strict.valid).toBe(false);
    expect(strict.errors.join(' ')).toMatch(/tiebreak/i);
  });

  it('accepts 6-4, 7-5 in strict mode (TC-2.2.1 step 2)', () => {
    expect(validateScore(parseScoreString('6-4, 7-5')!, true).valid).toBe(true);
  });

  it('warns but still ranks an unfinished set in lenient mode', () => {
    // The sample sheet contains 6-5 (Mike v Jake), which is not a completed set.
    const s = parseGameColumns('5', '6')!;
    const lenient = validateScore(s, false);
    expect(lenient.valid).toBe(true);
    expect(lenient.warnings.join(' ')).toMatch(/not a completed set/i);

    expect(validateScore(s, true).valid).toBe(false);
  });

  it('always rejects a level match, in either mode', () => {
    const s = parseGameColumns('4', '4')!;
    expect(validateScore(s, false).valid).toBe(false);
    expect(validateScore(s, true).valid).toBe(false);
  });

  it('warns when set formats are mixed within one match', () => {
    const s = parseScoreString('6-4, 4-1')!;
    expect(validateScore(s, false).warnings.join(' ')).toMatch(/mixed set formats/i);
  });
});
