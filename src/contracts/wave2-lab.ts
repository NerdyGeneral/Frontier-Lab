import type { AdvancedScores, AdvancedTrainingReceipt } from './advanced-skills';
import type { DataPacket, GameState, ModelVersion, StaffRole } from './types';
import type { JobStatus } from './wave1';
import type { DistillationTeacher, Wave4ResearchFields, Wave4TrainingFields } from './wave4-research';
import type { DataDeduplicationReceipt, TrainingDeduplicationReceipt } from './wave6-data';
import type { AdapterTrainingReceipt } from './wave7-adapters';
import type { PlannerTrait } from './wave7-agents';
import type { FeedbackDataProvenance } from './wave10-feedback-review';
import type { ModelPolicy, PolicyDataProvenance, PolicyTrainingReceipt } from './wave11-policy';
import type { TrainingReplayReceipt } from './wave15-replay';
import type { TrainingCurriculumReceipt } from './wave17-curriculum';
import type { SyntheticDataProvenance, SyntheticTrainingReceipt } from './wave26-synthetic';

export type CapabilityDomain = keyof ModelVersion['capabilityBps'];
export type CapabilityScores = ModelVersion['capabilityBps'];
export type TrainingWorkspace = 'recompute' | 'large-batch';
export type TrainingProfile = 'stable' | 'balanced' | 'ambitious';
export type EvaluationSuiteId = import('./model-challenges').ModelChallengeSuiteId | 'advanced-capabilities-1' | 'basic-conversation-1' | 'expanded-capabilities-1' | 'behavior-cases-1' | 'independent-holdouts-1' | 'policy-boundaries-1';
export interface ModelBehavior { confidentErrorBps: number; falseRefusalBps: number }
export interface DataProvenanceFields {
  synthetic?: SyntheticDataProvenance;
  policy?: PolicyDataProvenance;
  feedback?: FeedbackDataProvenance;
  deduplication?: DataDeduplicationReceipt;
  companyId?: string;
  catalogId?: string;
  sourceIds?: string[];
  parentPacketId?: string;
  revision?: number;
  behaviorUnits?: number;
  broadUnits?: number;
  purchaseFactId?: string;
  purchasedWeek?: number;
}
export interface DataCatalogItem {
  advancedCoverageBps?: AdvancedScores;
  id: string; name: string; feeCents: number; preparationStaff: number;
  rawUnits: number; qualityBps: number; coverageBps: CapabilityScores;
  behaviorUnits: number; broadUnits: number;
  rights: DataPacket['rights'];
}
export interface TrainingRecipe {
  id: string; name: string; kind: 'adaptation' | 'foundation' | 'behavior' | 'calibration' | 'distillation' | 'planning' | 'policy' | 'synthetic';
  requiredResearch?: string; family?: ModelVersion['family']; workCUw: number;
  feeCents: number; preparationStaff: number; targets: CapabilityScores;
  relevantUnits: number; minimumBroadUnits: number; reliabilityTargetBps: number;
  description: string;
}
export interface CorpusEvidence {
  sourceIds: string[]; packetIds: string[]; distinctUnits: number; broadUnits: number;
  relevantUnits: CapabilityScores; qualityBps: CapabilityScores;
  behaviorUnits: number; behaviorQualityBps: number; rights: DataPacket['rights'];
  fingerprint: string;
}
/** Immutable admission-time recipe, targets, evidence and method choices. */
export interface TrainingPlan {
  modelDesign?: import('./model-design').ModelDesignReceipt;
  advanced?: AdvancedTrainingReceipt;
  /** New foundations use only their own evidence rights. Absent on historical paid runs. */
  foundationRights?: 'independent';
  /** Frozen parent scores for a continued adaptation. Omitted on historical runs. */
  parentScores?: { capabilityBps: CapabilityScores; reliabilityBps: number };
  workspace?: TrainingWorkspace;
  synthetic?: SyntheticTrainingReceipt;
  curriculum?: TrainingCurriculumReceipt;
  replay?: TrainingReplayReceipt;
  policy?: PolicyTrainingReceipt;
  inheritedPolicy?: ModelPolicy;
  deduplication?: TrainingDeduplicationReceipt;
  adapter?: AdapterTrainingReceipt;
  planner?: PlannerTrait;
  recipeName: string; kind: TrainingRecipe['kind']; profile: TrainingProfile; profileApplied: boolean;
  family: ModelVersion['family']; architecture: 'dense' | 'sparse'; residentMU: number; teacher?: DistillationTeacher;
  lineageId: string; identity: string; corpus: CorpusEvidence;
  targets: CapabilityScores; ceilings: CapabilityScores; savedAdjustments: CapabilityScores;
  requiredEvidence: number; reliabilityTargetBps: number;
  behaviorAnchor: ModelBehavior; behaviorTarget: ModelBehavior;
  preparationRequired: number; checkpointOverheadRequired: number;
  checkpoints: { atBps: number; overheadWork: number }[];
  methods: string[]; foundationAnchor: CapabilityScores;
}
export interface Wave2TrainingFields extends Wave4TrainingFields {
  plan?: TrainingPlan;
  preparationCompleted?: number;
  checkpointOverheadCompleted?: number;
  checkpointModelIds?: string[];
}
export interface EvaluationOutcome {
  usefulAnswers: number; confidentErrors: number; falseRefusals: number;
  clarifications: number; correctPolicyRefusals: number; eligibleCases: number;
}
export type BehaviorCaseOutcome = 'useful' | 'confident-error' | 'false-refusal' | 'clarification' | 'correct-policy-refusal';
export interface ResearchProject {
  id: string; companyId: string; researchId: string; startedWeek: number;
  requiredWork: number; completedWork: number; requiredStaff: number; completedStaff: number;
  role: StaffRole; status: JobStatus; lastProgress: number; lastBottleneck: string;
  completedWeek?: number; availableWeek?: number; assistanceStaff?: number;
}
export interface ResearchSlice extends Wave4ResearchFields {
  modelResearch?: Record<string, import('./model-research').ModelResearchProject>;
  completed: string[]; active: string[];
  completedByCompany: Record<string, string[]>;
  projects: Record<string, ResearchProject>;
}
export interface ResearchViewItem {
  id: string; name: string; description: string; parentId?: string;
  implemented: boolean; status: 'planned' | 'locked' | 'available' | 'running' | 'paused' | 'pending' | 'complete';
  prerequisiteNames: string[]; missingPrerequisites: string[];
  feeCents: number; requiredWork: number; requiredStaff: number; role: StaffRole;
  progressBps: number; project: ResearchProject | null;
}
export type Wave2LabCommand =
  | { kind: 'buy_data'; catalogId: string }
  | { kind: 'curate_data'; packetId: string }
  | { kind: 'deduplicate_data'; packetId: string }
  | { kind: 'start_research'; researchId: string }
  | { kind: 'set_research_paused'; projectId: string; paused: boolean };

/** This type-only import keeps selector signatures easy to discover for UI clients. */
export type ResearchState = Readonly<GameState>;
