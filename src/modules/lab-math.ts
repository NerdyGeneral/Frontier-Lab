import { RESOURCE_SCALE } from '../contracts/types';
import { checkedInteger, mulDiv } from '../core/math';
export interface FiniteOutcomeInput {
  anchorBps: number; targetBps: number; completedWork: number; requiredWork: number;
  relevantEvidence: number; requiredEvidence: number; qualityBps: number; ceilingBps?: number;
}
/** Fixed lineage anchor, finite evidence and absolute targets prevent repeated-run compounding. */
export function finiteOutcome(input: FiniteOutcomeInput): number {
  const { anchorBps, targetBps, completedWork, requiredWork, relevantEvidence, requiredEvidence, qualityBps } = input;
  const ceiling = input.ceilingBps ?? 10000;
  for (const n of [anchorBps, targetBps, completedWork, requiredWork, relevantEvidence, requiredEvidence, qualityBps, ceiling]) checkedInteger(n);
  if (!requiredWork || !requiredEvidence || [anchorBps, targetBps, qualityBps, ceiling].some(n => n > 10000)) throw new Error('Invalid finite training target.');
  const progress = Math.min(RESOURCE_SCALE, mulDiv(Math.min(completedWork, requiredWork), RESOURCE_SCALE, requiredWork), mulDiv(Math.min(relevantEvidence, requiredEvidence), RESOURCE_SCALE, requiredEvidence));
  const attainment = mulDiv(progress, qualityBps, 10000);
  const gap = mulDiv(Math.abs(targetBps - anchorBps), attainment, RESOURCE_SCALE, 'nearest');
  return Math.max(0, Math.min(ceiling, anchorBps + (targetBps >= anchorBps ? gap : -gap)));
}
