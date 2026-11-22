import type { ComputePool, LedgerFact, ResourceFrame, WorkCategory } from './types';

export type ComputeCostTargetKind = 'public-product' | 'batch-inference' | 'assured-api' | 'private-service' | 'weight-license' | 'agent-orders' | 'internal' | 'other-revenue';

/** Historical names and source bindings stay fixed when a product or rack later changes. */
export interface ComputeCostTarget {
  id: string;
  kind: ComputeCostTargetKind;
  sourceId: string;
  name: string;
  contractId?: string;
  commercialGeneration?: number;
  commercialSignedWeek?: number;
  category?: WorkCategory;
  requestIds: string[];
  revenueFactIds: string[];
}

/** Only facts posted in this settled week, and this company's own resource frame. */
export interface ComputeCostSnapshot {
  protocol: 'compute-costs-1';
  id: string;
  companyId: string;
  week: number;
  rolloutId: string;
  cloudRentCentsPerCUWeek: number;
  pools: ComputePool[];
  resources: ResourceFrame;
  ledgerFacts: LedgerFact[];
  variableCostCarryIn: number;
  variableCostCarryOut: number;
  targets: ComputeCostTarget[];
}

export interface ComputeWorkloadCost {
  requestId: string;
  targetId: string;
  category: WorkCategory;
  poolId: string;
  requestedWorkCUw: number;
  effectiveWorkCUw: number;
  physicalWorkCUw: number;
  reservedCUw: number;
  headroomCUw: number;
  chargedMemoryMU: number;
  cloudRentCents: number;
  ownedVariableCents: number;
  attributedComputeCents: number;
}

export interface ComputePoolCostUsage {
  poolId: string;
  physicalWorkCUw: number;
  reservedCUw: number;
  headroomCUw: number;
  unusedCapacityCU: number;
  unavailableCapacityCU: number;
  chargedMemoryMU: number;
  attributedCloudRentCents: number;
  attributedOwnedVariableCents: number;
}

export interface ComputeCostActivity {
  targetId: string;
  revenueCents: number;
  cloudRentCents: number;
  ownedVariableCents: number;
  attributedComputeCents: number;
  /** Revenue less attributed compute; excludes shared costs and every other expense. */
  contributionCents: number;
  physicalWorkCUw: number;
  reservedCUw: number;
}

export interface ComputeCostTotals {
  cloudRentCents: number;
  ownedFixedCents: number;
  ownedVariableCents: number;
  attributedCloudRentCents: number;
  attributedOwnedVariableCents: number;
  attributedComputeCents: number;
  unallocatedCloudCents: number;
  /** At most one cent completed by the prior week's fractional owned-work carry. */
  sharedCarryCents: number;
  sharedComputeCents: number;
  totalComputeCents: number;
  companyRevenueCents: number;
  otherOperatingCents: number;
  companyOperatingCents: number;
  capitalOutlayCents: number;
  operatingSurplusCents: number;
}

export interface ComputeCostReport extends ComputeCostSnapshot {
  workloads: ComputeWorkloadCost[];
  poolUsage: ComputePoolCostUsage[];
  activities: ComputeCostActivity[];
  totals: ComputeCostTotals;
}

export interface Wave8ComputeCostFields {
  /** Opt-in, settled records. Absence leaves older simulations byte-for-byte unchanged. */
  costReports?: Record<string, ComputeCostReport[]>;
}
