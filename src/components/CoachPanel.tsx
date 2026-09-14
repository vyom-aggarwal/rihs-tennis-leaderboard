/**
 * Coach console: publishing, data health, open challenges, the verification queue, sheet
 * tabs, ladder rules and column mapping.
 *
 * SECURITY NOTE, stated plainly because it matters. Two things protect the team's data:
 *   - Google's own sharing settings on the sheet. Only people the coach grants edit
 *     access can change a score; nothing here can write to the sheet.
 *   - On a deployment with publishing, the coach password. The server refuses to change
 *     the published ladder without it. This panel only previews changes locally until
 *     the coach publishes.
 * Without the publishing API (link-based sharing), coach mode is only a URL flag that
 * shows this panel; it changes what that one browser sees and nothing else.
 */

import { useState } from 'react';
import type { OpenChallenge } from '../lib/challenge';
import type { MatchField, MatchMapping } from '../lib/schema';
import { formatScore } from '../lib/score';
import { issueLocation, sortIssues } from '../lib/dashboard';
import type { PublishedLadder } from '../lib/publish';
import { parseSheetUrl, SheetError } from '../lib/sheets';
import type { CsvTable } from '../lib/csv';
import type { DataIssue, LadderConfig, Match } from '../lib/types';
import { formatDate, relativeTime } from './common';

const FIELD_LABELS: Array<{ field: MatchField; label: string; hint: string }> = [
  { field: 'playerA', label: 'First player', hint: 'Required. On a ladder this is the challenger.' },
  { field: 'playerB', label: 'Second player', hint: 'Required. On a ladder this is the defender.' },
  { field: 'scoreA', label: 'First player score', hint: 'Games won, if you keep two score columns.' },
  { field: 'scoreB', label: 'Second player score', hint: 'Games won, if you keep two score columns.' },
  { field: 'scoreSummary', label: 'Score summary', hint: 'One column like "6-4, 7-5". Used instead of the two above.' },
  { field: 'winner', label: 'Winner', hint: 'Optional. Overrides the score if they disagree.' },
  { field: 'date', label: 'Date', hint: 'Optional, but needed for movement arrows and Top Climber.' },
  { field: 'team', label: 'Team', hint: 'Optional. Values like Boys / Girls split the ladders.' },
  { field: 'format', label: 'Singles / doubles', hint: 'Optional. Rows marked Doubles, or written like "Jake / Marcus", go to the doubles ladder.' },
  { field: 'approval', label: 'Approval status', hint: 'Optional. Pending / Verified / Rejected, or a checkbox (unticked = pending).' },
  { field: 'notes', label: 'Notes', hint: 'Optional. Shown to you only.' },
];

