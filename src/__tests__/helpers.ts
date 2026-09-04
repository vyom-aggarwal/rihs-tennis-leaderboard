import { parseGameColumns, parseScoreString } from '../lib/score';
import { playerKey } from '../lib/schema';
import type { Match } from '../lib/types';

let counter = 0;

/**
 * Build a Match for tests. `score` accepts either a summary string ("6-4, 7-5") or a
 * "6-1" style single set. The winner is derived from the score unless overridden.
 */
export function match(
  a: string,
  b: string,
  score: string,
  options: Partial<Pick<Match, 'date' | 'team' | 'approval' | 'isChallenge' | 'sheetRow'>> = {},
): Match {
  const parsed = score.includes(',')
    ? parseScoreString(score)!
    : (parseScoreString(score) ?? parseGameColumns(...(score.split('-') as [string, string]))!);

  if (!parsed || parsed.winner === null) {
    throw new Error('Test match score did not yield a winner: ' + score);
  }

  counter += 1;
  return {
    id: 'test-' + counter,
    sheetRow: options.sheetRow ?? counter + 1,
    playerA: playerKey(a),
    playerB: playerKey(b),
    displayA: a,
    displayB: b,
    score: parsed,
    winner: parsed.winner,
    date: options.date ?? null,
    team: options.team ?? null,
    approval: options.approval ?? 'Verified',
    isChallenge: options.isChallenge ?? false,
  };
}

export function names(...list: string[]): Map<string, string> {
  return new Map(list.map((n) => [playerKey(n), n]));
}

/** Display names in ladder order, for readable assertions. */
export function order(standings: Array<{ displayName: string }>): string[] {
  return standings.map((s) => s.displayName);
}

export function daysAgo(days: number, from = new Date('2026-09-01T12:00:00Z')): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

export const SAMPLE_CSV = [
  'Person 1,Person 2,Person 1 Score,Person 2 Score',
  'Jake,Marcus,6,1',
  'Adrian,Pedro,2,4',
  'Johnny,Adrian,1,4',
  'Pedro,Johnny,3,6',
  'Jake,Johnny,4,3',
  'Marcus,Adrian,6,2',
  'Mike,Jake,5,6',
].join('\n');
