import { CONTENT } from '../content/catalog';
import { FAMILY_DESIGNS, TRAINING_RECIPES } from '../content/wave2-lab';
import { POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS } from '../content/wave11-policy';
import type { GameState, ModelVersion } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import type { CapabilityDomain, ModelBehavior, TrainingRecipe } from '../contracts/wave2-lab';
import { BASE_BEHAVIOR, DOMAINS, getTrainingPreview, type TrainingOptions, type TrainingPreview } from './lab-planner';

const LABELS = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use', reliability: 'Reliability',
  confidentError: 'Confident mistakes', falseRefusal: 'Unnecessary refusals', unsafeCompliance: 'Restricted requests accepted', repeatWork: 'Repeat lookup workload' } as const;
type DevelopmentMetric = keyof typeof LABELS;
type SpecialtyMetric = 'confidentError' | 'falseRefusal' | 'unsafeCompliance' | 'repeatWork';
type TrainingKind = TrainingRecipe['kind'];

export interface DevelopmentMetricRow {
  id: DevelopmentMetric;
  label: string;
  currentBps: number;
  minBps: number;
  maxBps: number;
  lowerIsBetter: boolean;
}

function row(id: DevelopmentMetric, currentBps: number, minBps: number, maxBps = minBps, lowerIsBetter = false): DevelopmentMetricRow {
  return { id, label: LABELS[id], currentBps, minBps, maxBps, lowerIsBetter };
}

function specialtyScores(behavior: ModelBehavior | undefined, unsafe: number | undefined, repeat: number | undefined): Record<SpecialtyMetric, number> {
  return { confidentError: behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps,
    falseRefusal: behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps,
    unsafeCompliance: unsafe ?? POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS, repeatWork: repeat ?? 10000 };
}

function specialtyRows(base: ModelVersion, after: Record<SpecialtyMetric, number>, kind?: TrainingKind): DevelopmentMetricRow[] {
  const before = specialtyScores(base.behavior, base.policy?.currentUnsafeComplianceBps, base.planner?.currentRepeatBps);
  const relevant: Partial<Record<SpecialtyMetric, TrainingKind>> = { confidentError: 'calibration', falseRefusal: 'policy', unsafeCompliance: 'policy', repeatWork: 'planning' };
  return (Object.keys(before) as SpecialtyMetric[]).filter(id => (kind !== undefined && relevant[id] === kind) || before[id] !== after[id])
    .map(id => row(id, before[id], after[id], after[id], true));
}

/** Raw model attributes, independent of any paid test or commercial release. */
export function getModelDevelopmentRows(base: ModelVersion, model: ModelVersion, kind?: TrainingKind): DevelopmentMetricRow[] {
  return [
    ...DOMAINS.map(id => row(id, base.capabilityBps[id], model.capabilityBps[id])),
    row('reliability', base.reliabilityBps, model.reliabilityBps),
    ...specialtyRows(base, specialtyScores(model.behavior, model.policy?.currentUnsafeComplianceBps, model.planner?.currentRepeatBps), kind),
  ];
}

export interface TrainingDevelopment {
  rows: DevelopmentMetricRow[];
  explanation: string;
  nextAction: 'data' | 'recipe' | 'evaluate' | null;
  forecastUsable: boolean;
}

