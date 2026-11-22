import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import type { GameState, ModelVersion, ProductFeatures, ProductKind, SegmentDefinition } from '../contracts/types';
import { DEFAULT_FEATURES, MARKET_SEGMENTS, SEGMENT_BY_ID } from '../content/wave2-market';
import { mulDiv } from '../core/math';
import { BASE_BEHAVIOR } from './lab-planner';
import { modelWorkBps } from './model-runtime';
import { isCapabilitySuite } from './evaluation-classification';
import { policyReleaseRejection } from './policy-holdouts';

/** Shared public-model eligibility and standard request measurements. */
export function familyMultiplier(model: ModelVersion): number { return FAMILY_SERVING_MULTIPLIER[model.family]; }
export function requestMeter(model: ModelVersion, features: ProductFeatures) {
  const inputTokens = (500 + (features.memory ? 100 : 0)) * (features.extendedContext ? 2 : 1);
  const outputTokens = 100, internalTokens = features.deepReasoning ? 200 : 0;
  // 0.0002 CUw/1K input and 0.001/1K output/internal; apply family scaling once.
  return { inputTokens, outputTokens, internalTokens, work: mulDiv((inputTokens * 200 + (outputTokens + internalTokens) * 1000) * familyMultiplier(model), modelWorkBps(model), 10000), sessionMemory: features.extendedContext ? 80_000_000 : 20_000_000 };
}

export function taskScore(model: ModelVersion, segment: SegmentDefinition, features: ProductFeatures, documentBonusBps = 0): number {
  const s = model.capabilityBps;
  const base = segment.market === 'developer' ? mulDiv(s.coding, 8000, 10000) + mulDiv(s.tools, 2000, 10000)
    : segment.market === 'business' ? mulDiv(s.documents, 8000, 10000) + mulDiv(s.conversation, 2000, 10000) : s.conversation;
  const advanced = model.advancedCapabilities;
  const reasoning = features.deepReasoning ? (advanced ? mulDiv(advanced.reasoning, 1600, 10000) : 1000) : 0;
  const context = features.extendedContext && (segment.market !== 'consumer' || segment.id === 'professional') ? (advanced ? mulDiv(advanced.longContext, 1000, 10000) : 500) : 0;
  const multimodal = advanced && segment.market === 'business' ? mulDiv(advanced.multimodal, 600, 10000) : 0;
  return Math.min(advanced ? 9900 : 9500, base + reasoning + context + multimodal + (segment.market === 'business' ? documentBonusBps : 0));
}
export function executionErrorBps(model: ModelVersion, segment: SegmentDefinition = SEGMENT_BY_ID.regular, features: ProductFeatures = { ...DEFAULT_FEATURES }, documentBonusBps = 0): number {
  const quality = taskScore(model, segment, features, documentBonusBps);
  const probability = (difficulty: number) => mulDiv(Math.max(500, Math.min(9800, 5000 + quality - difficulty)), model.reliabilityBps, 10000);
  const success = segment.market === 'developer' ? mulDiv(probability(1000), 7000, 10000) + mulDiv(probability(3000), 3000, 10000)
    : segment.market === 'business' ? mulDiv(probability(0), 7000, 10000) + mulDiv(probability(2000), 3000, 10000) : probability(segment.difficultyBps);
  return 10000 - success;
}
export function segmentForProduct(kind: ProductKind): SegmentDefinition[] {
  return MARKET_SEGMENTS.filter(s => s.market === (kind === 'developer-api' ? 'developer' : kind === 'business-docs' ? 'business' : 'consumer'));
}

export function behaviorMeter(model: ModelVersion, technicalErrorBps: number) {
  const behavior = model.behavior ?? BASE_BEHAVIOR;
  return { confidentErrorBps: Math.min(technicalErrorBps, behavior.confidentErrorBps), falseRefusalBps: behavior.falseRefusalBps };
}

export function eligibleModel(state: Readonly<GameState>, modelId: string, companyId: string, kind: ProductKind) {
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== companyId || policyReleaseRejection(state, model.id)) return false;
  const reports = Object.values(state.slices.models.reports).filter(r => r.modelId === model.id && r.companyId === companyId && isCapabilitySuite(r.suiteId));
  if (!reports.length) return false;
  if (kind === 'developer-api') return model.capabilityBps.coding >= 5000 && model.reliabilityBps >= 8000;
  if (kind === 'business-docs') return model.capabilityBps.documents >= 5500 && model.reliabilityBps >= 9000 && (state.slices.research.completedByCompany[companyId] ?? []).some(id => id === 'R6' || id === 'R12');
  return reports.some(r => r.basicChatEligible);
}
