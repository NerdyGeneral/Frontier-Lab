import type { CapabilityDomain, CapabilityScores, ModelBehavior } from './wave2-lab';
import type { JobStatus } from './wave1';

export type ModelVariantKind = 'compression' | 'memory-format';
export type ProductEfficiencyKind = 'routing' | 'prefix-cache' | 'evidence-links';
export type SystemRolloutKind = 'run-supervisor' | 'research-assistant' | 'deduplication' | 'capacity-forecast' | 'adapter-bank' | 'action-receipts' | 'cost-accounting';

/** Immutable deployment derivative. It never inherits the source's evaluation. */
export interface ModelRuntimeVariant {
  kind: ModelVariantKind;
  applicationId: string;
  sourceModelId: string;
  servingWorkBps: number;
}
export interface ModelApplicationRun {
  id: string; companyId: string; sourceModelId: string; outputModelId: string;
  variant: ModelVariantKind; startedWeek: number;
  requiredWork: number; completedWork: number; physicalWork: number;
  requiredStaff: number; completedStaff: number;
  status: JobStatus; lastProgress: number; lastBottleneck: string; completedWeek?: number;
}
export interface Wave4ModelFields { applicationRuns: Record<string, ModelApplicationRun> }

export interface DistillationTeacher {
  modelId: string; domain: CapabilityDomain; scoreBps: number; studentAnchorBps: number;
  requiredWork: number; residentMU: number;
  rights: { hosted: boolean; weights: boolean };
}
export interface Wave4TrainingFields { teacherWorkCompleted?: number; teacherPhysicalWork?: number }

export interface ProductEfficiencyInstall {
  id: string; companyId: string; productId: string; kind: ProductEfficiencyKind;
  modelId: string; secondaryModelId?: string;
  /** New routes mix all seven skills. Omitted historical routes retain their saved rules. */
  routingProtocol?: 2;
  /** Evidence checks capture their installed retrieval index and immutable packet. */
  retrievalId?: string; evidencePacketId?: string;
  startedWeek: number; requiredWork: number; completedWork: number;
  requiredStaff: number; completedStaff: number;
  status: 'building' | 'ready' | 'active'; readyWeek: number | null;
  enabled: boolean; lastBottleneck: string;
  /** Cache identity is company/product/model/features/evidence scoped, with finite lifetime. */
  cacheKey?: string; warmedWeek?: number; lastServedWeek?: number;
}
export interface Wave4ProductFields { efficiencyInstalls: Record<string, ProductEfficiencyInstall> }

export interface SystemRollout {
  id: string; companyId: string; method: SystemRolloutKind;
  startedWeek: number; requiredWork: number; completedWork: number;
  requiredStaff: number; completedStaff: number;
  status: 'building' | 'ready' | 'active'; readyWeek: number | null; lastBottleneck: string;
}
export interface ResearchAssistant {
  companyId: string; modelId: string; enabled: boolean; maxAssistedFte: number;
  lastWeek: number; requestedWork: number; executedWork: number; physicalWork: number;
  reviewStaff: number; assistedStaff: number; bonusStaff: number; lastBottleneck: string;
}
export interface Wave4ResearchFields {
  systemRollouts: Record<string, SystemRollout>;
  assistantsByCompany: Record<string, ResearchAssistant>;
}
export type Wave4ResearchCommand =
  | { kind: 'create_model_variant'; modelId: string; variant: ModelVariantKind }
  | { kind: 'install_product_efficiency'; productId: string; method: ProductEfficiencyKind; secondaryModelId?: string }
  | { kind: 'set_product_efficiency_enabled'; productId: string; method: ProductEfficiencyKind; enabled: boolean }
  | { kind: 'start_system_rollout'; method: SystemRolloutKind }
  | { kind: 'configure_research_assistant'; modelId: string; maxAssistedFte: number; enabled: boolean };

export interface AppliedResearchView {
  applications: ModelApplicationRun[];
  variants: { id: string; name: string; kind: ModelVariantKind; sourceName: string; servingWorkBps: number; residentMU: number; evaluated: boolean }[];
  rollouts: SystemRollout[];
  assistant: ResearchAssistant | null;
  available: { compression: boolean; memoryFormat: boolean; routing: boolean; prefixCache: boolean; supervisor: boolean; assistant: boolean; distillation: boolean; sparse: boolean; deduplication: boolean; evidenceLinks: boolean; capacityForecast: boolean; adapterBank: boolean; actionReceipts: boolean; independentHoldouts: boolean; budgetedPlanner: boolean };
  teachers: { id: string; name: string; capabilityBps: CapabilityScores; reliabilityBps: number; transferRights: boolean }[];
}
export interface ProductEfficiencyView {
  routing: ProductEfficiencyInstall | null; prefixCache: ProductEfficiencyInstall | null;
  routingActive: boolean; cacheActive: boolean; cacheWarm: boolean;
  additionalMemoryMU: number; easyShareBps: number; cachedInputShareBps: number;
  effectiveScores: CapabilityScores; effectiveReliabilityBps: number; effectiveBehavior: ModelBehavior;
  summary: string;
}
