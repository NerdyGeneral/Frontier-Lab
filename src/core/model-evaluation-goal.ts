import type { EvaluationSuiteId } from '../contracts/types';
import type { DevelopmentTrainingOrder } from '../contracts/development-plans';
import { TRAINING_RECIPES } from '../content/wave2-lab';

/** Evaluation advice describes what a test measures; it never grants research
 * or marks an unevaluated specialist ready for release. */
export function recommendedDesignEvaluation(training: DevelopmentTrainingOrder): { suiteId: EvaluationSuiteId; reason: string } {
  const design = training.modelDesign;
  if (design?.system) {
    return { suiteId: 'expanded-capabilities-1', reason: 'Establish a paid capability baseline for this operating design. Run its systems challenge next to measure cost, memory, retention or verified completion.' };
  }
  if (design && (design.dataMix.reasoning > 0 || design.dataMix.longContext > 0 || design.dataMix.multimodal > 0
    || ['reasoning','grounded','multimodal','agentic'].includes(design.customization?.objective ?? ''))) {
    return { suiteId: 'advanced-capabilities-1', reason: 'This design targets reasoning, long-context or visual skills. Advanced capabilities measures those skills; Basic conversation does not.' };
  }
  const method = TRAINING_RECIPES.find(r => r.id === training.recipeId);
  if (method?.kind === 'behavior' || method?.kind === 'calibration' || (design?.customization?.behavior && design.customization.behavior !== 'balanced')) {
    return { suiteId: 'behavior-cases-1', reason: 'This plan changes response behavior. Behavior cases measures useful answers, confident errors and unnecessary refusals.' };
  }
  if (design && Math.max(design.dataMix.documents,design.dataMix.coding,design.dataMix.tools) > design.dataMix.conversation
    || method && ['foundation','distillation','planning','synthetic','policy'].includes(method.kind)) {
    return { suiteId: 'expanded-capabilities-1', reason: 'Expanded capabilities checks conversation, documents, coding and tools so a specialist is not judged only on chat.' };
  }
  return { suiteId: 'basic-conversation-1', reason: 'Basic conversation checks the requirements for an initial Basic Chat release. More specialized uses need their own tests.' };
}
