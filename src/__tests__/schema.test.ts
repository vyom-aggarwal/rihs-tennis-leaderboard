import { describe, expect, it } from 'vitest';
import { parseCsv, toTable } from '../lib/csv';
import {
  detectMatchMapping,
  detectRosterMapping,
  mapMatches,
  mapRoster,
  parseActiveStatus,
  parseApproval,
  parseDate,
  parseDivision,
  parseGrade,
  parseTeam,
  playerKey,
  validateMapping,
} from '../lib/schema';

const table = (csv: string) => toTable(parseCsv(csv));

describe('detectMatchMapping', () => {
  it('reads the sample sheet headers', () => {
    const m = detectMatchMapping(table('Person 1,Person 2,Person 1 Score,Person 2 Score\nJake,Marcus,6,1'));
    expect(m.playerA).toBe(0);
    expect(m.playerB).toBe(1);
    expect(m.scoreA).toBe(2);
    expect(m.scoreB).toBe(3);
  });

  it('does not mistake "Person 1 Score" for the "Person 1" name column', () => {
    const m = detectMatchMapping(table('Person 1,Person 1 Score,Person 2,Person 2 Score\nJake,6,Marcus,1'));
    expect(m.playerA).toBe(0);
    expect(m.scoreA).toBe(1);
    expect(m.playerB).toBe(2);
    expect(m.scoreB).toBe(3);
  });

  it('reads the demo sheet headers including date, team and status', () => {
    const m = detectMatchMapping(
      table('Date,Team,Person 1,Person 2,Score,Status,Notes\n2026-07-01,Boys,Jake,Marcus,"6-4, 7-5",Verified,'),
    );
    expect(m.date).toBe(0);
    expect(m.team).toBe(1);
    expect(m.playerA).toBe(2);
    expect(m.playerB).toBe(3);
    expect(m.scoreSummary).toBe(4);
    expect(m.approval).toBe(5);
    expect(m.notes).toBe(6);
  });

  it('reads the PRD entity vocabulary', () => {
    const m = detectMatchMapping(table('challenger_id,defender_id,score_summary,match_date\nA,B,6-1,2026-07-01'));
    expect(m.playerA).toBe(0);
    expect(m.playerB).toBe(1);
    expect(m.scoreSummary).toBe(2);
    expect(m.date).toBe(3);
  });

  it('handles Winner / Player A / Player B style sheets', () => {
    const m = detectMatchMapping(table('Player A,Player B,Winner,Score\nA,B,A,6-1'));
    expect(m.playerA).toBe(0);
    expect(m.playerB).toBe(1);
    expect(m.winner).toBe(2);
    expect(m.scoreSummary).toBe(3);
  });

  it('falls back to positional detection for an unlabelled sheet', () => {
    const m = detectMatchMapping(table('col1,col2,col3,col4\nJake,Marcus,6,1'));
    expect(m.playerA).toBe(0);
    expect(m.playerB).toBe(1);
    expect(m.scoreA).toBe(2);
    expect(m.scoreB).toBe(3);
  });
});

