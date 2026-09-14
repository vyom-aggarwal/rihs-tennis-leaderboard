import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../lib/dashboard';
import { csvCell, exportFileName, movementText, standingsCsv, standingsText } from '../lib/export';
import { DEFAULT_LADDER_CONFIG } from '../lib/types';
import { SAMPLE_CSV } from './helpers';

const config = { ...DEFAULT_LADDER_CONFIG };
const NOW = new Date('2026-09-04T12:00:00Z');

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Smith, Jr.')).toBe('"Smith, Jr."');
    expect(csvCell('The "Wall"')).toBe('"The ""Wall"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(3.87)).toBe('3.87');
  });

  it('defuses anything a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
  });
});

describe('standings exports', () => {
  const board = () =>
    buildDashboard({ matchesCsv: SAMPLE_CSV, rosterCsv: 'Name,Grade\nJake,12\nNewbie,9', config, now: NOW }).boards[0]!;

  it('writes one header and one row per player, with CRLF line endings', () => {
    const csv = standingsCsv(board().standings, 'singles');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Rank,Movement,Player,Grade,Division,Status,Wins,Losses,Win %,Games won,Games lost,Rating,Provisional');
    expect(lines).toHaveLength(board().standings.length + 1);
    expect(lines[1]).toMatch(/^1,,Jake,Senior,,Available,3,0,100%,16,9,\d\.\d\d,No$/);
  });

  it('leaves rating, win % and provisional blank for a player with no matches', () => {
    const csv = standingsCsv(board().standings, 'singles');
    expect(csv).toMatch(/,Newbie,Freshman,,Available,0,0,,0,0,,\r\n/);
  });

  it('labels the name column Pair for doubles', () => {
    expect(standingsCsv([], 'doubles').split(',')[2]).toBe('Pair');
  });

  it('spells movement out so it never reads as a formula', () => {
    expect(movementText(null)).toBe('');
    expect(movementText(0)).toBe('Same');
    expect(movementText(2)).toBe('Up 2');
    expect(movementText(-1)).toBe('Down 1');
  });

  it('copies as a readable list', () => {
    const text = standingsText(board().standings, 'Team Ladder — River Island High School');
    const lines = text.split('\n');
    expect(lines[0]).toBe('Team Ladder — River Island High School');
    expect(lines[1]).toMatch(/^1\. Jake — 3-0, rating \d\.\d\d$/);
    expect(text).toContain('Newbie — 0-0');
    expect(text).not.toContain('Newbie — 0-0, rating');
  });

  it('names the file after the ladder and the day', () => {
    expect(exportFileName('Girls Doubles', new Date(2026, 8, 13))).toBe('rihs-girls-doubles-2026-09-13.csv');
    expect(exportFileName('!!!', new Date(2026, 0, 2))).toBe('rihs-ladder-2026-01-02.csv');
  });
});
