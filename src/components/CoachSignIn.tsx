/**
 * The coach password prompt. No accounts: one password, set by the coach in Vercel,
 * unlocks connecting the sheet, changing settings and publishing for the team.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

export function CoachSignIn({ busy, error, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="ds-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="coach-signin-title">
        <h2 id="coach-signin-title">Coach sign-in</h2>
        <p>
          Enter the coach password to connect the scores sheet, change ladder settings and publish
          updates for the team.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password && !busy) onSubmit(password);
          }}
        >
          <label htmlFor="coach-password">Coach password</label>
          <input
            ref={inputRef}
            id="coach-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'coach-signin-error' : undefined}
          />
          {error && (
            <p id="coach-signin-error" className="ds-error-text" role="alert">
              {error}
            </p>
          )}
          <div className="ds-dialog-actions">
            <button type="button" className="ds-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ds-button is-primary" disabled={busy || !password}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
