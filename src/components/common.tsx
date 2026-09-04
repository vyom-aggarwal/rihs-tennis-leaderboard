/** Small shared presentational pieces used across the dashboard. */

import type { DisplayStatus, StandingRow } from '../lib/types';

export function Movement({ movement }: { movement: number | null }) {
  // AC-1.2.2. A null movement means there is no history to compare against - showing a
  // dash is honest, showing a flat arrow would imply the player held their position.
  if (movement === null) {
    return (
      <span className="movement none" title="No ranking history yet for this window">
        –
      </span>
    );
  }
  if (movement === 0) {
    return (
      <span className="movement flat" title="Unchanged">
        <span aria-hidden="true">−</span>
        <span className="sr-only">Unchanged</span>
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span
      className={'movement ' + (up ? 'up' : 'down')}
      title={(up ? 'Up ' : 'Down ') + Math.abs(movement) + ' since 30 days ago'}
    >
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
      {Math.abs(movement)}
      <span className="sr-only">{up ? 'Up' : 'Down'} {Math.abs(movement)} places</span>
    </span>
  );
}

const STATUS_CLASS: Record<DisplayStatus, string> = {
  Available: 'badge-available',
  'Challenge Pending': 'badge-pending',
  'Injury Hold': 'badge-injury',
  Inactive: 'badge-inactive',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={'badge ' + STATUS_CLASS[status]}>{status}</span>;
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({ row }: { row: StandingRow }) {
  if (row.avatarUrl) {
    return <img className="avatar" src={row.avatarUrl} alt="" loading="lazy" width={34} height={34} />;
  }
  return (
    <span className="avatar" aria-hidden="true">
      {initials(row.displayName)}
    </span>
  );
}

/** Grade + division, e.g. "Junior · Varsity". Omits whatever the sheet did not supply. */
export function playerMeta(row: StandingRow): string {
  const GRADE_NAME: Record<number, string> = { 9: 'Freshman', 10: 'Sophomore', 11: 'Junior', 12: 'Senior' };
  const bits: string[] = [];
  if (row.grade) bits.push(GRADE_NAME[row.grade] ?? 'Grade ' + row.grade);
  if (row.division !== 'Unassigned') bits.push(row.division);
  return bits.join(' · ');
}

export function FormRun({ results }: { results: Array<'W' | 'L'> }) {
  if (results.length === 0) return <span className="muted small">–</span>;
  return (
    <span className="form-run" title={'Last ' + results.length + ': ' + results.join('')}>
      {results.map((r, i) => (
        <span key={i} className={'form-pip ' + r.toLowerCase()}>
          {r}
        </span>
      ))}
    </span>
  );
}

export function relativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return seconds + 's ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

export function formatDate(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
