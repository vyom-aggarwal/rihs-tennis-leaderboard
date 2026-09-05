/**
 * Reviewer-only harness for the draw-sheet leaderboard design pass.
 *
 * The bar at the top is NOT part of the shipped UI - it exists only so the states listed
 * in the design brief (loading, stale sync, a parse error, no sheet) can all be reviewed
 * on one page without wiring anything to real data yet.
 */

import { useMemo, useState } from 'react';
import { DrawSheetLeaderboard } from './DrawSheetLeaderboard';
import { BOYS_STANDINGS, GIRLS_STANDINGS, SAMPLE_DATA_ISSUE, matchLogFor } from './sample-data';

type DemoState = 'ready' | 'loading' | 'stale' | 'error' | 'empty';

const DEMO_STATES: Array<{ id: DemoState; label: string }> = [
  { id: 'ready', label: 'Ready' },
  { id: 'loading', label: 'Loading' },
  { id: 'stale', label: 'Stale sync' },
  { id: 'error', label: 'Data error' },
  { id: 'empty', label: 'No sheet' },
];

export function PreviewHarness() {
  const [demoState, setDemoState] = useState<DemoState>('ready');
  const [activeDivisionId, setActiveDivisionId] = useState('boys');

  const now = useMemo(() => new Date(), []);
  const divisions = useMemo(
    () => [
      { id: 'boys', label: 'Boys', standings: BOYS_STANDINGS },
      { id: 'girls', label: 'Girls', standings: GIRLS_STANDINGS },
    ],
    [],
  );

  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  return (
    <>
      <div className="harness-bar">
        <span className="harness-label">Preview only — not part of the shipped UI</span>
        <div className="harness-buttons">
          {DEMO_STATES.map((s) => (
            <button
              key={s.id}
              className={'harness-btn' + (demoState === s.id ? ' is-active' : '')}
              onClick={() => setDemoState(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <DrawSheetLeaderboard
        teamName="River Islands High School"
        subtitle="Tennis Ladder"
        divisions={divisions}
        activeDivisionId={activeDivisionId}
        onSelectDivision={setActiveDivisionId}
        status={demoState === 'loading' ? 'loading' : demoState === 'empty' ? 'empty' : 'ready'}
        lastSynced={
          demoState === 'stale' ? minutesAgo(47) : demoState === 'error' ? minutesAgo(5) : minutesAgo(2)
        }
        now={now}
        staleAfterMinutes={15}
        issues={demoState === 'error' ? [SAMPLE_DATA_ISSUE] : []}
        matchLog={matchLogFor}
        onConnectSheet={() => window.alert('This would open the "connect a sheet" flow.')}
      />
    </>
  );
}
