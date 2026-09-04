/**
 * Coach console: share links, ladder rules, column mapping, and the verification queue.
 *
 * SECURITY NOTE, stated plainly because it matters: coach mode is a URL flag. It hides
 * or shows UI, and it is not authentication. The real access control is Google's own
 * sharing settings on the sheet - only people the coach grants edit access can change
 * any data. Nothing in this panel can write to the sheet, so an unlocked coach view on
 * a borrowed phone exposes settings, never the records.
 */

import { useState } from 'react';
import type { MatchField, MatchMapping } from '../lib/schema';
import { formatScore } from '../lib/score';
import { sortIssues } from '../lib/dashboard';
import type { CsvTable } from '../lib/csv';
import type { DataIssue, LadderConfig, Match } from '../lib/types';
import { formatDate } from './common';

const FIELD_LABELS: Array<{ field: MatchField; label: string; hint: string }> = [
  { field: 'playerA', label: 'First player', hint: 'Required. On a ladder this is the challenger.' },
  { field: 'playerB', label: 'Second player', hint: 'Required. On a ladder this is the defender.' },
  { field: 'scoreA', label: 'First player score', hint: 'Games won, if you keep two score columns.' },
  { field: 'scoreB', label: 'Second player score', hint: 'Games won, if you keep two score columns.' },
  { field: 'scoreSummary', label: 'Score summary', hint: 'One column like "6-4, 7-5". Used instead of the two above.' },
  { field: 'winner', label: 'Winner', hint: 'Optional. Overrides the score if they disagree.' },
  { field: 'date', label: 'Date', hint: 'Optional, but needed for movement arrows and Top Climber.' },
  { field: 'team', label: 'Team', hint: 'Optional. Values like Boys / Girls split the ladders.' },
  { field: 'approval', label: 'Approval status', hint: 'Optional. Pending / Verified / Rejected.' },
  { field: 'notes', label: 'Notes', hint: 'Optional. Shown to you only.' },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard access can be denied; the field beside this button is
          // selectable, so the coach can still copy by hand.
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

interface Props {
  table: CsvTable;
  mapping: MatchMapping;
  onMappingChange: (field: MatchField, index: number) => void;
  config: LadderConfig;
  onConfigChange: (patch: Partial<LadderConfig>) => void;
  issues: DataIssue[];
  matches: Match[];
  displayNames: Map<string, string>;
  teamUrl: string;
  coachLinkUrl: string;
  sheetUrl: string;
  refreshSeconds: number;
  onRefreshSecondsChange: (seconds: number) => void;
}

export function CoachPanel({
  table,
  mapping,
  onMappingChange,
  config,
  onConfigChange,
  issues,
  matches,
  displayNames,
  teamUrl,
  coachLinkUrl,
  sheetUrl,
  refreshSeconds,
  onRefreshSecondsChange,
}: Props) {
  const sorted = sortIssues(issues);
  const errors = sorted.filter((i) => i.severity === 'error');
  const warnings = sorted.filter((i) => i.severity === 'warning');
  const pending = matches.filter((m) => m.approval === 'Pending');
  const nameFor = (key: string) => displayNames.get(key) ?? key;

  return (
    <div className="stack">
      {/* ---------------------------------------------------------- sharing */}
      <section className="card panel">
        <h3>Share with the team</h3>
        <p className="panel-note">
          Send players, parents and administrators this link. It is read-only and always shows the
          current ladder.
        </p>
        <div className="field">
          <label htmlFor="team-link">Team link</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="team-link" readOnly value={teamUrl} onFocus={(e) => e.target.select()} />
            <CopyButton value={teamUrl} label="Copy" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="coach-link">Your coach link</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="coach-link" readOnly value={coachLinkUrl} onFocus={(e) => e.target.select()} />
            <CopyButton value={coachLinkUrl} label="Copy" />
          </div>
          <div className="hint">
            Bookmark this one. It reopens this panel — keep it to yourself, and note that it
            controls what you see, not who can edit the sheet.
          </div>
        </div>
        <a className="btn btn-sm" href={sheetUrl} target="_blank" rel="noopener noreferrer">
          Open the sheet in Google Sheets
        </a>
      </section>

      {/* ------------------------------------------------------ data health */}
      <section className="card panel">
        <h3>Data health</h3>
        <p className="panel-note">
          Every row that could not be read, or that looks unusual, is listed here with its row
          number in your sheet. Nothing is silently dropped.
        </p>

        {errors.length === 0 && warnings.length === 0 ? (
          <div className="notice notice-info" style={{ marginBottom: 0 }}>
            <strong>All {matches.length} rows imported cleanly</strong>
            No formatting problems found.
          </div>
        ) : (
          <>
            {errors.length > 0 && (
              <div className="notice notice-error">
                <strong>
                  {errors.length} row{errors.length === 1 ? '' : 's'} could not be counted
                </strong>
                These are excluded from the ladder until they are fixed in the sheet.
              </div>
            )}
            <ul className="issue-list">
              {sorted.slice(0, 40).map((issue, i) => (
                <li key={i} className="issue">
                  <span className="issue-row">
                    {issue.sheetRow ? 'Row ' + issue.sheetRow : issue.severity === 'error' ? 'Error' : 'Note'}
                  </span>
                  <span>
                    {issue.message}
                    {issue.context && <div className="issue-ctx">{issue.context}</div>}
                  </span>
                </li>
              ))}
            </ul>
            {sorted.length > 40 && (
              <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                …and {sorted.length - 40} more.
              </p>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------ verification queue */}
      {pending.length > 0 && (
        <section className="card panel">
          <h3>Awaiting your verification</h3>
          <p className="panel-note">
            {pending.length} result{pending.length === 1 ? '' : 's'} marked{' '}
            <span className="mono">Pending</span> in the Status column.{' '}
            {config.countPendingMatches
              ? 'These are currently counted in the ladder.'
              : 'These are held out of the ladder until verified.'}{' '}
            Change the Status cell to <span className="mono">Verified</span> in your sheet to
            approve one.
          </p>
          <ul className="match-log">
            {pending.map((m) => (
              <li key={m.id}>
                <span className="issue-row">Row {m.sheetRow}</span>
                <span style={{ flex: 1 }}>
                  {nameFor(m.winner === 'a' ? m.playerA : m.playerB)}{' '}
                  <span className="muted">def.</span>{' '}
                  {nameFor(m.winner === 'a' ? m.playerB : m.playerA)}
                  <br />
                  <span className="leader-detail">{formatDate(m.date)}</span>
                </span>
                <span className="match-score">{formatScore(m.score)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------ ladder rules */}
      <section className="card panel">
        <h3>Ladder rules</h3>
        <p className="panel-note">
          These settings travel in the link you share, so the team sees the ladder under the same
          rules you set here.
        </p>

        <div className="field">
          <label htmlFor="mode">Ranking method</label>
          <select
            id="mode"
            value={config.ladderMode}
            onChange={(e) => onConfigChange({ ladderMode: e.target.value as LadderConfig['ladderMode'] })}
          >
            <option value="rating">Rating — order computed from all results</option>
            <option value="challenge">Challenge ladder — replay challenges over seeded positions</option>
          </select>
          <div className="hint">
            {config.ladderMode === 'rating'
              ? 'Every result counts, weighted by opponent strength and score margin. Works with a plain results sheet.'
              : 'Needs a Roster tab with a Rank column. A challenger who wins takes the defender’s spot and everyone in between moves down one.'}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="range">Challenge range (spots)</label>
            <input
              id="range"
              type="number"
              min={1}
              max={20}
              value={config.challengeRange}
              onChange={(e) => onConfigChange({ challengeRange: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label htmlFor="cool">Cooling-off (days)</label>
            <input
              id="cool"
              type="number"
              min={0}
              max={90}
              value={config.coolingOffDays}
              onChange={(e) => onConfigChange({ coolingOffDays: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          <div className="field">
            <label htmlFor="min">Matches for an established rating</label>
            <input
              id="min"
              type="number"
              min={0}
              max={20}
              value={config.minMatchesForRating}
              onChange={(e) => onConfigChange({ minMatchesForRating: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          <div className="field">
            <label htmlFor="window">Movement window (days)</label>
            <input
              id="window"
              type="number"
              min={1}
              max={365}
              value={config.movementWindowDays}
              onChange={(e) => onConfigChange({ movementWindowDays: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label htmlFor="base">Squad average rating</label>
            <input
              id="base"
              type="number"
              min={1}
              max={7}
              step={0.5}
              value={config.baseRating}
              onChange={(e) => onConfigChange({ baseRating: Number(e.target.value) || 3.5 })}
            />
            <div className="hint">
              Only gaps between players are measurable from your results, so the squad average is
              pinned here. Set it to your team’s true NTRP level to make the numbers read realistically.
            </div>
          </div>
          <div className="field">
            <label htmlFor="refresh">Auto-refresh (seconds)</label>
            <input
              id="refresh"
              type="number"
              min={10}
              max={3600}
              value={refreshSeconds}
              onChange={(e) => onRefreshSecondsChange(Math.max(10, Number(e.target.value) || 30))}
            />
          </div>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={config.countPendingMatches}
            onChange={(e) => onConfigChange({ countPendingMatches: e.target.checked })}
          />
          <span>
            Count results marked <span className="mono">Pending</span> in the ladder
            <br />
            <span className="muted small">
              Turn this off to require your verification before a result moves anyone.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={config.strictScoreValidation}
            onChange={(e) => onConfigChange({ strictScoreValidation: e.target.checked })}
          />
          <span>
            Reject scores that are not legal completed sets
            <br />
            <span className="muted small">
              Strict mode excludes rows like <span className="mono">6-5</span> instead of counting
              them with a warning. Leave it off if your team plays a non-standard format.
            </span>
          </span>
        </label>
      </section>

      {/* --------------------------------------------------- column mapping */}
      <section className="card panel">
        <h3>Column mapping</h3>
        <p className="panel-note">
          Detected automatically from your headers. Change anything that was read wrong.
        </p>
        <div className="field-row">
          {FIELD_LABELS.map(({ field, label, hint }) => (
            <div className="field" key={field}>
              <label htmlFor={'map-' + field}>{label}</label>
              <select
                id={'map-' + field}
                value={mapping[field]}
                onChange={(e) => onMappingChange(field, Number(e.target.value))}
              >
                <option value={-1}>— not in my sheet —</option>
                {table.headers.map((header, i) => (
                  <option key={i} value={i}>
                    {header || 'Column ' + (i + 1)}
                  </option>
                ))}
              </select>
              <div className="hint">{hint}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
