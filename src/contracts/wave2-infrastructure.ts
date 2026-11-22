import type { FacilityPoolSpecialization } from './wave28-facilities';

/** Wave 2 infrastructure contracts. Resource quantities use 1e9; money uses cents. */
export type InfrastructureCommandPayload =
  | { kind: 'order_rack'; hardwareId: string; location: string }
  | { kind: 'install_rack'; rackId: string }
  | { kind: 'set_rack_parked'; rackId: string; parked: boolean }
  | { kind: 'start_facility' }
  | { kind: 'fund_facility_stage'; facilityId: string }
  | { kind: 'set_facility_paused'; facilityId: string; paused: boolean };

export interface HardwareRack {
  id: string;
  companyId: string;
  hardwareId: string;
  /** 'colocation' or an owned facility ID. */
  location: string;
  /** Original delivery destination, captured on the first paid relocation. */
  purchaseLocation?: string;
  status: 'ordered' | 'inventory' | 'installing' | 'installed' | 'parked';
  orderedWeek: number;
  arrivalWeek: number;
  installationStartedWeek: number | null;
  completedInstallStaff: number;
  readyWeek: number | null;
  installedWeek: number | null;
  purchaseCents: number;
  lastBottleneck: string;
  /** Custom production still occupies one eight-slot rack; yield limits useful CU. */
  chipDesignId?: string;
  chipBatchId?: string;
  usableCU?: number;
}

export interface FacilityStageProgress {
  paidCents: number;
  paymentId: string | null;
  startedWeek: number | null;
  elapsedWeeks: number;
  completedStaff: number;
  completedWeek: number | null;
}

export interface FacilityProject {
  id: string;
  companyId: string;
  name: string;
  status: 'building' | 'commissioning' | 'active';
  paused: boolean;
  stageIndex: number;
  stages: FacilityStageProgress[];
  startedWeek: number;
  readyWeek: number | null;
  lastBottleneck: string;
}

export interface InfrastructureSliceFields {
  racks: Record<string, HardwareRack>;
  facilities: Record<string, FacilityProject>;
}

export interface ComputeInfrastructureFields {
  /** Fractional cents from actual owned work, denominator 1e9. */
  variableCostCarry: number;
}

export interface FacilityStageDefinition {
  id: string;
  name: string;
  costCents: number;
  elapsedWeeks: number;
  staffWeeks: number;
}

export interface InfrastructureContent {
  rackCU: number;
  deliveryWeeks: number;
  installationStaffWeeks: number;
  maxRacksPerCompany: number;
  maxFacilitiesPerCompany: number;
  colocationCentsPerRackWeek: number;
  colocationStaffPerRack: number;
  ownedMaintenanceCentsPerCUWeek: number;
  siteFixedCentsPerWeek: number;
  siteBaseStaff: number;
  siteStaffPer16CU: number;
  siteSlotsCU: number;
  sitePowerUnits: number;
  siteCoolingUnits: number;
  crossRackTrainingBps: number;
  stages: FacilityStageDefinition[];
}

export interface ComputePool {
  id: string;
  companyId: string;
  name: string;
  ownership: 'cloud' | 'owned';
  location: string;
  hardwareId: string;
  nominalCU: number;
  capacityCU: number;
  memoryMU: number;
  rackCount: number;
  singleRackCU: number;
  singleRackMemoryMU: number;
  trainingBps: number;
  servingBps: number;
  variableCentsPerCUw: number;
  staffCoverageBps: number;
  powerCoverageBps: number;
  coolingCoverageBps: number;
  bottleneck: string;
  /** Optional fields keep standard historical pools compatible with old snapshots. */
  fastFabric?: boolean;
  architectures?: readonly ('dense' | 'sparse')[];
  workloads?: readonly ('inference' | 'training' | 'general')[];
  specialization?: FacilityPoolSpecialization;
}
