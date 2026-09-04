/**
 * The end-to-end pipeline: CSV text in, dashboard out.
 *
 *   CSV -> table -> column mapping -> matches -> per-team ladders -> leaders
 *
 * Kept free of React so the whole ranking path is testable as plain functions and so the
 * exact same code produces the coach's view and every teammate's view.
 */

import { parseCsv, toTable, type CsvTable } from './csv';
import { computeLeaders, type Leaders } from './leaders';
import {
  buildLadder,
  listTeams,
  matchesForTeam,
  resolveTeams,
} from './ladder';
import {
  detectMatchMapping,
  detectRosterMapping,
  mapMatches,
  mapRoster,
  validateMapping,
  type MatchMapping,
} from './schema';
import { pendingChallengeKeys, type OpenChallenge } from './challenge';
import type {
  DataIssue,
  LadderConfig,
  Match,
  RosterEntry,
  StandingRow,
  TeamId,
} from './types';

export interface TeamBoard {
  team: TeamId | null;
  label: string;
  standings: StandingRow[];
  matches: Match[];
  leaders: Leaders;
}

export interface Dashboard {
  boards: TeamBoard[];
  /** Every match that survived import, across all teams. */
  matches: Match[];
  roster: Map<string, RosterEntry>;
  displayNames: Map<string, string>;
  issues: DataIssue[];
  mapping: MatchMapping;
  table: CsvTable;
  config: LadderConfig;
  /** True when no Team column or roster team data was found - a single combined ladder. */
  singleLadder: boolean;
}

export interface BuildDashboardInput {
  matchesCsv: string;
  rosterCsv?: string | null;
  config: LadderConfig;
  /** Overrides auto-detection when the coach has remapped columns by hand. */
  mappingOverride?: Partial<MatchMapping> | null;
  openChallenges?: OpenChallenge[];
  now?: Date;
}

export function buildDashboard(input: BuildDashboardInput): Dashboard {
  const issues: DataIssue[] = [];
  const table = toTable(parseCsv(input.matchesCsv));

  const detected = detectMatchMapping(table);
  const mapping: MatchMapping = { ...detected, ...(input.mappingOverride ?? {}) };

  const missing = validateMapping(mapping);
  if (missing.length > 0) {
    issues.push({
      severity: 'error',
      code: 'mapping-incomplete',
      message:
        'Could not work out which columns hold ' +
        missing.join(' and ') +
        '. Set them in Column Mapping.',
      context: table.headers.join(' | '),
    });
    return {
      boards: [],
      matches: [],
      roster: new Map(),
      displayNames: new Map(),
      issues,
      mapping,
      table,
      config: input.config,
      singleLadder: true,
    };
  }

  // --- Optional Roster tab -------------------------------------------------
  const roster = new Map<string, RosterEntry>();
  if (input.rosterCsv && input.rosterCsv.trim()) {
    const rosterTable = toTable(parseCsv(input.rosterCsv));
    const rosterMapping = detectRosterMapping(rosterTable);
    const mapped = mapRoster(rosterTable, rosterMapping);
    for (const entry of mapped.entries) roster.set(entry.key, entry);
    issues.push(...mapped.issues);
  }

  // --- Matches -------------------------------------------------------------
  const mapped = mapMatches(table, mapping, {
    strictScores: input.config.strictScoreValidation,
  });
  issues.push(...mapped.issues);

  // Roster display names take priority - the roster is where the coach spells names
  // properly, while match rows are typed quickly courtside.
  const displayNames = new Map(mapped.displayNames);
  for (const [key, entry] of roster) displayNames.set(key, entry.displayName);

  // A player who appears in results but not on the roster is worth flagging: it is
  // almost always a misspelling that would otherwise split one player into two.
  if (roster.size > 0) {
    const unknown = [...new Set(mapped.matches.flatMap((m) => [m.playerA, m.playerB]))]
      .filter((key) => !roster.has(key))
      .map((key) => mapped.displayNames.get(key) ?? key);
    if (unknown.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'unrostered-player',
        message:
          'These players appear in match results but not on the Roster tab: ' +
          unknown.join(', ') +
          '. Check for a spelling difference, or add them to the roster.',
      });
    }
  }

  if (mapped.matches.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-matches',
      message: 'No usable match results were found in this sheet.',
    });
  }

  // --- Split into team ladders (PRD 6.1) -----------------------------------
  const teamsByPlayer = resolveTeams(mapped.matches, roster);
  const teams = listTeams(teamsByPlayer);
  const pending = pendingChallengeKeys(input.openChallenges ?? []);
  const boards: TeamBoard[] = [];

  const buildBoard = (team: TeamId | null, teamMatches: Match[], label: string): TeamBoard => {
    const teamRoster =
      team === null
        ? roster
        : new Map([...roster].filter(([, e]) => e.team === team || e.team === null));

    const ladder = buildLadder({
      matches: teamMatches,
      roster: teamRoster,
      displayNames,
      config: input.config,
      pendingChallengeKeys: pending,
      now: input.now,
    });

    // Prefix team ladder issues so a warning is attributable when two boards are shown.
    for (const issue of ladder.issues) {
      issues.push(team ? { ...issue, message: label + ': ' + issue.message } : issue);
    }

    return {
      team,
      label,
      standings: ladder.standings,
      matches: ladder.matches,
      leaders: computeLeaders(ladder.standings, input.config.movementWindowDays),
    };
  };

  if (teams.length === 0) {
    // No team information anywhere - one combined ladder. This is the sample sheet's
    // shape, and it must work without the coach changing anything.
    boards.push(buildBoard(null, mapped.matches, 'Team Ladder'));
  } else {
    for (const team of teams) {
      boards.push(buildBoard(team, matchesForTeam(mapped.matches, team, teamsByPlayer), team + ' Ladder'));
    }

    // Anyone with no team assignment would otherwise vanish from every board.
    const assigned = new Set<string>();
    for (const board of boards) for (const row of board.standings) assigned.add(row.key);
    const orphans = [...new Set(mapped.matches.flatMap((m) => [m.playerA, m.playerB]))].filter(
      (key) => !assigned.has(key),
    );
    if (orphans.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'unassigned-team',
        message:
          'These players have no team assigned, so they are not shown on either ladder: ' +
          orphans.map((k) => displayNames.get(k) ?? k).join(', ') +
          '. Add a Team column, or list them on the Roster tab.',
      });
    }
  }

  return {
    boards,
    matches: mapped.matches,
    roster,
    displayNames,
    issues,
    mapping,
    table,
    config: input.config,
    singleLadder: teams.length === 0,
  };
}

/** Split issues for display: errors first, then warnings, each in sheet-row order. */
export function sortIssues(issues: DataIssue[]): DataIssue[] {
  return [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return (a.sheetRow ?? Infinity) - (b.sheetRow ?? Infinity);
  });
}
