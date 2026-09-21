/** Small formatting helpers shared across the dashboard. */

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
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

/** GitHub-style wording: "just now", "5 minutes ago", "3 hours ago", "2 days ago", then a date. */
export function longRelativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const unit = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's') + ' ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(Math.max(1, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return unit(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return unit(days, 'day');
  return 'on ' + from.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Coach Lokesh" - the name is stored without the title, but tolerate one that has it. */
export function coachLabel(name: string): string {
  return /^coach\b/i.test(name) ? name : 'Coach ' + name;
}

export function formatDate(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
