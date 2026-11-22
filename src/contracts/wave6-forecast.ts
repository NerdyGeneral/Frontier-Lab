import type { StaffRole, SystemRollout, WorkRequest } from './types';

export interface CapacityForecastOptions {
  baseGrowthBps?: number;
  stressGrowthBps?: number;
}

export interface ForecastStaffRequirement {
  role: StaffRole;
  requiredFte: number;
  grantedFte: number;
  shortfallFte: number;
}

export interface ForecastRequestFit {
  requestId: string;
  label: string;
  requestedWorkCUw: number;
  grantedWorkCUw: number;
  physicalWorkCUw: number;
  requestedMemoryMU: number;
  grantedMemoryMU: number;
  largestCompatiblePoolMU: number;
  poolName: string | null;
  fits: boolean;
  reason: string;
}

export interface ForecastCloudPlan {
  additionalCU: number | null;
  additionalRentCents: number | null;
  totalCloudCU: number | null;
  servingAllocationCU: number | null;
  usesSpareAllocation: boolean;
  reason: string;
}

export interface CapacityForecastRow {
  week: number;
  offset: number;
  paidAccounts: number;
  trialAccounts: number;
  privateCommitments: number;
  licenseCommitments: number;
  requestedWorkCUw: number;
  publicWorkCUw: number;
  privateWorkCUw: number;
  requestedMemoryMU: number;
  physicalWorkCUw: number;
  reservedPhysicalCU: number;
  headroomCU: number;
  servingAllocationCU: number;
  grantedWorkCUw: number;
  weakestCapacityBps: number;
  computeFits: boolean;
  staffFits: boolean;
  fits: boolean;
  ownedServiceWorkCents: number;
  staff: ForecastStaffRequirement[];
  requests: ForecastRequestFit[];
  bottlenecks: string[];
  cloudPlan: ForecastCloudPlan;
}

export interface CapacityForecastScenario {
  id: 'base' | 'stress';
  name: string;
  growthBps: number;
  rows: CapacityForecastRow[];
  firstPressureWeek: number | null;
  peakAdditionalCloudCU: number | null;
}

export interface CapacityForecastAvailability {
  researched: boolean;
  rollout: SystemRollout | null;
  available: boolean;
}

export interface CapacityForecast extends CapacityForecastAvailability {
  sourceWeek: number;
  horizonWeeks: number;
  assumptions: readonly string[];
  currentCloudCU: number;
  currentCloudRentCents: number;
  developmentAllocationCU: number;
  researchAllocationCU: number;
  scenarios: CapacityForecastScenario[];
}

/** Exposed for focused tests and other read-only planning views. */
export interface CustomerCapacityRequestSet {
  serving: WorkRequest[];
  staffing: WorkRequest[];
  privateCommitments: number;
  licenseCommitments: number;
  paidAccounts: number;
  trialAccounts: number;
}