describe('validateMapping', () => {
  it('accepts two score columns or a single summary column', () => {
    expect(validateMapping({ ...detectMatchMapping(table('Person 1,Person 2,Person 1 Score,Person 2 Score\nA,B,6,1')) })).toEqual([]);
    expect(validateMapping({ ...detectMatchMapping(table('Person 1,Person 2,Score\nA,B,6-1')) })).toEqual([]);
  });

  it('reports what is missing', () => {
    const missing = validateMapping(detectMatchMapping(table('Foo,Bar\nx,y')));
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe('playerKey', () => {
  it('folds case and whitespace so one player is not split in two', () => {
    expect(playerKey('  Jake  ')).toBe('jake');
    expect(playerKey('JAKE')).toBe(playerKey('Jake'));
    expect(playerKey('Jake  Whitmore')).toBe('jake whitmore');
  });

  it('preserves accented characters', () => {
    expect(playerKey('Pedro Álvarez')).toBe('pedro álvarez');
  });
});

describe('value coercion', () => {
  it('parses ISO and US dates', () => {
    expect(parseDate('2026-07-04')!.getFullYear()).toBe(2026);
    expect(parseDate('2026-07-04')!.getMonth()).toBe(6);
    expect(parseDate('7/4/2026')!.getMonth()).toBe(6);
    expect(parseDate('7/4/26')!.getFullYear()).toBe(2026);
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('normalizes team labels', () => {
    expect(parseTeam('boys')).toBe('Boys');
    expect(parseTeam('B')).toBe('Boys');
    expect(parseTeam('Girls')).toBe('Girls');
    expect(parseTeam('female')).toBe('Girls');
    expect(parseTeam('Mixed')).toBe('Mixed');
    expect(parseTeam('')).toBeNull();
  });

  it('normalizes divisions, accepting both the PRD and user-story vocabulary', () => {
    expect(parseDivision('Varsity')).toBe('Varsity');
    expect(parseDivision('JV')).toBe('JV');
    expect(parseDivision('novice')).toBe('Novice');
    expect(parseDivision('')).toBe('Unassigned');
  });

  it('parses grades from numbers and class names', () => {
    expect(parseGrade('9')).toBe(9);
    expect(parseGrade('Freshman')).toBe(9);
    expect(parseGrade('Sophomore')).toBe(10);
    expect(parseGrade('Junior')).toBe(11);
    expect(parseGrade('Senior')).toBe(12);
    expect(parseGrade('13')).toBeNull();
  });

  it('parses active status', () => {
    expect(parseActiveStatus('Injured')).toBe('Injured');
    expect(parseActiveStatus('ankle hold')).toBe('Injured');
    expect(parseActiveStatus('Inactive')).toBe('Inactive');
    expect(parseActiveStatus('')).toBe('Active');
  });

  it('treats a sheet with no status column as already verified', () => {
    // A coach's own sheet is the record of truth; requiring an approval column
    // would make every bare results sheet import as zero countable matches.
    expect(parseApproval('')).toBe('Verified');
    expect(parseApproval('Pending')).toBe('Pending');
    expect(parseApproval('Approved')).toBe('Verified');
    expect(parseApproval('Rejected')).toBe('Rejected');
  });
});

describe('mapMatches', () => {
  const mapFrom = (csv: string, strict = false) => {
    const t = table(csv);
    return mapMatches(t, detectMatchMapping(t), { strictScores: strict });
  };

  it('imports the sample sheet with no errors', () => {
    const r = mapFrom('Person 1,Person 2,Person 1 Score,Person 2 Score\nJake,Marcus,6,1\nAdrian,Pedro,2,4');
    expect(r.matches).toHaveLength(2);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(r.matches[0]!.winner).toBe('a');
    expect(r.matches[1]!.winner).toBe('b');
  });

  it('reports the sheet row number on every issue', () => {
    const r = mapFrom('Person 1,Person 2,Score\nJake,,6-1\nMike,Pedro,6-2');
    const err = r.issues.find((i) => i.code === 'missing-player')!;
    expect(err.sheetRow).toBe(2); // header is row 1
    expect(r.matches).toHaveLength(1);
  });

  it('skips a row where both columns name the same player', () => {
    const r = mapFrom('Person 1,Person 2,Score\nJake,jake,6-1');
    expect(r.matches).toHaveLength(0);
    expect(r.issues.some((i) => i.code === 'self-match')).toBe(true);
  });

  it('warns but keeps a row whose score is an unfinished set', () => {
    const r = mapFrom('Person 1,Person 2,Person 1 Score,Person 2 Score\nMike,Jake,5,6');
    expect(r.matches).toHaveLength(1);
    expect(r.issues.some((i) => i.code === 'score-format')).toBe(true);
  });

  it('skips a level match, which can never be scored', () => {
    const r = mapFrom('Person 1,Person 2,Person 1 Score,Person 2 Score\nMike,Jake,4,4');
    expect(r.matches).toHaveLength(0);
    expect(r.issues.some((i) => i.code === 'invalid-score')).toBe(true);
  });

  it('prefers an explicit Winner column but flags disagreement with the score', () => {
    const r = mapFrom('Person 1,Person 2,Winner,Score\nJake,Marcus,Marcus,6-1');
    expect(r.matches[0]!.winner).toBe('b');
    expect(r.issues.some((i) => i.code === 'winner-mismatch')).toBe(true);
  });

  it('falls back to the score when the Winner column names someone else', () => {
    const r = mapFrom('Person 1,Person 2,Winner,Score\nJake,Marcus,Steve,6-1');
    expect(r.matches[0]!.winner).toBe('a');
    expect(r.issues.some((i) => i.code === 'unknown-winner')).toBe(true);
  });

  it('unifies spellings of one player and picks the most common form', () => {
    const r = mapFrom('Person 1,Person 2,Score\nJake,Marcus,6-1\njake,Pedro,6-2\nJAKE,Adrian,6-3');
    const keys = new Set(r.matches.map((m) => m.playerA));
    expect(keys.size).toBe(1);
    expect(r.displayNames.get('jake')).toBe('Jake');
  });

  it('ignores blank rows without reporting them', () => {
    const r = mapFrom('Person 1,Person 2,Score\nJake,Marcus,6-1\n,,\nMike,Pedro,6-2');
    expect(r.matches).toHaveLength(2);
    expect(r.issues).toHaveLength(0);
  });

  it('rejects an unfinished set in strict mode', () => {
    const r = mapFrom('Person 1,Person 2,Person 1 Score,Person 2 Score\nMike,Jake,5,6', true);
    expect(r.matches).toHaveLength(0);
    expect(r.issues.some((i) => i.code === 'invalid-score')).toBe(true);
  });
});

describe('roster tab', () => {
  it('detects and maps roster columns', () => {
    const t = table('Name,Team,Grade,Division,Status\nJake Whitmore,Boys,12,Varsity,Active\nMarcus Webb,Boys,11,Varsity,Injured');
    const { entries, issues } = mapRoster(t, detectRosterMapping(t));
    expect(issues).toHaveLength(0);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.grade).toBe(12);
    expect(entries[0]!.division).toBe('Varsity');
    expect(entries[1]!.activeStatus).toBe('Injured');
  });

  it('reads seed ranks for challenge mode', () => {
    const t = table('Name,Rank\nAna,1\nBea,2');
    const { entries } = mapRoster(t, detectRosterMapping(t));
    expect(entries[0]!.seedRank).toBe(1);
    expect(entries[1]!.seedRank).toBe(2);
  });

  it('keeps the first of a duplicated roster entry and warns', () => {
    const t = table('Name,Grade\nAna,11\nana,12');
    const { entries, issues } = mapRoster(t, detectRosterMapping(t));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.grade).toBe(11);
    expect(issues.some((i) => i.code === 'duplicate-roster')).toBe(true);
  });
});
