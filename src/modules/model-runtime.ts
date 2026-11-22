import type { GameContent, GameState, ModelVersion, WorkRequest } from '../contracts/types';
import { RIVAL_STARTS } from '../core/wave2-state';
import { SPARSE_DESIGN } from '../content/wave4-research';
import { mulDiv } from '../core/math';
import { isCapabilitySuite } from './evaluation-classification';

export function modelWorkBps(model: ModelVersion): number {
  return mulDiv(model.modelDesign?.servingWorkBps ?? (model.architecture === 'sparse' ? SPARSE_DESIGN.servingWorkBps : 10000), model.runtimeVariant?.servingWorkBps ?? 10000, 10000);
}
export function modelExecutionHints(model: ModelVersion, workloadKind: 'inference' | 'training' | 'general' = 'inference'): Pick<WorkRequest, 'modelArchitecture' | 'modelFamily' | 'workloadKind' | 'requiresFastFabric'> {
  return { modelArchitecture: model.architecture, modelFamily: model.family, workloadKind, ...(model.architecture === 'sparse' ? { requiresFastFabric: true } : {}) };
}
export function hasCapabilityEvaluation(state: Readonly<GameState>, modelId: string): boolean {
  const model = state.slices.models.versions[modelId];
  return !!model && Object.values(state.slices.models.reports).some(report => report.modelId === model.id && report.companyId === model.companyId && report.heldOut && isCapabilitySuite(report.suiteId));
}
/** Rights intersect along the whole ancestry DAG, including a distillation teacher. */
export function inheritedModelRights(state: Readonly<GameState>, modelId: string, content: GameContent): { hosted: boolean; weights: boolean } {
  const visit = (id: string, path: ReadonlySet<string>): { hosted: boolean; weights: boolean } => {
    if (path.has(id)) return { hosted: false, weights: false };
    const model = state.slices.models.versions[id];
    if (!model) return { hosted: false, weights: false };
    if (model.id === content.seedModel.id && model.companyId === content.seedModel.companyId) return { hosted: true, weights: true };
    if (model.scenarioStart === true && RIVAL_STARTS.some(seed => model.companyId === 'rival-' + seed.id && model.id === model.companyId + '-model-1')) return { hosted: true, weights: true };
    const next = new Set(path); next.add(id);
    if (model.runtimeVariant) {
      const source = state.slices.models.versions[model.runtimeVariant.sourceModelId];
      return source?.companyId === model.companyId ? visit(source.id, next) : { hosted: false, weights: false };
    }
    const run = model.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId] : undefined;
    if (!run || run.companyId !== model.companyId) return { hosted: false, weights: false };
    const inherited = visit(run.baseModelId, next), rights = run.plan?.corpus.rights ?? run.evidence.rights;
    const teacher = run.plan?.teacher ? visit(run.plan.teacher.modelId, next) : { hosted: true, weights: true };
    const replay = run.plan?.replay?.corpus.rights ?? { hosted: true, weights: true };
    const curriculum = run.plan?.curriculum?.tracks ?? [];
    return { hosted: inherited.hosted && rights.hosted && teacher.hosted && replay.hosted && curriculum.every(track => track.corpus.rights.hosted),
      weights: inherited.weights && rights.weights && teacher.weights && replay.weights && curriculum.every(track => track.corpus.rights.weights) };
  };
  return visit(modelId, new Set());
}
