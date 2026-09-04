/**
 * First-run setup: the coach pastes a Google Sheets link and the ladder appears.
 *
 * This is the only step the coach must complete, so it states the sharing requirement
 * up front rather than letting them discover it through a failed load.
 */

import { useState } from 'react';
import { SheetError } from '../lib/sheets';
import { sheetIdFromUrl } from '../hooks/useLiveSheet';

interface Props {
  onSubmit: (sheetId: string, gid: string | null) => void;
  onTryDemo: () => void;
  initialValue?: string;
  recalled?: { sheetId: string; gid: string | null } | null;
  onResume?: () => void;
}

export function Setup({ onSubmit, onTryDemo, initialValue = '', recalled, onResume }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { sheetId, gid } = sheetIdFromUrl(value);
      setError(null);
      onSubmit(sheetId, gid);
    } catch (err) {
      setError(err instanceof SheetError ? err.message : 'That link could not be read.');
    }
  };

  return (
    <div className="setup">
      <div className="card setup-card">
        <h2>Connect your scores sheet</h2>
        <p className="lead">
          Paste the link to the Google Sheet where you record match results. The dashboard reads
          it directly and rebuilds the ladder every time you save a new score.
        </p>

        <ol className="steps">
          <li>
            In Google Sheets, open <strong>Share → General access</strong> and set it to{' '}
            <strong>Anyone with the link → Viewer</strong>.
          </li>
          <li>
            Copy the address from your browser and paste it below.
          </li>
          <li>
            Send the team the link this app gives you afterwards — they will see the same ladder,
            live.
          </li>
        </ol>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="sheet-url">Google Sheets link</label>
            <input
              id="sheet-url"
              type="url"
              inputMode="url"
              placeholder="https://docs.google.com/spreadsheets/d/…/edit"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={error ? 'sheet-error' : 'sheet-hint'}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <div id="sheet-error" className="notice notice-error" style={{ marginTop: 8, marginBottom: 0 }}>
                {error}
              </div>
            ) : (
              <div id="sheet-hint" className="hint">
                Your sheet needs two name columns and either two score columns or one score column
                — for example <span className="mono">Person 1, Person 2, Person 1 Score, Person 2 Score</span>.
              </div>
            )}
          </div>

          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
              Build the ladder
            </button>
            <button type="button" className="btn" onClick={onTryDemo}>
              See a demo first
            </button>
            {recalled && onResume && (
              <button type="button" className="btn" onClick={onResume}>
                Reopen last sheet
              </button>
            )}
          </div>
        </form>

        <div className="notice notice-info" style={{ marginTop: 20, marginBottom: 0 }}>
          <strong>Nothing is uploaded anywhere</strong>
          The dashboard runs entirely in the browser and reads your sheet directly from Google.
          There is no server and no copy of your roster held by this app.
        </div>
      </div>
    </div>
  );
}