/** Keep a typed number inside the same bounds the shared link accepts. */
function bounded(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

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

/** Paste a link to another tab of the same spreadsheet; its gid is what gets stored. */
function TabLinkField({
  id,
  name,
  sheetId,
  gid,
  taken,
  onChange,
}: {
  id: string;
  name: string;
  sheetId: string;
  gid: string | null;
  /** Tabs already in use, which this one must not duplicate. */
  taken: Array<{ gid: string; name: string }>;
  onChange: (gid: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const apply = (next: string) => {
    const clash = taken.find((t) => t.gid === next);
    if (clash) {
      setProblem('That is your ' + clash.name + '. Open the ' + name + ' and copy its address instead.');
      return;
    }
    onChange(next);
    setValue('');
    setProblem(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (/^\d+$/.test(text)) return apply(text);
    try {
      const ref = parseSheetUrl(text);
      if ((ref.pubId ? 'e/' + ref.pubId : ref.docId) !== sheetId) {
        setProblem('That link is to a different spreadsheet. The ' + name + ' must be in the same spreadsheet as your match results.');
        return;
      }
      if (!ref.gid) {
        setProblem('That link does not say which tab to use. Click the ' + name + ' in Google Sheets first, then copy the address — it ends in "gid=" and a number.');
        return;
      }
      apply(ref.gid);
    } catch (err) {
      setProblem(err instanceof SheetError ? err.message : 'That link could not be read.');
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor={id}>{gid ? 'Replace the ' + name + ' link' : name + ' link'}</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            id={id}
            type="text"
            inputMode="url"
            placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setProblem(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? id + '-problem' : undefined}
          />
          <button type="submit" className="btn btn-sm" disabled={!value.trim()}>
            Use tab
          </button>
        </div>
        {problem && (
          <div id={id + '-problem'} className="notice notice-error" style={{ marginTop: 8, marginBottom: 0 }}>
            {problem}
          </div>
        )}
      </div>
    </form>
  );
}

function TabStatus({
  name,
  gid,
  error,
  onDisconnect,
}: {
  name: string;
  gid: string | null;
  error: string | null;
  onDisconnect: () => void;
}) {
  if (!gid) return null;
  return (
    <div className={'notice ' + (error ? 'notice-error' : 'notice-info')}>
      <strong>{error ? 'The ' + name + ' could not be read' : name + ' connected'}</strong>
      {error ?? 'Tab id ' + gid + '. It updates with every refresh.'}
      <div style={{ marginTop: 8 }}>
        <button className="btn btn-sm" onClick={onDisconnect}>
          Disconnect {name}
        </button>
      </div>
    </div>
  );
}

interface Props {
  /** 'server': published ladder behind the coach password. 'link': settings travel in the URL. */
  mode: 'server' | 'link';
  table: CsvTable;
  mapping: MatchMapping;
  onMappingChange: (field: MatchField, index: number) => void;
  config: LadderConfig;
  onConfigChange: (patch: Partial<LadderConfig>) => void;
  issues: DataIssue[];
  matches: Match[];
  openChallenges: OpenChallenge[];
  displayNames: Map<string, string>;
  /** The address the team uses: the site itself ('server') or the settings link ('link'). */
  teamUrl: string;
  /** Link mode only: the link that reopens this console. */
  coachLinkUrl: string | null;
  /** Null in the demo, which has no sheet to open. */
  sheetUrl: string | null;
  sheetId: string;
  matchesGid: string | null;
  isDemo: boolean;
  rosterGid: string | null;
  rosterError: string | null;
  onRosterGidChange: (gid: string | null) => void;
  doublesGid: string | null;
  doublesError: string | null;
  onDoublesGidChange: (gid: string | null) => void;
  refreshSeconds: number;
  onRefreshSecondsChange: (seconds: number) => void;
  /** Server mode: what the team currently sees. */
  published: PublishedLadder | null;
  history: PublishedLadder[] | null;
  historyLoading: boolean;
  historyError: string | null;
  onLoadHistory: () => void;
  onRestore: (entry: PublishedLadder) => void;
  onSignOut: (() => void) | null;
  now: Date;
}

export function CoachPanel({
  mode,
  table,
  mapping,
  onMappingChange,
  config,
  onConfigChange,
  issues,
  matches,
  openChallenges,
  displayNames,
  teamUrl,
  coachLinkUrl,
  sheetUrl,
  sheetId,
  matchesGid,
  isDemo,
  rosterGid,
  rosterError,
  onRosterGidChange,
  doublesGid,
  doublesError,
  onDoublesGidChange,
  refreshSeconds,
  onRefreshSecondsChange,
  published,
  history,
  historyLoading,
  historyError,
  onLoadHistory,
  onRestore,
  onSignOut,
  now,
}: Props) {
  const sorted = sortIssues(issues);
  const errors = sorted.filter((i) => i.severity === 'error');
  const warnings = sorted.filter((i) => i.severity === 'warning');
  const skippedRows = errors.filter((i) => i.sheetRow !== undefined).length;
  const pending = matches.filter((m) => m.approval === 'Pending');
  const nameFor = (key: string) => displayNames.get(key) ?? key;
  const matchesTab = { gid: matchesGid ?? '0', name: 'match results tab' };

  return (
    <div className="stack">
      {/* ---------------------------------------------------- team page / sharing */}
      {mode === 'server' ? (
        <section className="card panel">
          <h3>Team page</h3>
          <p className="panel-note">
            Players, parents and administrators see the published ladder at this address — no
            sign-in and no special link. Changes you make below are a preview only you can see
            until you publish them.
          </p>
          <div className="field">
            <label htmlFor="team-link">Team page</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="team-link" readOnly value={teamUrl} onFocus={(e) => e.target.select()} />
              <CopyButton value={teamUrl} label="Copy" />
            </div>
            <div className="hint">
              {published
                ? 'Last published ' +
                  relativeTime(new Date(published.publishedAt), now) +
                  (published.note ? ' — “' + published.note + '”' : '') +
                  '.'
                : 'Nothing has been published yet.'}
            </div>
          </div>
          <div className="row">
            {sheetUrl && (
              <a className="btn btn-sm" href={sheetUrl} target="_blank" rel="noopener noreferrer">
                Open the sheet in Google Sheets
              </a>
            )}
            {onSignOut && (
              <button className="btn btn-sm" onClick={onSignOut}>
                Sign out of coach mode
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="card panel">
          <h3>Share with the team</h3>
          <p className="panel-note">
            Send players, parents and administrators this link. It is read-only and always shows the
            current ladder, under the rules and column settings you choose below.
          </p>
          <div className="field">
            <label htmlFor="team-link">Team link</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="team-link" readOnly value={teamUrl} onFocus={(e) => e.target.select()} />
              <CopyButton value={teamUrl} label="Copy" />
            </div>
            <div className="hint">
              Copy it again after changing any setting here — the link carries your settings.
            </div>
          </div>
          {coachLinkUrl && (
            <div className="field">
              <label htmlFor="coach-link">Your coach link</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="coach-link" readOnly value={coachLinkUrl} onFocus={(e) => e.target.select()} />
                <CopyButton value={coachLinkUrl} label="Copy" />
              </div>
              <div className="hint">
                Bookmark this one. It reopens this panel. On this kind of hosting there is no coach
                password, so keep it to yourself — it controls what you see, not who can edit the sheet.
              </div>
            </div>
          )}
          {sheetUrl && (
            <a className="btn btn-sm" href={sheetUrl} target="_blank" rel="noopener noreferrer">
              Open the sheet in Google Sheets
            </a>
          )}
        </section>
      )}

      {/* ------------------------------------------------------ data health */}
      <section className="card panel">
        <h3>Data health</h3>
        <p className="panel-note">
          Every row that could not be read, or that looks unusual, is listed here with its row
          number in your sheet. Nothing is silently dropped.
        </p>

        {errors.length === 0 && warnings.length === 0 ? (
          <div className="notice notice-info" style={{ marginBottom: 0 }}>
            <strong>All {matches.length} results imported cleanly</strong>
            No formatting problems found.
          </div>
        ) : (
          <>
            {skippedRows > 0 && (
              <div className="notice notice-error">
                <strong>
                  {skippedRows} row{skippedRows === 1 ? '' : 's'} could not be counted
                </strong>
                These are excluded from the ladder until they are fixed in the sheet.
              </div>
            )}
            <ul className="issue-list">
              {sorted.slice(0, 40).map((issue, i) => (
                <li key={i} className="issue">
                  <span className="issue-row">
                    {issueLocation(issue) ?? (issue.severity === 'error' ? 'Error' : 'Note')}
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

      {/* -------------------------------------------------- open challenges */}
      <section className="card panel">
        <h3>Open challenges</h3>
        <p className="panel-note">
          To record a challenge before it is played, add a row with the challenger in the first
          player column, the defender in the second, and the score left blank. Both sides show{' '}
          <span className="mono">Challenge Pending</span> and cannot take on another challenge until
          you type the score into that row. Set its Status to{' '}
          <span className="mono">Cancelled</span> to withdraw it.
        </p>
        {openChallenges.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No open challenges right now.
          </p>
        ) : (
          <ul className="match-log">
            {openChallenges.map((c, i) => (
              <li key={i}>
                <span className="issue-row">{c.sheetRow ? 'Row ' + c.sheetRow : 'Challenge'}</span>
                <span style={{ flex: 1 }}>
                  {nameFor(c.challengerKey)} <span className="muted">challenged</span>{' '}
                  {nameFor(c.defenderKey)}
                  {c.createdAt && (
                    <>
                      <br />
                      <span className="small muted">{formatDate(c.createdAt)}</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
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
                <span className="issue-row">{m.id.startsWith('d') ? 'Doubles row ' : 'Row '}{m.sheetRow}</span>
                <span style={{ flex: 1 }}>
                  {nameFor(m.winner === 'a' ? m.playerA : m.playerB)}{' '}
                  <span className="muted">def.</span>{' '}
                  {nameFor(m.winner === 'a' ? m.playerB : m.playerA)}
                  <br />
                  <span className="small muted">{formatDate(m.date)}</span>
                </span>
                <span className="match-score">{formatScore(m.score)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------- sheet tabs */}
      <section className="card panel">
        <h3>More tabs</h3>
        <p className="panel-note">
          Optional tabs in the same spreadsheet. The <strong>Roster tab</strong> adds grades,
          divisions, photos, injury holds and challenge-ladder seeds. The{' '}
          <strong>Doubles tab</strong> holds doubles results, written like{' '}
          <span className="mono">Jake Whitmore / Marcus Webb</span>. Click the tab in Google Sheets,
          copy the address bar, and paste it here.
        </p>
        {isDemo ? (
          <p className="small muted" style={{ margin: 0 }}>
            The demo uses a built-in roster and doubles tab. Connect your own sheet to link yours.
          </p>
        ) : (
          <>
            <TabStatus name="Roster tab" gid={rosterGid} error={rosterError} onDisconnect={() => onRosterGidChange(null)} />
            <TabLinkField
              id="roster-link"
              name="Roster tab"
              sheetId={sheetId}
              gid={rosterGid}
              taken={[matchesTab, ...(doublesGid ? [{ gid: doublesGid, name: 'Doubles tab' }] : [])]}
              onChange={onRosterGidChange}
            />
            <TabStatus name="Doubles tab" gid={doublesGid} error={doublesError} onDisconnect={() => onDoublesGidChange(null)} />
            <TabLinkField
              id="doubles-link"
              name="Doubles tab"
              sheetId={sheetId}
              gid={doublesGid}
              taken={[matchesTab, ...(rosterGid ? [{ gid: rosterGid, name: 'Roster tab' }] : [])]}
              onChange={onDoublesGidChange}
            />
          </>
        )}
      </section>

      {/* ------------------------------------------------------ ladder rules */}
      <section className="card panel">
        <h3>Ladder rules</h3>
        <p className="panel-note">
          {mode === 'server'
            ? 'Publish after changing these, and the whole team sees the ladder under the same rules.'
            : 'These settings travel in the link you share, so the team sees the ladder under the same rules you set here.'}
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
              inputMode="numeric"
              min={1}
              max={50}
              value={config.challengeRange}
              onChange={(e) =>
                onConfigChange({ challengeRange: Math.round(bounded(e.target.value, 1, 50, 1)) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="cool">Cooling-off (days)</label>
            <input
              id="cool"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={config.coolingOffDays}
              onChange={(e) =>
                onConfigChange({ coolingOffDays: Math.round(bounded(e.target.value, 0, 365, 0)) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="min">Matches for an established rating</label>
            <input
              id="min"
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={config.minMatchesForRating}
              onChange={(e) =>
                onConfigChange({ minMatchesForRating: Math.round(bounded(e.target.value, 0, 50, 0)) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="window">Movement window (days)</label>
            <input
              id="window"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={config.movementWindowDays}
              onChange={(e) =>
                onConfigChange({ movementWindowDays: Math.round(bounded(e.target.value, 1, 365, 1)) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="base">Squad average rating</label>
            <input
              id="base"
              type="number"
              inputMode="decimal"
              min={1}
              max={7}
              step={0.5}
              value={config.baseRating}
              onChange={(e) => onConfigChange({ baseRating: bounded(e.target.value, 1, 7, 3.5) })}
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
              inputMode="numeric"
              min={10}
              max={3600}
              value={refreshSeconds}
              onChange={(e) =>
                onRefreshSecondsChange(Math.round(bounded(e.target.value, 10, 3600, 30)))
              }
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
          Detected automatically from the headers on your match results tab. Change anything that
          was read wrong — {mode === 'server' ? 'publish afterwards' : 'your choices are saved into the team link'}, so
          every teammate reads the sheet the same way.
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

      {/* -------------------------------------------------- publish history */}
      {mode === 'server' && (
        <section className="card panel">
          <h3>Publish history</h3>
          <p className="panel-note">
            The last 20 versions of the ladder settings you published, newest first. Restoring one
            loads it as a preview; publish it to make it the team&rsquo;s ladder again. Score edits
            are not listed here — Google Sheets keeps those under File → Version history.
          </p>
          {history === null ? (
            <button className="btn btn-sm" onClick={onLoadHistory} disabled={historyLoading}>
              {historyLoading ? 'Loading…' : 'Show publish history'}
            </button>
          ) : history.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Nothing has been published yet.
            </p>
          ) : (
            <ul className="match-log">
              {history.map((entry, i) => (
                <li key={entry.publishedAt + ':' + i}>
                  <span style={{ flex: 1 }}>
                    <strong>
                      {new Date(entry.publishedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </strong>
                    {i === 0 && <span className="muted"> · live now</span>}
                    <br />
                    <span className="small muted">{entry.note || 'No note'}</span>
                  </span>
                  {i > 0 && (
                    <button className="btn btn-sm" onClick={() => onRestore(entry)}>
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {historyError && (
            <div className="notice notice-error" style={{ marginTop: 10, marginBottom: 0 }}>
              {historyError}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
