import { RESOURCE_SCALE as U, type GameState } from '../contracts/types';
import type { ModelDesignSpec } from '../contracts/model-design';
import { CONTENT } from '../content/catalog';
import { getModelDesignForecast } from '../modules/model-design';
import { getTrainingPreview } from '../modules/lab-planner';

export interface ModelDesignCandidate { spec: ModelDesignSpec; baseModelId: string; packetIds: string[] }
export const DESIGN_SKILL_NAMES = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use',
  reasoning: 'Reasoning', longContext: 'Long context', multimodal: 'Multimodal' } as const;

export function copyModelDesignCandidate(candidate: ModelDesignCandidate): ModelDesignCandidate {
  return structuredClone(candidate);
}

export function humanizeDesignRequirement(message: string): string {
  return message.replace(/\b[A-Z]\d+[A-Z]?\b/g, id => CONTENT.research.find(item => item.id === id)?.name ?? id);
}

/** Both candidates use the ordinary calculator and their own saved inputs. */
export function getDesignCandidateForecast(game: GameState, candidate: ModelDesignCandidate) {
  const { spec, baseModelId, packetIds } = candidate;
  const design = getModelDesignForecast(game, game.playerCompanyId, baseModelId, packetIds, spec);
  const preview = game.slices.models.versions[baseModelId] && packetIds.length ? getTrainingPreview(game, game.playerCompanyId, {
    baseModelId, packetId: packetIds[0], packetIds, recipeId: `custom-model-${spec.mode}`, modelDesign: spec,
  }) : null;
  const hasPrepared = packetIds.some(id => {
    const packet = game.slices.data.packets[id];
    return packet?.prepared && packet.readyUnits > 0 && (packet.companyId ?? game.playerCompanyId) === game.playerCompanyId;
  });
  return { design, preview, hasPrepared, reason: design.reason ?? preview?.reason };
}

export function forecastSkill(preview: ReturnType<typeof getTrainingPreview>, domain: keyof typeof DESIGN_SKILL_NAMES) {
  return domain in preview.capabilityRange.maximum ? preview.capabilityRange.maximum[domain as keyof typeof preview.capabilityRange.maximum]
    : preview.advancedCapabilityRange?.maximum[domain as 'reasoning' | 'longContext' | 'multimodal'] ?? 0;
}

/** A conditional preview, not a new rule or a claim that all future research is
 * exhausted. Keep the exact data and design while testing a larger paid run. */
export function getComputeBenefitHint(game: GameState, candidate: ModelDesignCandidate): string | null {
  const current = getDesignCandidateForecast(game, candidate);
  if (!current.hasPrepared || !current.preview || candidate.spec.computeBudgetCUw >= 50000 * U) return null;
  const budget = Math.min(50000 * U, candidate.spec.computeBudgetCUw * 2);
  const alternative = getDesignCandidateForecast(game, { ...candidate, spec: { ...candidate.spec, computeBudgetCUw: budget } });
  if (!alternative.preview) return null;
  const targeted = (Object.keys(DESIGN_SKILL_NAMES) as (keyof typeof DESIGN_SKILL_NAMES)[]).filter(domain => candidate.spec.dataMix[domain] > 0);
  const bestGain = Math.max(0, ...targeted.map(domain => forecastSkill(alternative.preview!, domain) - forecastSkill(current.preview!, domain)));
  if (bestGain > 25) return null;
  const budgetLabel = (budget / U).toLocaleString('en-US');
  return bestGain === 0 ? `With the same data and architecture, ${budgetLabel} CUw adds no predicted gain to the targeted skills. Change the evidence or design before spending more compute.`
    : `With the same data and architecture, ${budgetLabel} CUw adds at most ${(bestGain / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} skill points. Extra compute is giving little benefit here.`;
}

/** Consecutive edits to one control are one undo step; every preset is separate. */
export function rememberModelDesign(history: readonly ModelDesignSpec[], value: ModelDesignSpec): ModelDesignSpec[] {
  return [...history.slice(-9).map(item => structuredClone(item)), structuredClone(value)];
}
