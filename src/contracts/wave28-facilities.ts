import type { ComputePool, WorkRequest } from './types';

/** A site profile changes one real connected pool's operating tradeoffs. */
export type FacilityProfile = 'serving' | 'training';
export type Wave28FacilityCommand =
  | { kind: 'start_facility_specialization'; facilityId: string; profile: FacilityProfile }
  | { kind: 'set_facility_specialization_paused'; specializationId: string; paused: boolean };

export interface FacilityProfileEffects {
  trainingCapacityBps: number;
  servingCapacityBps: number;
  crossRackTrainingBps: number;
  servingVariableCostBps: number;
}
export interface FacilityProfileDefinition extends FacilityProfileEffects {
  profile: FacilityProfile; name: string; benefit: string; tradeoff: string;
  purchaseCents: number; requiredWeeks: number; requiredStaff: number; requiredWork: number; requiredMemory: number;
}
/** Frozen with historical cost pools; a later paid switch cannot rewrite it. */
export interface FacilityPoolSpecialization extends FacilityProfileEffects {
  id: string; profile: FacilityProfile; activatedWeek: number;
}
export interface FacilitySpecializationGrant {
  week: number; elapsed: boolean; requestedWork: number; requestedStaff: number;
  grantedWork: number; physicalWork: number; grantedStaff: number; requiredMemory: number; grantedMemory: number;
  /** Full grant-time pool keeps staff/power/cooling/profile evidence immutable. */
  pool: ComputePool | null;
}
export interface FacilitySpecialization {
  id: string; companyId: string; facilityId: string; profile: FacilityProfile;
  startCommandId: string; paymentId: string; purchaseCents: number; previousProfileId: string | null;
  status: 'building' | 'ready' | 'active' | 'retired'; paused: boolean;
  startedWeek: number; requiredWeeks: number; elapsedWeeks: number;
  requiredStaff: number; completedStaff: number; requiredWork: number; completedWork: number; physicalWork: number; requiredMemory: number;
  completedWeek: number | null; readyWeek: number | null; activatedWeek: number | null; retiredWeek: number | null;
  grants: FacilitySpecializationGrant[];
  lastProgress: number; lastBottleneck: string;
}
export interface Wave28FacilityFields { facilitySpecializations?: Record<string, FacilitySpecialization> }

export interface FacilitySpecializationPoolView {
  id: string; name: string; hardwareId: string; nominalCU: number; capacityCU: number; memoryMU: number; rackCount: number;
  servingCapacityCU: number; trainingCapacityCU: number;
  baseVariableCentsPerCUw: number; servingVariableCentsPerCUw: number;
  /** Conversion for an explicit compatible cross-rack training request. */
  crossRackTrainingMultiplierBps: number;
  staffCoverageBps: number; powerCoverageBps: number; coolingCoverageBps: number;
  fastFabric: boolean; bottleneck: string;
  supportsServing: boolean; supportsTraining: boolean;
  architectures: ('dense' | 'sparse')[]; workloads: ('inference' | 'training' | 'general')[];
}
export interface FacilitySpecializationSiteView {
  id: string; name: string; commissioned: boolean;
  active: FacilitySpecialization | null; pending: FacilitySpecialization | null; history: FacilitySpecialization[];
  installedRacks: number; parkedRacks: number;
  powerDemand: number; powerLimit: number; coolingDemand: number; coolingLimit: number;
  fixedWeeklyCents: number; requiredOperatingStaff: number;
  pools: FacilitySpecializationPoolView[];
  choices: { profile: FacilityProfile; eligible: boolean; reason: string | null;
    payload: Extract<Wave28FacilityCommand, { kind: 'start_facility_specialization' }>;
    proposedPools: FacilitySpecializationPoolView[] }[];
}
export interface FacilitySpecializationView {
  researched: boolean; researchReason: string | null; profiles: FacilityProfileDefinition[]; sites: FacilitySpecializationSiteView[];
}
export type FacilityWorkRequest = Pick<WorkRequest, 'category' | 'workloadKind'>;
