import type { GameState } from '../contracts/types';
import type { SystemsBriefId, SystemsBriefOrder, SystemsClientTier } from '../contracts/systems-briefs';
import type { ProductWorkloadId } from '../contracts/product-workloads';
import { SYSTEMS_BRIEFS } from '../content/systems-briefs';
import { hasConnectedCompanyRules } from '../core/connected-company-version';

export const SYSTEMS_CLIENT_WORKLOAD: Record<SystemsBriefId, ProductWorkloadId> = {
  'efficient-experts': 'responsive', 'bounded-memory': 'local', 'continuity-desk': 'continuity', 'verified-analysis': 'verified',
};
export interface SystemsClientRelationship {
  briefId: SystemsBriefId;
  client: string | null;
  tier: SystemsClientTier;
  completedCount: number;
  deliveredWeeks: number;
  priorOrderIds: string[];
  workload: ProductWorkloadId;
  acquisitionBonusBps: number;
}
function paidCompleted(state: Readonly<GameState>, beforeWeek: number): SystemsBriefOrder[] {
  return Object.values(state.slices.campaign.systemsBriefs ?? {}).filter(order => order.status === 'completed'
    && order.finishedWeek !== null && order.finishedWeek < beforeWeek
    && state.slices.company.postedFacts[`systems-brief-payment:${state.playerCompanyId}:${order.id}`] === true)
    .sort((a, b) => a.finishedWeek! - b.finishedWeek! || a.id.localeCompare(b.id));
}
/** Derive earned access from paid deliveries; there is no editable relationship XP counter. */
export function getSystemsClientRelationships(state: Readonly<GameState>, beforeWeek = state.week + 1): SystemsClientRelationship[] {
  const paid = paidCompleted(state, beforeWeek);
  return SYSTEMS_BRIEFS.map(def => {
    const all = paid.filter(order => order.briefId === def.id), client = all.at(-1)?.terms.client ?? null;
    const completed = all.filter(order => order.terms.client === client), count = completed.length;
    return { briefId: def.id, client, tier: count >= 2 ? 'partner' : count ? 'repeat' : 'pilot', completedCount: count,
      deliveredWeeks: completed.reduce((sum, order) => sum + order.terms.qualifyingWeeks, 0),
      priorOrderIds: completed.slice(-2).map(order => order.id), workload: SYSTEMS_CLIENT_WORKLOAD[def.id],
      acquisitionBonusBps: hasConnectedCompanyRules(state.contentVersion) ? count >= 2 ? 2500 : count ? 1200 : 0 : 0 };
  });
}
export function clientRelationshipAcquisitionBps(state: Readonly<GameState>, companyId: string, workload?: ProductWorkloadId): number {
  if (companyId !== state.playerCompanyId || !workload || !hasConnectedCompanyRules(state.contentVersion)) return 10000;
  return 10000 + Math.max(0, ...getSystemsClientRelationships(state).filter(relationship => relationship.workload === workload).map(relationship => relationship.acquisitionBonusBps));
}
