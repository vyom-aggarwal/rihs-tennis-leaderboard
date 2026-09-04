/**
 * Challenge eligibility rules (PRD 6.3, AC-2.1.1, AC-2.1.2).
 *
 * A challenge is legal when all of the following hold:
 *   - The challenger sits BELOW the defender on the ladder.
 *   - The gap is between 1 and `challengeRange` spots (the PRD uses 3, so a #8 may
 *     challenge #7, #6 or #5 but not #4).
 *   - Neither player is on Injury Hold or Inactive (AC-3.1.2).
 *   - Neither player already has an open challenge (AC-2.1.2).
 *   - The pair is outside the cooling-off window since they last played, which is what
 *     stops one player repeatedly re-challenging the same opponent.
 *
 * The engine returns a reason for every *ineligible* opponent as well as the eligible
 * ones, because "why can't I challenge them?" is the question a player actually has, and
 * a silently shortened dropdown answers it badly.
 */

import type { LadderConfig, Match, StandingRow } from './types';

export interface ChallengeOption {
  key: string;
  displayName: string;
  rank: number;
  /** How many spots ahead of the challenger this player sits. */
  spotsAhead: number;
  eligible: boolean;
  /** Present only when `eligible` is false. */
  reason?: string;
}

export interface OpenChallenge {
  challengerKey: string;
  defenderKey: string;
  createdAt: Date | null;
}

export interface EligibilityInput {
  challengerKey: string;
  standings: StandingRow[];
  matches: Match[];
  config: LadderConfig;
  openChallenges?: OpenChallenge[];
  now?: Date;
}

/** Days since these two last played, or null if they never have. */
export function daysSinceLastMeeting(
  matches: Match[],
  a: string,
  b: string,
  now: Date,
): number | null {
  let latest: Date | null = null;
  for (const m of matches) {
    const isPair =
      (m.playerA === a && m.playerB === b) || (m.playerA === b && m.playerB === a);
    if (!isPair || !m.date) continue;
    if (!latest || m.date > latest) latest = m.date;
  }
  if (!latest) return null;
  return Math.floor((now.getTime() - latest.getTime()) / 86_400_000);
}

function hasOpenChallenge(key: string, open: OpenChallenge[]): boolean {
  return open.some((c) => c.challengerKey === key || c.defenderKey === key);
}

/**
 * Every player above the challenger, annotated with whether they can be challenged.
 * Ordered by rank, best (lowest number) first.
 */
export function challengeOptions(input: EligibilityInput): ChallengeOption[] {
  const { challengerKey, standings, matches, config } = input;
  const open = input.openChallenges ?? [];
  const now = input.now ?? new Date();

  const challenger = standings.find((s) => s.key === challengerKey);
  if (!challenger) return [];

  const challengerBlocked = blockingReasonFor(challenger, open, 'You');

  return standings
    .filter((s) => s.key !== challengerKey && s.rank < challenger.rank)
    .sort((a, b) => a.rank - b.rank)
    .map((target) => {
      const spotsAhead = challenger.rank - target.rank;
      const base = {
        key: target.key,
        displayName: target.displayName,
        rank: target.rank,
        spotsAhead,
      };

      if (spotsAhead > config.challengeRange) {
        return {
          ...base,
          eligible: false,
          reason:
            'Too far ahead - you may challenge up to ' +
            config.challengeRange +
            ' spot' +
            (config.challengeRange === 1 ? '' : 's') +
            ' above you (ranks ' +
            Math.max(1, challenger.rank - config.challengeRange) +
            '-' +
            (challenger.rank - 1) +
            ').',
        };
      }

      if (challengerBlocked) return { ...base, eligible: false, reason: challengerBlocked };

      const targetBlocked = blockingReasonFor(target, open, target.displayName);
      if (targetBlocked) return { ...base, eligible: false, reason: targetBlocked };

      const since = daysSinceLastMeeting(matches, challengerKey, target.key, now);
      if (since !== null && since < config.coolingOffDays) {
        const wait = config.coolingOffDays - since;
        return {
          ...base,
          eligible: false,
          reason:
            'Cooling-off period - you played ' +
            target.displayName +
            ' ' +
            (since === 0 ? 'today' : since === 1 ? 'yesterday' : since + ' days ago') +
            '. You can challenge again in ' +
            wait +
            ' day' +
            (wait === 1 ? '' : 's') +
            '.',
        };
      }

      return { ...base, eligible: true };
    });
}

function blockingReasonFor(
  row: StandingRow,
  open: OpenChallenge[],
  subject: string,
): string | null {
  const isSelf = subject === 'You';
  const verb = isSelf ? 'are' : 'is';

  if (row.activeStatus === 'Injured') {
    return subject + ' ' + verb + ' on Injury Hold and cannot play challenge matches.';
  }
  if (row.activeStatus === 'Inactive') {
    return subject + ' ' + verb + ' not currently active on the ladder.';
  }
  if (hasOpenChallenge(row.key, open)) {
    return subject + ' already ' + (isSelf ? 'have' : 'has') + ' an open challenge to resolve.';
  }
  return null;
}

/** Just the players who can actually be challenged (AC-2.1.1). */
export function eligibleTargets(input: EligibilityInput): ChallengeOption[] {
  return challengeOptions(input).filter((o) => o.eligible);
}

export interface ChallengeCheck {
  allowed: boolean;
  reason?: string;
}

/** Validate one specific challenge, for the submit path (DEV-201). */
export function canChallenge(
  input: EligibilityInput & { defenderKey: string },
): ChallengeCheck {
  const options = challengeOptions(input);
  const match = options.find((o) => o.key === input.defenderKey);

  if (!match) {
    const defender = input.standings.find((s) => s.key === input.defenderKey);
    const challenger = input.standings.find((s) => s.key === input.challengerKey);
    if (!defender || !challenger) {
      return { allowed: false, reason: 'That player is not on this ladder.' };
    }
    if (defender.rank > challenger.rank) {
      return {
        allowed: false,
        reason: 'You can only challenge players ranked above you.',
      };
    }
    return { allowed: false, reason: 'That challenge is not available.' };
  }

  return match.eligible ? { allowed: true } : { allowed: false, reason: match.reason };
}

/** Keys with an open challenge, for the "Challenge Pending" badge (AC-1.2.3). */
export function pendingChallengeKeys(open: OpenChallenge[]): Set<string> {
  const keys = new Set<string>();
  for (const c of open) {
    keys.add(c.challengerKey);
    keys.add(c.defenderKey);
  }
  return keys;
}
