/**
 * The end-to-end pipeline: CSV text in, dashboard out.
 *
 *   CSV -> table -> column mapping -> matches -> per-team, per-format ladders -> leaders
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
  type MatchField,
  type MatchMapping,
} from './schema';
import { pendingChallengeKeys, type OpenChallenge } from './challenge';
import type {
  ActiveStatus,
  DataIssue,
  LadderConfig,
  Match,
  MatchFormat,
  RosterEntry,
  StandingRow,
  TeamId,
} from './types';

/** Label used on issues from the separate Doubles tab. */
export const DOUBLES_TAB = 'Doubles tab';

export interface TeamBoard {
  /** Stable identity, e.g. "Boys:singles" or "all:doubles". */
  id: string;
  team: TeamId | null;
  format: MatchFormat;
  label: string;
  standings: StandingRow[];
  matches: Match[];
  leaders: Leaders;
}

export interface Dashboard {
  boards: TeamBoard[];
  /** Every match that survived import, across all teams and both formats. */
  matches: Match[];
  /** Challenges issued but not yet played, read from score-less rows plus any supplied. */
  openChallenges: OpenChallenge[];
  roster: Map<string, RosterEntry>;
  /** Display name for every player key and every doubles pair key. */
  displayNames: Map<string, string>;
  /** Doubles: each pair key's two partner keys. */
  pairPartners: Map<string, [string, string]>;
  issues: DataIssue[];
  mapping: MatchMapping;
  table: CsvTable;
  config: LadderConfig;
  /** True when no Team column or roster team data was found - one combined ladder per format. */
  singleLadder: boolean;
  /** True when any match carries a date, which movement arrows and Top Climber need. */
  hasDates: boolean;
}

export interface BuildDashboardInput {
  matchesCsv: string;
  rosterCsv?: string | null;
  /** An optional tab holding only doubles results. */
  doublesCsv?: string | null;
  config: LadderConfig;
  /** Overrides auto-detection when the coach has remapped columns by hand. */
  mappingOverride?: Partial<MatchMapping> | null;
  openChallenges?: OpenChallenge[];
  now?: Date;
}

export function boardId(team: TeamId | null, format: MatchFormat): string {
  return (team ?? 'all') + ':' + format;
}

