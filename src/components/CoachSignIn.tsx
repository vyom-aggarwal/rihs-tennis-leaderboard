/**
 * The coach password prompt. No accounts: one password, set by the coach in Vercel,
 * unlocks connecting the sheet, changing settings and publishing for the team.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  busy: boolean;
  error: string | null;
  /** Prefilled from the last sign-in on this device. */
  initialName: string;
  onSubmit: (password: string, name: string) => void;
  onClose: () => void;
}

export function CoachSignIn({ busy, error, initialName, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A returning coach only needs the password; a new one starts at the name.
    (initialName ? inputRef : nameRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          Enter your name and the coach password to refresh the ladder and publish updates. The
          team sees your name next to the changes you make.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password && name.trim() && !busy) onSubmit(password, name.trim());
          }}
        >
          <label htmlFor="coach-name">Your name</label>
          <input
            ref={nameRef}
            id="coach-name"
            type="text"
            autoComplete="name"
            maxLength={40}
            placeholder="e.g. Lokesh"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
            <button type="submit" className="ds-button is-primary" disabled={busy || !password || !name.trim()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
