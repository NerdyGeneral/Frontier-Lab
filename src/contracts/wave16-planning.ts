import type { BatchOrderId } from './wave14-batch';

/** A read-only comparison. Capacity choices are hypothetical until a command applies them. */
export interface BatchPlacementForecastOptions {
  jobId?: string;
  productId?: string;
  orderId?: BatchOrderId;
  modelId?: string;
  weeklyWorkCapCUw?: number;
  cloudCU?: number;
  servingCU?: number;
}

export interface BatchPlanningCapacity {
  cloudCU: number;
  ownedCU: number;
  servingCU: number;
  developmentCU: number;
  researchCU: number;
  cloudRentCentsPerWeek: number;
}

export interface BatchPlacementPoolOption {
  poolId: string;
  poolName: string;
  ownership: 'auto' | 'cloud' | 'owned' | 'unavailable';
  compatible: boolean;
  reason: string | null;
  nominalCU: number;
  capacityCU: number;
  memoryMU: number;
  servingMultiplierBps: number | null;
  variableCentsPerCUw: number | null;
}

export interface BatchPlacementForecastRow {
  week: number;
  paused: boolean;
  requestedWorkCUw: number;
  effectiveWorkCUw: number;
  physicalWorkCUw: number;
  completedRequests: number;
  cumulativeRequests: number;
  cumulativeWorkCUw: number;
  actualPoolId: string | null;
  actualPoolName: string | null;
  staffRequested: number;
  staffGranted: number;
  memoryMU: number;
  bottleneck: string;
  ownedVariableCents: number;
  cloudWorkRentCents: number;
}

export interface BatchPlacementScenario {
  poolId: string;
  poolName: string;
  compatible: boolean;
  reason: string | null;
  rows: BatchPlacementForecastRow[];
  completionWeek: number | null;
  completedRequests: number;
  remainingRequests: number;
  projectedInvoiceCents: number;
  projectedCreditsCents: number;
  effectiveWorkCUw: number;
  physicalWorkCUw: number;
  commercialStaffWeeks: number;
  /** Estimate of this job's future owned-GPU physical usage, excluding previous work. */
  ownedVariableCents: number;
  /** Attribution of this job's future work to cloud rent; this is not an added bill. */
  cloudWorkRentCents: number;
  /** Full increase in company cloud rent over the fixed comparison horizon, even if this job ends sooner. */
  additionalCloudReservationCents: number;
}

export interface BatchPlacementForecast {
  available: boolean;
  reason: string | null;
  sourceWeek: number;
  startWeek: number;
  horizonWeeks: number;
  jobId: string | null;
  jobName: string;
  deadlineWeek: number | null;
  requiredWorkCUw: number;
  completedWorkCUw: number;
  quotedCents: number;
  currentPlacementPoolId: string;
  paused: boolean;
  currentCapacity: BatchPlanningCapacity;
  selectedCapacity: BatchPlanningCapacity;
  capacityPlanValid: boolean;
  capacityPlanReason: string | null;
  poolOptions: BatchPlacementPoolOption[];
  scenarios: BatchPlacementScenario[];
  assumptions: readonly string[];
}
