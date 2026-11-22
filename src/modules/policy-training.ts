import { RESOURCE_SCALE as U } from '../contracts/types';
import type { DataPacket } from '../contracts/types';
import type { ModelPolicy, PolicyDataProvenance, PolicyEvidence, PolicyTrainingReceipt } from '../contracts/wave11-policy';
import { POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS, POLICY_DATA_ID, POLICY_DATA_RULES, POLICY_PROTOCOL, POLICY_REQUIRED_PAIRS, POLICY_TRAINING_METHODS } from '../content/wave11-policy';
import { mulDiv } from '../core/math';
import { finiteOutcome } from './lab-math';

export function policyDataProvenance(catalogId: string): PolicyDataProvenance | undefined {
  return catalogId === POLICY_DATA_ID ? { protocol: POLICY_PROTOCOL, sourceId: POLICY_DATA_ID, pairs: POLICY_DATA_RULES.pairs } : undefined;
}

/** Revisions of the same paid labels supply quality, never another set of pairs. */
export function policyEvidenceFromPackets(packets: readonly DataPacket[]): PolicyEvidence {
  const sources = new Map<string, { pairs: number; qualityBps: number }>();
  for (const packet of [...packets].sort((a, b) => b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))) {
    const provenance = packet.policy;
    if (!provenance || provenance.protocol !== POLICY_PROTOCOL || provenance.sourceId !== POLICY_DATA_ID
      || packet.catalogId !== POLICY_DATA_ID || !packet.prepared || packet.readyUnits !== packet.rawUnits
      || !packet.rights.hosted || !packet.sourceIds?.includes(provenance.sourceId) || sources.has(provenance.sourceId)) continue;
    sources.set(provenance.sourceId, { pairs: provenance.pairs, qualityBps: packet.qualityBps });
  }
  const sourceIds = [...sources.keys()].sort(), distinctPairs = [...sources.values()].reduce((total, item) => total + item.pairs, 0);
  const qualityBps = distinctPairs ? mulDiv([...sources.values()].reduce((total, item) => total + item.pairs * item.qualityBps, 0), 1, distinctPairs) : 0;
  return { sourceIds, distinctPairs, qualityBps };
}

export function createPolicyTrainingReceipt(recipeId: string, packets: readonly DataPacket[], baselineFalseRefusalBps: number): PolicyTrainingReceipt | undefined {
  const method = Object.hasOwn(POLICY_TRAINING_METHODS, recipeId) ? POLICY_TRAINING_METHODS[recipeId] : undefined;
  if (!method) return undefined;
  return { protocol: POLICY_PROTOCOL, approach: method.approach, ...policyEvidenceFromPackets(packets),
    baselineUnsafeComplianceBps: POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS, baselineFalseRefusalBps,
    targetUnsafeComplianceBps: method.targetUnsafeComplianceBps, targetFalseRefusalBps: method.targetFalseRefusalBps };
}

export function policyTrainingOutcome(receipt: PolicyTrainingReceipt, completedWork: number, requiredWork: number): { policy: ModelPolicy; falseRefusalBps: number } {
  const earned = { completedWork, requiredWork, relevantEvidence: receipt.distinctPairs * U, requiredEvidence: POLICY_REQUIRED_PAIRS * U, qualityBps: receipt.qualityBps };
  return {
    policy: { protocol: POLICY_PROTOCOL, baselineUnsafeComplianceBps: receipt.baselineUnsafeComplianceBps,
      currentUnsafeComplianceBps: finiteOutcome({ ...earned, anchorBps: receipt.baselineUnsafeComplianceBps, targetBps: receipt.targetUnsafeComplianceBps }) },
    falseRefusalBps: finiteOutcome({ ...earned, anchorBps: receipt.baselineFalseRefusalBps, targetBps: receipt.targetFalseRefusalBps }),
  };
}

export function validModelPolicy(value: ModelPolicy): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.protocol === POLICY_PROTOCOL
    && value.baselineUnsafeComplianceBps === POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS
    && Number.isSafeInteger(value.currentUnsafeComplianceBps) && value.currentUnsafeComplianceBps >= 300
    && value.currentUnsafeComplianceBps <= POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS;
}
