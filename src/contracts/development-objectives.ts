import type { SystemsBriefId, SystemsBriefTerms } from './systems-briefs';
import type { SystemsChallengeSuiteId } from './model-challenges';

export const DEVELOPMENT_PURPOSE_IDS = ['balanced', 'support', 'coding', 'analyst', 'visual'] as const;
export const DEVELOPMENT_SYSTEM_SUITES = ['systems-cost-1', 'systems-memory-1', 'systems-retention-1', 'systems-verification-1'] as const;
export const DEVELOPMENT_BRIEF_SUITES: Record<SystemsBriefId, SystemsChallengeSuiteId> = {
  'efficient-experts': 'systems-cost-1', 'bounded-memory': 'systems-memory-1',
  'continuity-desk': 'systems-retention-1', 'verified-analysis': 'systems-verification-1',
};
type Purpose = { kind: 'purpose'; id: typeof DEVELOPMENT_PURPOSE_IDS[number] };
type Challenge = { kind: 'system-challenge'; id: SystemsChallengeSuiteId };
/** Browser drafts may contain the historical category-only goal. Scheduling a
 * project always resolves that category into a specific immutable offer. */
export type DevelopmentGoal = Purpose | Challenge | { kind: 'renewable-brief'; id: SystemsBriefId; terms?: SystemsBriefTerms };
export type DevelopmentProjectObjective = Purpose | Challenge | { kind: 'renewable-brief'; id: SystemsBriefId; terms: SystemsBriefTerms };

export function developmentObjectiveChallenge(objective: DevelopmentGoal | null | undefined): SystemsChallengeSuiteId | undefined {
  return objective?.kind === 'system-challenge' ? objective.id
    : objective?.kind === 'renewable-brief' ? DEVELOPMENT_BRIEF_SUITES[objective.id] : undefined;
}

/** Structural validation only. Paid commands additionally compare customer
 * terms to the canonical, versioned offer for this campaign. */
export function isDevelopmentGoal(value: unknown): value is DevelopmentGoal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const goal = value as Record<string, unknown>;
  if (Object.keys(goal).some(key => !['kind', 'id', ...(goal.kind === 'renewable-brief' ? ['terms'] : [])].includes(key))) return false;
  if (goal.kind === 'purpose') return (DEVELOPMENT_PURPOSE_IDS as readonly unknown[]).includes(goal.id);
  if (goal.kind === 'system-challenge') return (DEVELOPMENT_SYSTEM_SUITES as readonly unknown[]).includes(goal.id);
  if (goal.kind !== 'renewable-brief' || typeof goal.id !== 'string' || !Object.hasOwn(DEVELOPMENT_BRIEF_SUITES, goal.id)) return false;
  if (!Object.hasOwn(goal, 'terms')) return true;
  const terms = goal.terms as SystemsBriefTerms | undefined;
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return false;
  const fields = ['version', 'id', 'briefId', 'windowIndex', 'opensWeek', 'acceptUntilWeek', 'client', 'scale', 'feeCents', 'requestsPerWeek', 'concurrentSessions', 'deadlineWeeks', 'qualifyingWeeks', 'challengeSuiteId', 'minimumScores', 'reliabilityBps', 'maxServingCUwPer1000', 'maxMemoryMU', 'minRetentionBps', 'minVerifiedBps', 'maxLatencyBps', ...(terms.version === 2 ? ['relationship'] : [])];
  if (Object.keys(terms).sort().join() !== fields.sort().join()) return false;
  const count = (item: unknown, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(item) && (item as number) >= 0 && (item as number) <= maximum;
  const text = (item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 160 && !/[\u0000-\u001f\u007f]/.test(item);
  if (!['scale', 'feeCents', 'requestsPerWeek', 'concurrentSessions', 'deadlineWeeks', 'qualifyingWeeks'].every(key => count((terms as unknown as Record<string, unknown>)[key]))) return false;
  if (![terms.maxServingCUwPer1000, terms.maxMemoryMU, terms.maxLatencyBps].every(item => item === null || count(item))
    || ![terms.minRetentionBps, terms.minVerifiedBps].every(item => item === null || count(item, 10000)) || !count(terms.reliabilityBps, 10000)) return false;
  if (terms.version === 2) {
    const relationship = terms.relationship;
    if (!relationship || typeof relationship !== 'object' || Object.keys(relationship).sort().join() !== 'priorOrderIds,tier'
      || !['pilot', 'repeat', 'partner'].includes(relationship.tier) || !Array.isArray(relationship.priorOrderIds)
      || relationship.priorOrderIds.length > 200 || !relationship.priorOrderIds.every(text) || new Set(relationship.priorOrderIds).size !== relationship.priorOrderIds.length) return false;
  }
  return [1, 2].includes(terms.version)
    && terms.briefId === goal.id && terms.challengeSuiteId === DEVELOPMENT_BRIEF_SUITES[terms.briefId]
    && count(terms.windowIndex, 100000)
    && terms.id === `systems-offer-${goal.id}-${terms.windowIndex}`
    && count(terms.opensWeek) && count(terms.acceptUntilWeek)
    && terms.acceptUntilWeek >= terms.opensWeek && text(terms.client)
    && typeof terms.minimumScores === 'object' && terms.minimumScores !== null && !Array.isArray(terms.minimumScores)
    && Object.entries(terms.minimumScores).every(([domain, score]) => ['conversation', 'documents', 'coding', 'tools', 'reasoning', 'longContext', 'multimodal'].includes(domain) && count(score, 10000));
}
export function isDevelopmentProjectObjective(value: unknown): value is DevelopmentProjectObjective {
  return isDevelopmentGoal(value) && (value.kind !== 'renewable-brief' || !!value.terms);
}
