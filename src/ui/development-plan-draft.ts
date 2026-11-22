import type { CapabilityDomain, ModelVersion, TrainingProfile } from '../contracts/types';
import type { DevelopmentTrainingOrder } from '../contracts/development-plans';
import type { ModelDesignSpec } from '../contracts/model-design';
import { TRAINING_RECIPES } from '../content/wave2-lab';

export interface DevelopmentTrainingDraft {
  base: Pick<ModelVersion, 'id' | 'trainingRunId'> | undefined;
  packetIds: readonly string[];
  method: string;
  profile: TrainingProfile;
  design: ModelDesignSpec;
  teacherModelId: string;
  teacherDomain: CapabilityDomain;
}

/** Build exactly the ordinary training command authorized by the visible choices.
 * Recipe-specific controls must not leak into another method's command. */
export function buildDevelopmentTrainingOrder(draft: DevelopmentTrainingDraft): DevelopmentTrainingOrder | null {
  if (!draft.base || !draft.packetIds.length) return null;
  const common = { kind: 'start_training' as const, baseModelId: draft.base.id, packetId: draft.packetIds[0], packetIds: [...draft.packetIds] };
  if (draft.method === 'custom') return { ...common, recipeId: `custom-model-${draft.design.mode}`, modelDesign: structuredClone(draft.design) };
  const recipe = TRAINING_RECIPES.find(item => item.id === draft.method);
  return { ...common, recipeId: draft.method,
    ...((recipe?.kind === 'adaptation' || recipe?.kind === 'foundation') ? { profile: draft.profile } : {}),
    ...(recipe?.kind === 'adaptation' && draft.base.trainingRunId ? { continueFromParent: true as const } : {}),
    ...(recipe?.kind === 'distillation' ? { teacherModelId: draft.teacherModelId, teacherDomain: draft.teacherDomain } : {}),
  };
}
