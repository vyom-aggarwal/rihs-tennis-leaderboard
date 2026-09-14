import { describe, expect, it } from 'vitest';
import {
  coachUrl,
  DEFAULT_APP_STATE,
  readAppState,
  readMapping,
  teamShareUrl,
  writeAppState,
  writeMapping,
  type AppState,
} from '../lib/config';

const ORIGIN = 'https://rihs-tennis.vercel.app';
const state = (patch: Partial<AppState>): AppState => ({ ...DEFAULT_APP_STATE, ...patch });

describe('column mapping in the link', () => {
  it('round-trips a hand-corrected mapping', () => {
    const mapping = { playerA: 2, playerB: 3, scoreSummary: 5, winner: -1 };
    expect(readMapping(writeMapping(mapping))).toEqual(mapping);
  });

  it('uses only characters a URL never percent-encodes', () => {
    const query = writeAppState(state({ sheetId: 'abc', mapping: { playerA: 0, scoreSummary: 4 } }));
    expect(query).toContain('map=playerA.0_scoreSummary.4');
  });

  it('ignores unknown fields and malformed pairs rather than guessing', () => {
    expect(readMapping('playerA.1_bogus.2_playerB.x_date.-5_team')).toEqual({ playerA: 1 });
    expect(readMapping(null)).toEqual({});
  });

  it('travels in the team link, so teammates read the sheet the way the coach set it up', () => {
    const s = state({ sheetId: 'abc', mapping: { playerA: 1 } });
    expect(readAppState(new URL(teamShareUrl(s, ORIGIN, '/')).search).mapping).toEqual({ playerA: 1 });
  });
});

describe('shared links', () => {
  it('carries the Roster and Doubles tabs', () => {
    const s = readAppState(writeAppState(state({ sheetId: 'abc', rosterGid: '12', doublesGid: '34' })));
    expect([s.rosterGid, s.doublesGid]).toEqual(['12', '34']);
  });

  it('keeps the open ladder tab in the address bar', () => {
    expect(readAppState(writeAppState(state({ sheetId: 'abc', ladder: 'Girls' }))).ladder).toBe('Girls');
  });

  it('leaves the ladder tab and coach flag out of the team link', () => {
    const s = state({ sheetId: 'abc', ladder: 'Girls', coach: true });
    const url = teamShareUrl(s, ORIGIN, '/');
    expect(url).not.toContain('ladder=');
    expect(url).not.toContain('coach=');
  });

  it('adds only the coach flag to the coach link', () => {
    const url = coachUrl(state({ sheetId: 'abc', ladder: 'Girls' }), ORIGIN, '/');
    expect(url).toBe(ORIGIN + '/?sheet=abc&coach=1');
  });

  it('clamps rule settings from a hand-edited link to sane bounds', () => {
    const s = readAppState('?sheet=abc&range=0&base=12&refresh=1');
    expect(s.config.challengeRange).toBe(1);
    expect(s.config.baseRating).toBe(7);
    expect(s.refreshSeconds).toBe(10);
  });
});
