import { describe, expect, it } from 'vitest';
import { normalizeHeader, parseCsv, toTable } from '../lib/csv';

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // This is the case that matters most here: score summaries contain commas.
    const rows = parseCsv('Player,Score\nJake,"6-4, 7-5"');
    expect(rows[1]).toEqual(['Jake', '6-4, 7-5']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"He said ""hi"""')[1]).toEqual(['He said "hi"']);
  });

  it('keeps newlines inside quoted fields', () => {
    const rows = parseCsv('Note\n"line one\nline two"');
    expect(rows[1]).toEqual(['line one\nline two']);
  });

  it('handles CRLF, LF and bare CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toHaveLength(2);
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
    expect(parseCsv('a,b\r1,2')).toHaveLength(2);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿Player,Score\nJake,6-1')[0]).toEqual(['Player', 'Score']);
  });

  it('drops fully blank rows but keeps rows with any content', () => {
    const rows = parseCsv('a,b\n1,2\n,\n\n3,4');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('preserves empty cells inside a populated row', () => {
    expect(parseCsv('a,b,c\n1,,3')[1]).toEqual(['1', '', '3']);
  });

  it('trims unquoted fields but not quoted ones', () => {
    const rows = parseCsv('a,b\n  x  ,"  y  "');
    expect(rows[1]).toEqual(['x', '  y  ']);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('toTable', () => {
  it('separates headers from body and reports true sheet row numbers', () => {
    const table = toTable(parseCsv('Person 1,Person 2\nJake,Marcus\nMike,Pedro'));
    expect(table.headers).toEqual(['Person 1', 'Person 2']);
    expect(table.rows).toHaveLength(2);
    // Row 1 is the header, so the first data row is sheet row 2.
    expect(table.sheetRowFor(0)).toBe(2);
    expect(table.sheetRowFor(1)).toBe(3);
  });
});

describe('normalizeHeader', () => {
  it('folds case, punctuation and spacing', () => {
    expect(normalizeHeader('Person 1 Score')).toBe('person 1 score');
    expect(normalizeHeader('player_1_score')).toBe('player 1 score');
    expect(normalizeHeader('  Match-Date  ')).toBe('match date');
    expect(normalizeHeader('Winner?')).toBe('winner');
  });
});
