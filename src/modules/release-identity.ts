import { CONTENT } from '../content/catalog';
import type { GameContent, GameState, Rejection } from '../contracts/types';
import type { EvaluatedReleaseIdentity } from '../contracts/wave27-canary';
import { canonicalStateHash } from '../core/canonical';
import { inheritedModelRights } from './model-runtime';
import { paidPolicyCapabilityBaseline, policyHoldoutReport, policyModelFingerprint, policyReleaseRejection } from './policy-holdouts';

const reject = (message: string): Rejection => ({ code: 'NOT_READY', message });

/** Captured report IDs remain valid when another evaluation is later completed. */
export function evaluatedReleaseIdentityReason(state: Readonly<GameState>, identity: EvaluatedReleaseIdentity,
  content: GameContent = CONTENT, atWeek = state.week): Rejection | undefined {
  const model = state.slices.models.versions[identity.modelId];
  if (!model || model.status === 'checkpoint') return reject('Choose a completed owned model version with paid release evidence.');
  if (identity.modelFingerprint !== policyModelFingerprint(model)
    || identity.runtimeSourceModelId !== (model.runtimeVariant?.sourceModelId ?? null)
    || identity.runtimeFingerprint !== (model.runtimeVariant ? canonicalStateHash(model.runtimeVariant) : null)) return reject('The captured model or runtime identity changed.');
  if (!paidPolicyCapabilityBaseline(state, model, identity.capabilityReportId, atWeek)) return reject('This exact model needs a completed paid capability report before release.');
  const policyReason = policyReleaseRejection(state, model.id); if (policyReason) return policyReason;
  if (model.policy) {
    // Validate the captured paid report itself. Later evaluations, or canonical
    // key ordering after reload, cannot silently replace its evidence identity.
    const scoped: Readonly<GameState> = { ...state, slices: { ...state.slices, models: { ...state.slices.models,
      reports: Object.fromEntries(Object.entries(state.slices.models.reports).filter(([id, report]) => report.modelId !== model.id
        || !report.policy || id === identity.policyReportId)) } } };
    const report = policyHoldoutReport(scoped, model.id);
    if (!report || report.id !== identity.policyReportId || report.week > atWeek) return reject('The captured policy-trained model needs its exact paid policy report.');
  } else if (identity.policyReportId !== null) return reject('An ordinary model cannot invent policy qualification.');
  const rights = inheritedModelRights(state, model.id, content);
  if (identity.rights.hosted !== rights.hosted || identity.rights.weights !== rights.weights) return reject('Inherited model rights differ from the captured release identity.');
}

export function getEvaluatedReleaseIdentity(state: Readonly<GameState>, modelId: string,
  content: GameContent = CONTENT, atWeek = state.week): EvaluatedReleaseIdentity | null {
  const model = state.slices.models.versions[modelId]; if (!model || model.status === 'checkpoint') return null;
  const report = Object.values(state.slices.models.reports).filter(item => paidPolicyCapabilityBaseline(state, model, item.id, atWeek))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];
  if (!report) return null;
  const identity: EvaluatedReleaseIdentity = { modelId, modelFingerprint: policyModelFingerprint(model), capabilityReportId: report.id,
    policyReportId: model.policy ? policyHoldoutReport(state, modelId)?.id ?? null : null,
    runtimeSourceModelId: model.runtimeVariant?.sourceModelId ?? null,
    runtimeFingerprint: model.runtimeVariant ? canonicalStateHash(model.runtimeVariant) : null,
    rights: inheritedModelRights(state, modelId, content) };
  return evaluatedReleaseIdentityReason(state, identity, content, atWeek) ? null : identity;
}
