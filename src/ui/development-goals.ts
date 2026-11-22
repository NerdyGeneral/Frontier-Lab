import type { DevelopmentGoal } from '../persistence/model-workspace';
import type { GameState, ModelVersion } from '../contracts/types';
import { MODEL_CHALLENGES } from '../content/model-challenges';
import { getModelChallengeCaseViews } from '../modules/model-challenges';
import { getSystemsBriefOffers, systemsBriefRequirements } from '../modules/systems-briefs';
import { MODEL_DESIGN_PURPOSES } from './model-design-draft';

export const SYSTEMS_GOAL_NAMES = {
  'systems-cost-1': 'Efficient serving', 'systems-memory-1': 'Bounded memory',
  'systems-retention-1': 'Case retention', 'systems-verification-1': 'Verified completion',
} as const;
export const BRIEF_GOAL_NAMES = {
  'efficient-experts': 'Expert service desk', 'bounded-memory': 'Local knowledge assistant',
  'continuity-desk': 'Case continuity service', 'verified-analysis': 'Verified analysis desk',
} as const;
export const BRIEF_CHALLENGES = {
  'efficient-experts': 'systems-cost-1', 'bounded-memory': 'systems-memory-1',
  'continuity-desk': 'systems-retention-1', 'verified-analysis': 'systems-verification-1',
} as const;

export function developmentGoalName(goal: DevelopmentGoal | null | undefined): string {
  if (!goal) return 'Open exploration';
  if (goal.kind === 'purpose') return MODEL_DESIGN_PURPOSES.find(item => item.id === goal.id)?.name ?? goal.id;
  return goal.kind === 'system-challenge' ? SYSTEMS_GOAL_NAMES[goal.id] : BRIEF_GOAL_NAMES[goal.id];
}
export function developmentGoalResearch(goal: DevelopmentGoal | null | undefined): readonly string[] {
  if (!goal) return [];
  if (goal.kind === 'purpose') return ({ balanced: ['R2', 'R3', 'R4'], support: ['M10', 'M12', 'A5', 'A6', 'A8'], coding: ['M9', 'A9', 'A10', 'A11'], analyst: ['M8', 'M4', 'A9', 'A10', 'A11', 'A12'], visual: ['M11', 'M4'] } as const)[goal.id];
  const suite = goal.kind === 'system-challenge' ? goal.id : BRIEF_CHALLENGES[goal.id];
  return ({ 'systems-cost-1': ['M1', 'M2', 'M6', 'A1', 'A2', 'A3'], 'systems-memory-1': ['M1', 'M6', 'M7', 'A5', 'A6'],
    'systems-retention-1': ['A5', 'A6', 'A7', 'A8'], 'systems-verification-1': ['A9', 'A10', 'A11', 'A12'] } as const)[suite];
}

/** Read the same authored challenge requirements used by the paid evaluation.
 * A preview is planning advice and never creates a report or awards a title. */
export function developmentGoalChecks(game: GameState, goal: DevelopmentGoal, model?: ModelVersion) {
  if (goal.kind === 'purpose') return {
    description: MODEL_DESIGN_PURPOSES.find(item => item.id === goal.id)?.description ?? '',
    requirements: [] as string[], customerMissing: [] as string[], checks: [] as ReturnType<typeof getModelChallengeCaseViews>,
    destination: '#lab-projects', destinationLabel: 'Continue this design',
  };
  const suiteId = goal.kind === 'system-challenge' ? goal.id : BRIEF_CHALLENGES[goal.id];
  const challenge = MODEL_CHALLENGES.find(item => item.id === suiteId);
  const offer = goal.kind === 'renewable-brief' ? getSystemsBriefOffers(game).find(item => item.briefId === goal.id) : undefined;
  const checks = model ? getModelChallengeCaseViews(model, suiteId) : [];
  return {
    description: offer?.description ?? challenge?.description ?? 'Build toward this operating target, then measure the finished model.',
    requirements: offer?.requirements ?? [], customerMissing: model && offer ? systemsBriefRequirements(model, offer) : [], checks,
    destination: goal.kind === 'renewable-brief' ? '#customer-briefs' : '#model-challenges',
    destinationLabel: goal.kind === 'renewable-brief' ? 'View customer opportunity' : 'View paid challenge',
  };
}