function developmentAdvice(base: ModelVersion, options: TrainingOptions, forecast: TrainingPreview, recipe: TrainingRecipe): string {
  if (recipe.kind === 'foundation') return 'This blueprint builds an independent foundation. The comparison shows how its scores would differ from the selected reference model.';
  if (recipe.kind === 'behavior') return 'Behavior examples train reliability while preserving the version’s four skill scores. Higher-quality behavior data can raise the result.';
  if (recipe.kind === 'calibration') return 'Behavior examples teach the model when to ask for clarification. Look for a lower confident-mistake rate.';
  if (recipe.kind === 'policy') return 'Paired examples teach which requests to allow or refuse. Compare both error rates to see the effect of the chosen approach.';
  if (recipe.kind === 'planning') return 'Watch repeat lookup workload. Lower means the model can complete the same workflow with fewer redundant lookups.';
  if (recipe.kind === 'distillation') return 'The teacher provides examples in the selected skill. The student’s family limits its attainable score.';
  if (recipe.kind === 'synthetic') return 'The audited examples target one skill. Other skills and reliability carry over from the selected model.';
  const focus = DOMAINS.reduce<CapabilityDomain>((best, id) => recipe.targets[id] > recipe.targets[best] ? id : best, DOMAINS[0]);
  const relevant = forecast.corpus.relevantUnits[focus] / RESOURCE_SCALE;
  const limit = FAMILY_DESIGNS[base.family].ceilings[focus];
  const atCeiling = forecast.capabilityRange.minimum[focus] >= limit && base.capabilityBps[focus] >= limit;
  const strength = atCeiling ? `${LABELS[focus]} is at this family’s ceiling. Try another skill or design a larger foundation.`
    : relevant < recipe.relevantUnits ? `The selected data supplies ${Number(relevant.toFixed(1))} of ${recipe.relevantUnits} relevant ${LABELS[focus].toLowerCase()} examples. Add prepared data covering this skill to increase coverage.`
    : `Your data covers the full ${LABELS[focus].toLowerCase()} target. Its ${Number((forecast.corpus.qualityBps[focus] / 100).toFixed(1))}% quality limits how closely the model reaches the target.`;
  return options.continueFromParent ? strength + ' Skills above the new target give up a quarter of the difference.' : strength;
}

export function getTrainingDevelopment(game: Readonly<GameState>, options: TrainingOptions, existingForecast?: TrainingPreview): TrainingDevelopment {
  const forecast = existingForecast ?? getTrainingPreview(game, game.playerCompanyId, options, CONTENT);
  const base = game.slices.models.versions[options.baseModelId];
  const recipe = TRAINING_RECIPES.find(item => item.id === forecast.recipeId);
  const blocked = forecast.reason;
  if (!base || base.companyId !== game.playerCompanyId || !recipe || (blocked && !['NO_IMPROVEMENT', 'ALREADY_ACTIVE'].includes(blocked.code))) {
    const missingData = !!blocked && /dataset|prepared|data units|behavior cases|evidence/i.test(blocked.message);
    return { rows: [], forecastUsable: false, explanation: blocked?.message ?? 'Choose a saved model and a training method to see a forecast.', nextAction: missingData ? 'data' : null };
  }
  if (blocked?.code === 'ALREADY_ACTIVE') return { rows: [], explanation: 'This training plan is already in progress. Let the current run finish or resume it from Projects.', nextAction: null, forecastUsable: false };
  if (blocked?.code === 'NO_IMPROVEMENT') return { rows: [], explanation: blocked.message.includes('already have') ?
    'Your lab already trained this method on the same evidence in this model family. Add a distinct prepared dataset, improve its quality, or choose another method.' :
    'This plan produces no improvement on the selected version. Try higher-quality data for the target skill or a method that develops another strength.', nextAction: 'data', forecastUsable: false };
  const after = specialtyScores(forecast.behavior, forecast.policy?.unsafeComplianceBps ?? (recipe.kind === 'foundation' ? undefined : base.policy?.currentUnsafeComplianceBps), forecast.plannerRepeatBps);
  const rows = [
    ...DOMAINS.map(id => row(id, base.capabilityBps[id], forecast.capabilityRange.minimum[id], forecast.capabilityRange.maximum[id])),
    row('reliability', base.reliabilityBps, forecast.reliabilityRange.minimum, forecast.reliabilityRange.maximum),
    ...specialtyRows(base, after, recipe.kind),
  ];
  return { rows, explanation: developmentAdvice(base, options, forecast, recipe), nextAction: null, forecastUsable: true };
}
