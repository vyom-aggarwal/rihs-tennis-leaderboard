import { describe, expect, it } from 'vitest';
import { parseCsv, toTable } from '../lib/csv';
import {
  detectMatchMapping,
  detectRosterMapping,
  mapMatches,
  mapRoster,
  pairKey,
  parseActiveStatus,
  parseApproval,
  parseDate,
  parseDivision,
  parseFormat,
  parseGrade,
  parseTeam,
  playerKey,
  splitPair,
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
    expect(parseActiveStatus('Injury Hold')).toBe('Injured');
    expect(parseActiveStatus('ankle hold')).toBe('Injured');
    expect(parseActiveStatus('Out - wrist')).toBe('Injured');
    expect(parseActiveStatus('Inactive')).toBe('Inactive');
    expect(parseActiveStatus('Left team')).toBe('Inactive');
    expect(parseActiveStatus('')).toBe('Active');
  });

  it('matches status words whole, so ordinary phrases are not read as injuries', () => {
    expect(parseActiveStatus('Active without restrictions')).toBe('Active');
    expect(parseActiveStatus('Available')).toBe('Active');
    expect(parseActiveStatus('Officially cleared')).toBe('Active');
  });

  it('treats a sheet with no status column as already verified', () => {
    // A coach's own sheet is the record of truth; requiring an approval column
    // would make every bare results sheet import as zero countable matches.
    expect(parseApproval('')).toBe('Verified');
    expect(parseApproval('Pending')).toBe('Pending');
    expect(parseApproval('Approved')).toBe('Verified');
    expect(parseApproval('Rejected')).toBe('Rejected');
  });

  it('never counts an unticked checkbox or a "No" as verified', () => {
    // A Verified checkbox column exports TRUE / FALSE.
    expect(parseApproval('TRUE')).toBe('Verified');
    expect(parseApproval('FALSE')).toBe('Pending');
    expect(parseApproval('No')).toBe('Pending');
    expect(parseApproval('Not verified')).toBe('Pending');
    expect(parseApproval('Unverified')).toBe('Pending');
  });

  it('treats a cancelled or declined challenge as rejected', () => {
    expect(parseApproval('Cancelled')).toBe('Rejected');
    expect(parseApproval('Declined')).toBe('Rejected');
    expect(parseApproval('Withdrawn')).toBe('Rejected');
  });
});

describe('parseDate edge cases', () => {
  const reference = new Date(2026, 8, 4); // Sep 4 2026

  it('reads a date cell exported as a Sheets serial number', () => {
    // Serial 45658 is 2025-01-01 in both Sheets and Excel; 2026-09-03 is 608 days later.
    const d = parseDate('46266', reference)!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 1]);
    const newYear = parseDate('45658', reference)!;
    expect([newYear.getFullYear(), newYear.getMonth(), newYear.getDate()]).toEqual([2025, 0, 1]);
  });

  it('refuses a bare number that cannot be a date instead of reading it as a year', () => {
    expect(parseDate('3', reference)).toBeNull();
    expect(parseDate('2026', reference)).toBeNull();
  });

  it('reads day-first dates when the first number can only be a day', () => {
    const d = parseDate('25/12/2026', reference)!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 25]);
  });

  it('rejects impossible calendar dates rather than rolling them over', () => {
    expect(parseDate('2/30/2026', reference)).toBeNull();
    expect(parseDate('2026-13-01', reference)).toBeNull();
  });

  it('places a date typed without a year in the nearest season', () => {
    const slash = parseDate('9/3', reference)!;
    expect([slash.getFullYear(), slash.getMonth(), slash.getDate()]).toEqual([2026, 8, 3]);
    const named = parseDate('Sep 3', reference)!;
    expect(named.getFullYear()).toBe(2026);
    // A December result read in early January belongs to the previous year.
    expect(parseDate('12/20', new Date(2027, 0, 5))!.getFullYear()).toBe(2026);
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

  it('reads a row with two players and no score as an open challenge (AC-1.2.3, AC-2.1.2)', () => {
    const r = mapFrom('Date,Person 1,Person 2,Score\n2026-09-01,Jake,Marcus,6-1\n2026-09-03,Pedro,Jake,');
    expect(r.matches).toHaveLength(1);
    expect(r.issues).toHaveLength(0);
    expect(r.openChallenges).toEqual([
      { challengerKey: 'pedro', defenderKey: 'jake', createdAt: new Date(2026, 8, 3), sheetRow: 3 },
    ]);
  });

  it('works for a two-score-column sheet too', () => {
    const r = mapFrom('Person 1,Person 2,Person 1 Score,Person 2 Score\nJake,Marcus,,');
    expect(r.openChallenges).toHaveLength(1);
    expect(r.matches).toHaveLength(0);
  });

  it('drops a cancelled challenge without reporting it', () => {
    const r = mapFrom('Person 1,Person 2,Score,Status\nPedro,Jake,,Cancelled');
    expect(r.openChallenges).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
  });

  it('still reports a row that names a winner but has no score', () => {
    const r = mapFrom('Person 1,Person 2,Winner,Score\nPedro,Jake,Jake,');
    expect(r.openChallenges).toHaveLength(0);
    expect(r.issues.some((i) => i.code === 'unparseable-score')).toBe(true);
  });

  it('warns about a result dated in the future, but still counts it', () => {
    const t = table('Date,Person 1,Person 2,Score\n2062-09-01,Jake,Marcus,6-1');
    const r = mapMatches(t, detectMatchMapping(t), { strictScores: false, now: new Date(2026, 8, 4) });
    expect(r.matches).toHaveLength(1);
    expect(r.issues.some((i) => i.code === 'future-date' && i.sheetRow === 2)).toBe(true);
  });
});

