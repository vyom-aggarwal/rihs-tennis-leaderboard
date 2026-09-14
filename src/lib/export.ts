/**
 * Standings exports: a CSV a coach can open in Sheets or Excel, and plain text to paste
 * into a team group chat or an email to the athletic director.
 */

import type { MatchFormat, StandingRow } from './types';

const GRADE_NAME: Record<number, string> = { 9: 'Freshman', 10: 'Sophomore', 11: 'Junior', 12: 'Senior' };

/**
 * One CSV cell. A value starting with = + - or @ would run as a formula when the file is
 * opened in a spreadsheet, so it is prefixed with an apostrophe - player names come from a
 * shared sheet, and an export must never execute anything.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function movementText(movement: number | null): string {
  if (movement === null) return '';
  if (movement === 0) return 'Same';
  return movement > 0 ? 'Up ' + movement : 'Down ' + Math.abs(movement);
}

export function standingsCsv(standings: StandingRow[], format: MatchFormat): string {
  const header = [
    'Rank', 'Movement', format === 'doubles' ? 'Pair' : 'Player', 'Grade', 'Division', 'Status',
    'Wins', 'Losses', 'Win %', 'Games won', 'Games lost', 'Rating', 'Provisional',
  ];
  const rows = standings.map((r) => {
    const played = r.record.matches > 0;
    return [
      r.rank,
      movementText(r.movement),
      r.displayName,
      r.grade ? GRADE_NAME[r.grade] ?? String(r.grade) : '',
      r.division === 'Unassigned' ? '' : r.division,
      r.displayStatus,
      r.record.wins,
      r.record.losses,
      played ? Math.round(r.winPct * 100) + '%' : '',
      r.record.gamesWon,
      r.record.gamesLost,
      played ? r.rating.toFixed(2) : '',
      played ? (r.provisional ? 'Yes' : 'No') : '',
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function standingsText(standings: StandingRow[], title: string): string {
  const lines = standings.map(
    (r) =>
      r.rank +
      '. ' +
      r.displayName +
      ' — ' +
      r.record.wins +
      '-' +
      r.record.losses +
      (r.record.matches > 0 ? ', rating ' + r.rating.toFixed(2) : '') +
      (r.displayStatus === 'Available' ? '' : ' (' + r.displayStatus + ')'),
  );
  return [title, ...lines].join('\n');
}

/** e.g. "rihs-girls-doubles-2026-09-13.csv" */
export function exportFileName(label: string, date: Date): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ladder';
  const pad = (n: number) => String(n).padStart(2, '0');
  return 'rihs-' + slug + '-' + date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '.csv';
}