export function buildDashboard(input: BuildDashboardInput): Dashboard {
  const issues: DataIssue[] = [];
  const table = toTable(parseCsv(input.matchesCsv));

  // A saved override can outlive a column the coach later deleted from the sheet.
  // Pointing past the last column would read every cell as blank, so treat it as unset
  // and let validation say which field needs choosing again.
  const override: Partial<MatchMapping> = {};
  for (const [field, index] of Object.entries(input.mappingOverride ?? {}) as Array<[MatchField, number]>) {
    override[field] = index < table.headers.length ? index : -1;
  }

  const detected = detectMatchMapping(table);
  const mapping: MatchMapping = { ...detected, ...override };

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
      openChallenges: [],
      roster: new Map(),
      displayNames: new Map(),
      pairPartners: new Map(),
      issues,
      mapping,
      table,
      config: input.config,
      singleLadder: true,
      hasDates: false,
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

  // --- Matches, from the main tab and an optional Doubles tab ---------------
  const options = { strictScores: input.config.strictScoreValidation, now: input.now };
  const main = mapMatches(table, mapping, options);
  issues.push(...main.issues);

  const matches = [...main.matches];
  const sheetChallenges = [...main.openChallenges];
  const spellings = new Map(main.displayNames);
  const pairPartners = new Map(main.pairPartners);

  if (input.doublesCsv && input.doublesCsv.trim()) {
    const doublesTable = toTable(parseCsv(input.doublesCsv));
    const doublesMapping = detectMatchMapping(doublesTable);
    const doublesMissing = validateMapping(doublesMapping);
    if (doublesMissing.length > 0) {
      // The singles ladder does not depend on this tab, so it is reported, not blocking.
      issues.push({
        severity: 'error',
        code: 'doubles-mapping-incomplete',
        tab: DOUBLES_TAB,
        message:
          'Could not work out which columns on the Doubles tab hold ' +
          doublesMissing.join(' and ') +
          '. Use headers like Pair 1, Pair 2 and Score.',
        context: doublesTable.headers.join(' | '),
      });
    } else {
      const doubles = mapMatches(doublesTable, doublesMapping, {
        ...options,
        format: 'doubles',
        idPrefix: 'd',
        tab: DOUBLES_TAB,
      });
      issues.push(...doubles.issues);
      matches.push(...doubles.matches);
      sheetChallenges.push(...doubles.openChallenges);
      for (const [key, name] of doubles.displayNames) if (!spellings.has(key)) spellings.set(key, name);
      for (const [key, partners] of doubles.pairPartners) pairPartners.set(key, partners);
    }
  }

  const openChallenges = [...sheetChallenges, ...(input.openChallenges ?? [])];

  // Roster display names take priority - the roster is where the coach spells names
  // properly, while match rows are typed quickly courtside. Pairs are named from their
  // partners, so they pick up the roster spellings too.
  const displayNames = new Map(spellings);
  for (const [key, entry] of roster) displayNames.set(key, entry.displayName);
  for (const [key, partners] of pairPartners) {
    displayNames.set(key, partners.map((k) => displayNames.get(k) ?? k).join(' / '));
  }

  const individuals = (key: string): string[] => pairPartners.get(key) ?? [key];

  // A player who appears in results but not on the roster is worth flagging: it is
  // almost always a misspelling that would otherwise split one player into two.
  if (roster.size > 0) {
    const named = [
      ...matches.flatMap((m) => [m.playerA, m.playerB]),
      ...sheetChallenges.flatMap((c) => [c.challengerKey, c.defenderKey]),
    ].flatMap(individuals);
    const unknown = [...new Set(named)]
      .filter((key) => !roster.has(key))
      .map((key) => spellings.get(key) ?? key);
    if (unknown.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'unrostered-player',
        message:
          'These players appear in the match sheet but not on the Roster tab: ' +
          unknown.join(', ') +
          '. Check for a spelling difference, or add them to the roster.',
      });
    }
  }

  if (matches.length === 0) {
    // A new season with a roster or challenges but no results yet is a normal state,
    // not a broken sheet.
    const expected = roster.size > 0 || openChallenges.length > 0;
    issues.push({
      severity: expected ? 'warning' : 'error',
      code: 'no-matches',
      message: expected
        ? 'No match results yet. The ladder will fill in as scores are entered.'
        : 'No usable match results were found in this sheet.',
    });
  }

  const singles = matches.filter((m) => m.format === 'singles');
  const doubles = matches.filter((m) => m.format === 'doubles');
  const pending = pendingChallengeKeys(openChallenges);
  const boards: TeamBoard[] = [];
  const multipleFormats = singles.length > 0 && doubles.length > 0;

  const buildBoard = (
    team: TeamId | null,
    format: MatchFormat,
    boardMatches: Match[],
    boardRoster: Map<string, RosterEntry>,
    label: string,
  ): TeamBoard => {
    const ladder = buildLadder({
      matches: boardMatches,
      roster: boardRoster,
      displayNames,
      config: input.config,
      pendingChallengeKeys: pending,
      now: input.now,
    });

    // Prefix ladder issues so a warning is attributable when several boards are shown.
    for (const issue of ladder.issues) {
      issues.push(team || multipleFormats ? { ...issue, message: label + ': ' + issue.message } : issue);
    }

    return {
      id: boardId(team, format),
      team,
      format,
      label,
      standings: ladder.standings,
      matches: ladder.matches,
      leaders: computeLeaders(ladder.standings, input.config.movementWindowDays),
    };
  };

  const reportOrphans = (keys: Iterable<string>, format: MatchFormat) => {
    const assigned = new Set<string>();
    for (const board of boards) {
      if (board.format === format) for (const row of board.standings) assigned.add(row.key);
    }
    const orphans = [...new Set(keys)].filter((key) => !assigned.has(key));
    if (orphans.length === 0) return;
    issues.push({
      severity: 'warning',
      code: 'unassigned-team',
      message:
        (format === 'doubles'
          ? 'These doubles pairs have no team assigned, so they are not shown on any doubles ladder: '
          : 'These players have no team assigned, so they are not shown on any ladder: ') +
        orphans.map((k) => displayNames.get(k) ?? k).join(', ') +
        '. Give them a Team on the Roster tab or in the match sheet.',
    });
  };

  // --- Singles ladders (PRD 6.1) --------------------------------------------
  // Team per player: the Roster tab first, then the singles rows they played. A player
  // who only plays doubles still belongs to a team, so labelled doubles rows fill gaps.
  const teamsByPlayer = resolveTeams(singles, roster);
  for (const m of doubles) {
    if (!m.team) continue;
    for (const key of [...(m.partnersA ?? []), ...(m.partnersB ?? [])]) {
      if (!teamsByPlayer.has(key)) teamsByPlayer.set(key, m.team);
    }
  }

  const singlesPeople = new Set([
    ...roster.keys(),
    ...singles.flatMap((m) => [m.playerA, m.playerB]),
  ]);
  const singlesTeams = listTeams(new Map([...teamsByPlayer].filter(([key]) => singlesPeople.has(key))));

  // A sheet of doubles results only should not open on an empty singles ladder.
  if (singles.length > 0 || roster.size > 0 || doubles.length === 0) {
    if (singlesTeams.length === 0) {
      // No team information anywhere - one combined ladder. This is the sample sheet's
      // shape, and it must work without the coach changing anything.
      boards.push(buildBoard(null, 'singles', singles, roster, 'Team Ladder'));
    } else {
      for (const team of singlesTeams) {
        // Rostered players join the ladder their team resolves to - from the roster's
        // Team column, or failing that from the matches they played.
        const teamRoster = new Map([...roster].filter(([key]) => teamsByPlayer.get(key) === team));
        boards.push(
          buildBoard(team, 'singles', matchesForTeam(singles, team, teamsByPlayer), teamRoster, team + ' Ladder'),
        );
      }
      reportOrphans(singlesPeople, 'singles');
    }
  }

  // --- Doubles ladders --------------------------------------------------------
  let doublesTeams: TeamId[] = [];
  if (doubles.length > 0) {
    // Each pair gets a roster-like entry built from its partners: the team they share
    // (or "Mixed"), the division they share, and an injury hold if either partner has one.
    const pairRoster = new Map<string, RosterEntry>();
    for (const key of new Set(doubles.flatMap((m) => [m.playerA, m.playerB]))) {
      const partners = pairPartners.get(key);
      if (!partners) continue;
      const [teamA, teamB] = partners.map((k) => teamsByPlayer.get(k) ?? null);
      const team = teamA && teamB ? (teamA === teamB ? teamA : 'Mixed') : (teamA ?? teamB ?? null);
      const entries = partners.map((k) => roster.get(k));
      const statuses: ActiveStatus[] = entries.map((e) => e?.activeStatus ?? 'Active');
      const divisionA = entries[0]?.division ?? 'Unassigned';
      const divisionB = entries[1]?.division ?? 'Unassigned';
      pairRoster.set(key, {
        key,
        displayName: displayNames.get(key) ?? key,
        team,
        grade: null,
        division: divisionA === divisionB ? divisionA : 'Unassigned',
        activeStatus: statuses.includes('Injured') ? 'Injured' : statuses.includes('Inactive') ? 'Inactive' : 'Active',
        seedRank: null,
        avatarUrl: null,
      });
    }

    const pairTeams = resolveTeams(doubles, pairRoster);
    doublesTeams = listTeams(pairTeams);
    if (doublesTeams.length === 0) {
      boards.push(buildBoard(null, 'doubles', doubles, pairRoster, 'Doubles Ladder'));
    } else {
      for (const team of doublesTeams) {
        const teamPairs = new Map([...pairRoster].filter(([key]) => pairTeams.get(key) === team));
        boards.push(buildBoard(team, 'doubles', matchesForTeam(doubles, team, pairTeams), teamPairs, team + ' Doubles'));
      }
      reportOrphans(pairRoster.keys(), 'doubles');
    }
  }

  return {
    boards,
    matches,
    openChallenges,
    roster,
    displayNames,
    pairPartners,
    issues,
    mapping,
    table,
    config: input.config,
    singleLadder: singlesTeams.length === 0 && doublesTeams.length === 0,
    hasDates: matches.some((m) => m.date !== null),
  };
}

/** Split issues for display: errors first, then warnings, each in sheet-row order. */
export function sortIssues(issues: DataIssue[]): DataIssue[] {
  return [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return (a.sheetRow ?? Infinity) - (b.sheetRow ?? Infinity);
  });
}

/** "Row 12" or "Doubles tab row 12", for showing where an issue is. */
export function issueLocation(issue: DataIssue): string | null {
  if (!issue.sheetRow) return issue.tab ?? null;
  return issue.tab ? issue.tab + ' row ' + issue.sheetRow : 'Row ' + issue.sheetRow;
}