describe('doubles', () => {
  const mapFrom = (csv: string, options: Partial<Parameters<typeof mapMatches>[2]> = {}) => {
    const t = table(csv);
    return mapMatches(t, detectMatchMapping(t), { strictScores: false, ...options });
  };

  it('reads format values and pair notation', () => {
    expect(parseFormat('Doubles')).toBe('doubles');
    expect(parseFormat('D')).toBe('doubles');
    expect(parseFormat('Mixed doubles')).toBe('doubles');
    expect(parseFormat('singles')).toBe('singles');
    expect(parseFormat('')).toBeNull();
    expect(parseFormat('Exhibition')).toBeNull();
    expect(splitPair('Jake Whitmore / Marcus Webb')).toEqual(['Jake Whitmore', 'Marcus Webb']);
    expect(splitPair('Jake & Marcus')).toEqual(['Jake', 'Marcus']);
    expect(splitPair('Jake+Marcus')).toEqual(['Jake', 'Marcus']);
    expect(splitPair('Jake Whitmore')).toBeNull();
    expect(splitPair('Jake / Marcus / Pedro')).toBe('invalid');
    expect(splitPair('Jake /')).toBe('invalid');
  });

  it('gives a pair the same key whichever partner is written first', () => {
    expect(pairKey(['marcus', 'jake'])).toBe(pairKey(['jake', 'marcus']));
    expect(pairKey(['jake', 'marcus'])).not.toBe('jake');
  });

  it('reads a row written as pairs as a doubles match between two teams', () => {
    const r = mapFrom('Pair 1,Pair 2,Score\nJake / Marcus,Pedro & adrian,"6-4, 6-3"\nmarcus / JAKE,Adrian / Pedro,"3-6, 2-6"');
    expect(r.issues).toEqual([]);
    expect(r.matches).toHaveLength(2);
    const [first, second] = r.matches;
    expect(first!.format).toBe('doubles');
    expect(first!.partnersA).toEqual(['jake', 'marcus']);
    expect(first!.playerA).toBe(second!.playerA); // same pair, partners written in either order
    expect(first!.playerB).toBe(second!.playerB);
    expect(r.displayNames.get(first!.playerA)).toBe('Jake / Marcus');
    expect(r.displayNames.get(first!.playerB)).toBe('Adrian / Pedro');
    expect(r.pairPartners.get(first!.playerB)).toEqual(['adrian', 'pedro']);
  });

  it('uses a Format column, and forces doubles on the Doubles tab', () => {
    const marked = mapFrom('Type,Person 1,Person 2,Score\nDoubles,Jake / Marcus,Pedro / Adrian,6-4\nSingles,Jake,Pedro,6-2');
    expect(marked.matches.map((m) => m.format)).toEqual(['doubles', 'singles']);

    const tab = mapFrom('Pair 1,Pair 2,Score\nJake,Pedro,6-4', { format: 'doubles', tab: 'Doubles tab', idPrefix: 'd' });
    expect(tab.matches).toHaveLength(0);
    expect(tab.issues[0]).toMatchObject({ code: 'doubles-needs-pairs', tab: 'Doubles tab', sheetRow: 2 });
  });

  it('refuses rows that mix a pair with a single player, or list one player twice', () => {
    expect(mapFrom('Person 1,Person 2,Score\nJake / Marcus,Pedro,6-4').issues[0]!.code).toBe('doubles-needs-pairs');
    expect(mapFrom('Person 1,Person 2,Score\nJake / Marcus,Pedro / jake,6-4').issues[0]!.code).toBe('self-match');
    expect(mapFrom('Type,Person 1,Person 2,Score\nSingles,Jake / Marcus,Pedro,6-4').issues[0]!.code).toBe('singles-has-pair');
  });

  it('accepts a Winner cell naming the whole pair or just one partner', () => {
    const r = mapFrom('Pair 1,Pair 2,Winner,Score\nJake / Marcus,Pedro / Adrian,Adrian,6-4\nJake / Marcus,Pedro / Adrian,Marcus / Jake,4-6');
    expect(r.matches.map((m) => m.winner)).toEqual(['b', 'a']);
    expect(r.issues.map((i) => i.code)).toEqual(['winner-mismatch', 'winner-mismatch']);
  });

  it('records a score-less doubles row as an open challenge between pairs', () => {
    const r = mapFrom('Pair 1,Pair 2,Score\nJake / Marcus,Pedro / Adrian,');
    expect(r.openChallenges).toHaveLength(1);
    expect(r.openChallenges[0]!.challengerKey).toBe(pairKey(['jake', 'marcus']));
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
