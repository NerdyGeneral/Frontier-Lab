/** Wave 4 silicon and interconnect. Money is cents; CU/CUw/MU/staff use 1e9. */
export type ChipFoundry = 'standard' | 'express' | 'high-yield';
export type HardwareBuyerId = 'relay-edge' | 'vesper-systems' | 'summit-research';

export type ChipArchitecture = 'dense' | 'sparse';
export type ChipTarget = 'inference' | 'training';
export type ChipMemory = 'balanced' | 'wide';
export interface ChipSpecification { architecture: ChipArchitecture; target: ChipTarget; memory: ChipMemory }
export type ChipSuccessorImprovement = 'memory' | 'throughput';
export interface ChipSuccessor {
  generation: 2; parentDesignId: string; parentFingerprint: string; improvement: ChipSuccessorImprovement;
}
export interface ChipStageGrantProof {
  firstWeek: number | null; grantWeeks: number;
  physicalWorkCUw: number;
  workReceipts: Record<string, { poolId: string; hardwareId: string; ownership: 'cloud' | 'owned'; crossRack: boolean;
    specializationId: string | null; baseMultiplierBps: number; multiplierBps: number;
    effectiveCUw: number; physicalCUw: number; conversionRemainder: number; grants: number; firstWeek: number; lastWeek: number }>;
  hardwareGrantWeeks: number; mlGrantWeeks: number;
  latest: { week: number; remainingWorkCUw: number; remainingHardwareStaff: number; remainingMlStaff: number;
    hardwareStaff: number; mlStaff: number; effectiveCUw: number; physicalCUw: number; memoryMU: number; poolId: string | null; receiptKey: string | null } | null;
}

export type Wave4HardwareCommand =
  | { kind: 'start_chip_design'; name: string; spec: ChipSpecification }
  | { kind: 'start_chip_successor'; parentDesignId: string; name: string; improvement: ChipSuccessorImprovement }
  | { kind: 'start_chip_prototype'; designId: string; modelId: string }
  | { kind: 'set_chip_project_paused'; designId: string; paused: boolean }
  | { kind: 'order_chip_batch'; designId: string; racks: 1 | 2 | 4; location: string; foundry?: ChipFoundry }
  | { kind: 'accept_hardware_order'; buyerId: HardwareBuyerId; designId: string; foundry: ChipFoundry }
  | { kind: 'install_fast_fabric'; location: string }
  | { kind: 'set_fabric_paused'; fabricId: string; paused: boolean };

export interface ChipWorkMeters {
  /** Gen2 only: actual shared-allocator work and staff evidence, independent of its parent. */
  grantProof?: ChipStageGrantProof;
  startedWeek: number;
  requiredWorkCUw: number; completedWorkCUw: number;
  requiredHardwareStaff: number; completedHardwareStaff: number;
  requiredMlStaff: number; completedMlStaff: number;
  completedWeek: number | null; readyWeek: number | null;
  lastProgress: number; lastBottleneck: string;
}

export interface ChipPrototype extends ChipWorkMeters {
  /** Gen2 only: exact evaluated model/runtime identity at new prototype funding. */
  modelFingerprint?: string;
  modelId: string; reportId: string;
  modelArchitecture: ChipArchitecture;
  modelFamily: import('./model-design').ModelFamily;
  modelMemoryMU: number;
  feeCents: number; paymentId: string;
}

export interface ChipDesign {
  /** Absent on original designs; one separately funded successor is allowed per Gen1 parent. */
  successor?: ChipSuccessor;
  id: string; companyId: string; name: string; spec: ChipSpecification;
  status: 'designing' | 'design-ready' | 'prototyping' | 'validated';
  paused: boolean;
  designFeeCents: number; designPaymentId: string;
  design: ChipWorkMeters;
  prototypeRun: ChipPrototype | null;
  /** A measured production yield. Frozen after prototype validation. */
  qualifiedYieldBps: number | null;
}

export interface ChipBatch {
  id: string; companyId: string; designId: string; location: string;
  racks: 1 | 2 | 4; rackIds: string[]; foundry?: ChipFoundry;
  attemptedCU: number; usableCU: number; yieldBps: number;
  orderedWeek: number; arrivalWeek: number; deliveredWeek: number | null;
  status: 'fabricating' | 'delivered';
  purchaseCents: number; paymentId: string;
}

export interface HardwareSale {
  buyerId: HardwareBuyerId; companyId: string; designId: string; foundry: ChipFoundry;
  orderedWeek: number; arrivalWeek: number; shippedWeek: number | null;
}

export interface FastFabricProject {
  id: string; companyId: string; location: string;
  status: 'installing' | 'ready' | 'active'; paused: boolean;
  startedWeek: number; requiredWeeks: number; elapsedWeeks: number;
  requiredStaff: number; completedStaff: number;
  requiredWorkCUw: number; completedWorkCUw: number;
  completedWeek: number | null; readyWeek: number | null;
  purchaseCents: number; paymentId: string;
  lastBottleneck: string;
}

export interface ServingHistoryWeek {
  week: number;
  publicPhysicalCUw: number;
  privatePhysicalCUw: number;
  agentPhysicalCUw: number;
}

export interface Wave4HardwareFields {
  chipDesigns: Record<string, ChipDesign>;
  chipBatches: Record<string, ChipBatch>;
  hardwareSales?: Partial<Record<HardwareBuyerId, HardwareSale>>;
  fabricProjects: Record<string, FastFabricProject>;
  /** Last eight distinct weeks with real customer-serving work. */
  servingHistory: Record<string, ServingHistoryWeek[]>;
}

export interface WorkloadCompatibility {
  modelArchitecture?: ChipArchitecture;
  modelFamily?: import('./model-design').ModelFamily;
  workloadKind?: 'inference' | 'training' | 'general';
  requiresFastFabric?: boolean;
}

export interface ChipForecast {
  utilizationBps: number;
  usefulCU: number; weeklyEffectiveWorkCUw: number;
  entryAndProductionCents: number;
  equivalentCloudCentsPerWeek: number;
  ownedVariableCentsPerWeek: number;
  ownedFixedAndStaffCentsPerWeek: number;
  weeklySavingsCents: number;
  simplePaybackWeeks: number | null;
  assumptions: string[];
}
