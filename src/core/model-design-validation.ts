import type { GameContent, GameState, TrainingRun } from '../contracts/types';
import { buildCustomTrainingPlan, isCustomTrainingRecipe } from '../modules/model-design-training';
import { modelDesignRejection, modelDesignShapeRejection } from '../modules/model-design';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);
export function assertCustomTrainingRun(state: GameState, run: TrainingRun, content: GameContent, identities: Set<string>): void {
  const plan = run.plan, spec = plan?.modelDesign?.spec;
  check(plan && spec && isCustomTrainingRecipe(run.recipeId) && !modelDesignShapeRejection(spec), 'Custom training needs a valid immutable model design.');
  check(plan!.foundationRights === undefined || (plan!.kind === 'foundation' && plan!.foundationRights === 'independent'), 'Only a new foundation can start an independent rights lineage.');
  check(run.recipeId === `custom-model-${spec!.mode}` && !modelDesignRejection(state, run.companyId, run.baseModelId, spec!, run.startedWeek), 'Custom training used an unavailable model design or unearned research.');
  const expected = buildCustomTrainingPlan(state, run.companyId, { baseModelId: run.baseModelId, packetId: run.packetId,
    packetIds: plan!.corpus.packetIds, recipeId: run.recipeId, modelDesign: spec }, content, run.startedWeek, plan!.foundationRights ?? null);
  check(same(plan, expected.plan), 'Custom model targets, architecture, evidence or research changed after admission.');
  check(run.requiredWork === expected.requiredWork && run.requiredMemory === expected.requiredMemory
    && same(run.anchorScores, expected.anchorScores) && run.anchorReliabilityBps === expected.anchorReliabilityBps
    && same(run.evidence, expected.evidence), 'Custom training changed its paid work, workspace or evidence.');
  check(!identities.has(plan!.identity), 'An identical custom design was repeated to reroll its outcome.'); identities.add(plan!.identity);
  const admission = state.commandReceipts[run.id.slice('training-'.length)];
  check(run.id.startsWith('training-') && admission?.status === 'accepted' && admission.week === run.startedWeek, 'Custom training has no accepted admission.');
  check(state.slices.company.postedFacts[run.id + ':setup'], 'Custom design setup fee was not posted.');
  const fee = state.slices.company.ledger.find(item => item.id === run.id + ':setup');
  if (fee) check(fee.companyId === run.companyId && fee.sourceId === run.id && fee.week === run.startedWeek && fee.amountCents === expected.recipe.feeCents && fee.kind === 'expense', 'Custom design changed its posted setup cost.');
  const prep = run.preparationCompleted ?? 0; checkedInteger(prep);
  check(prep <= plan!.preparationRequired && (prep === plan!.preparationRequired || run.completedWork === 0), 'Custom training began before architecture preparation finished.');
  check((run.checkpointOverheadCompleted ?? 0) === 0 && run.teacherWorkCompleted === undefined && run.teacherPhysicalWork === undefined, 'Custom training invented checkpoint or teacher work.');
  const checkpointIds = run.checkpointModelIds ?? [];
  check(new Set(checkpointIds).size === checkpointIds.length && checkpointIds.every(id => state.slices.models.versions[id]?.trainingRunId === run.id), 'Custom training checkpoint identity is invalid.');
  for (const point of plan!.checkpoints) {
    const work = mulDiv(run.requiredWork, point.atBps, 10000, 'ceil');
    const id = point.atBps === 10000 ? run.outputModelId : 'checkpoint-' + run.id;
    const model = state.slices.models.versions[id];
    if (model) check(work <= run.completedWork && same(model.modelDesign, plan!.modelDesign), 'Custom checkpoint changed its engineering design or earned work.');
  }
  if (run.status === 'complete') check(prep === plan!.preparationRequired, 'Completed custom training skipped architecture work.');
}
export function assertModelDesignInheritance(state: GameState): void {
  for (const model of Object.values(state.slices.models.versions)) {
    if (model.family === 'edge' || model.family === 'frontier') check(model.modelDesign && (model.trainingRunId || model.runtimeVariant), 'Edge and frontier models require a paid researched design.');
    const parent = model.runtimeVariant ? state.slices.models.versions[model.runtimeVariant.sourceModelId] : model.parentModelId ? state.slices.models.versions[model.parentModelId] : undefined;
    const run = model.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId] : undefined;
    const expected = run?.plan?.modelDesign ?? (model.runtimeVariant || (run && run.plan?.kind !== 'foundation' && run.plan?.kind !== 'distillation') ? parent?.modelDesign : undefined);
    check(same(model.modelDesign ?? null, expected ?? null), 'Model engineering choices differ from its paid design or parent.');
  }
}
