import type { AdvancedScores } from './advanced-skills';
import type { Wave18SessionCommand } from './wave18-sessions';
import type { ApplyStudioPlanCommand } from './wave25-studio';
import type { SyntheticCommand } from './wave26-synthetic';
import type { Wave28FacilityCommand, Wave28FacilityFields } from './wave28-facilities';
import type { CanaryCommand } from './wave27-canary';
import type { Wave27ApplianceCommand } from './wave27-appliance';
import type { InfrastructureCommandPayload, InfrastructureSliceFields, ComputeInfrastructureFields, InfrastructureContent } from './wave2-infrastructure';
/** Shared simulation contracts. All stored money is cents; CU/CUw/MU use 1e9. */
import type { CommandQuote, ComputeWave1Fields, DataSlice, FirstSaleContent, MarketsSlice, ModelSlice, ModelWave1Fields, ProductsSlice, RoleAllocation, StaffSpecialty, WorkforceFields } from './wave1';
import type { CapabilityScores, DataProvenanceFields, EvaluationSuiteId, ModelBehavior, ResearchSlice, TrainingProfile, TrainingWorkspace, Wave2LabCommand } from './wave2-lab';
import type { PlannedCommand, ProductFeatures, ProductKind, Wave2ProductCommand } from './wave2-market';
import type { AgentSlice, Wave3AgentCommand } from './wave3-agents';
import type { Wave3CommerceCommand } from './wave3-commerce';
import type { Wave4HardwareCommand, Wave4HardwareFields, WorkloadCompatibility } from './wave4-hardware';
import type { ModelRuntimeVariant, Wave4ResearchCommand } from './wave4-research';
import type { Wave4CampaignFields } from './wave4-campaign';
import type { PlannerTrait } from './wave7-agents';
import type { SharedAdapterMemory } from './wave7-adapters';
import type { ModelPolicy } from './wave11-policy';
import type { FacilityRetrofitCommand, FacilityRetrofitSliceFields } from './wave8-retrofits';
import type { RackRelocationCommand, RackRelocationSliceFields } from './wave8-relocation';
import type { Wave8ComputeCostFields } from './wave8-costs';
import type { Wave9RehearsalCommand } from './wave9-rehearsals';
import type { PreparedReleaseCommand } from './wave9-releases';
import type { FeedbackCommand } from './wave10-feedback';
import type { Wave10FeedbackReviewCommand } from './wave10-feedback-review';
import type { RuntimeGuardrailCommand } from './wave12-guardrails';
import type { AssuranceCommand } from './wave13-assurance';
import type { BatchCommand } from './wave14-batch';
import type { ReplayTrainingChoice } from './wave15-replay';
import type { TrainingCurriculumChoice } from './wave17-curriculum';
export * from './wave1';
export * from './wave2-lab';
export * from './wave2-market';
export * from './wave2-infrastructure';
export * from './wave3-agents';
export * from './wave3-commerce';
export * from './wave4-hardware';
export * from './wave4-research';
export * from './wave4-campaign';
export const RESOURCE_SCALE = 1_000_000_000;
export const SCORE_SCALE = 100;
export const SCHEMA_VERSION = 5;
export type CompanyId = string;
export type ResourceUnits = number;
export type MoneyCents = number;
export type StaffRole = 'research' | 'ml' | 'data' | 'infrastructure' | 'commercial' | 'hardware';
export type Phase = 'commit' | 'reserve' | 'execute' | 'resolve' | 'settle' | 'market' | 'plan';
export const PHASES: readonly Phase[] = ['commit', 'reserve', 'execute', 'resolve', 'settle', 'market', 'plan'];
export type WorkCategory = 'serving' | 'development' | 'research';
export type ReasonCode = 'INVALID_COMMAND' | 'INVALID_NAME' | 'INVALID_ALLOCATION' | 'CAPACITY_EXCEEDED' | 'UNKNOWN_COMPANY' | 'DUPLICATE_COMMAND' | 'INVALID_STATE' | 'INVALID_CONTENT' | 'INVALID_VERSION' | 'INSUFFICIENT_FUNDS' | 'ARREARS' | 'QUEUE_FULL' | 'FOREIGN_SLICE_WRITE' | 'DUPLICATE_MODULE' | 'INVALID_FACT' | 'INVARIANT_FAILED' | 'NOT_READY' | 'MISSING_STAFF' | 'MISSING_MEMORY' | 'ALREADY_ACTIVE' | 'NO_IMPROVEMENT';
export interface Rejection { code: ReasonCode; message: string }
export type CommandPayload =
  | import('./systems-briefs').SystemsBriefCommand
  | import('./development-plans').DevelopmentPlanCommand
  | import('./strategic-variety').StrategicVarietyCommand
  | import('./model-research').ModelResearchCommand
  | import('./customer-briefs').CustomerBriefCommand
  | Wave28FacilityCommand
  | CanaryCommand
  | Wave27ApplianceCommand
  | SyntheticCommand
  | ApplyStudioPlanCommand
  | Wave18SessionCommand
  | { kind: 'set_batch_capacity'; cloudCU: number; servingCU: number }
  | BatchCommand
  | AssuranceCommand
  | RuntimeGuardrailCommand
  | FeedbackCommand
  | Wave10FeedbackReviewCommand
  | Wave9RehearsalCommand
  | PreparedReleaseCommand
  | FacilityRetrofitCommand
  | RackRelocationCommand
  | Wave4HardwareCommand
  | Wave4ResearchCommand
  | Wave3AgentCommand
  | Wave3CommerceCommand
  | InfrastructureCommandPayload
  | Wave2LabCommand
  | Wave2ProductCommand
  | { kind: 'rename_company'; name: string }
  | { kind: 'allocate_compute'; serving: ResourceUnits; development: ResourceUnits; research: ResourceUnits }
  | { kind: 'hire_staff'; role: StaffRole }
  | { kind: 'specialize_staff'; staffId: string; specialty: StaffSpecialty }
  | { kind: 'dismiss_staff'; staffId: string }
  | { kind: 'assign_founder'; allocations: RoleAllocation }
  | { kind: 'set_staff_allocation'; staffId: string; fte: ResourceUnits }
  | { kind: 'set_cloud_capacity'; cu: ResourceUnits }
  | { kind: 'prepare_data'; packetId: string }
  | { kind: 'start_training'; modelDesign?: import('./model-design').ModelDesignSpec; baseModelId: string; packetId: string; recipeId?: string; packetIds?: string[]; profile?: TrainingProfile; workspace?: TrainingWorkspace; continueFromParent?: true; automatedCheckpoints?: boolean; teacherModelId?: string; teacherDomain?: keyof CapabilityScores; architecture?: 'dense' | 'sparse'; asAdapter?: boolean; replay?: ReplayTrainingChoice; curriculum?: TrainingCurriculumChoice }
  | { kind: 'evaluate_model'; modelId: string; suiteId?: EvaluationSuiteId }
  | { kind: 'set_job_paused'; jobId: string; paused: boolean }
  | { kind: 'deploy_product'; modelId: string; priceCents: number; allowance: number; productKind?: ProductKind; features?: ProductFeatures }
  | { kind: 'set_product_terms'; productId: string; priceCents: number; allowance: number }
  | { kind: 'set_product_paused'; productId: string; paused: boolean };
export interface GameCommand { id: string; companyId: CompanyId; issuedForWeek: number; payload: CommandPayload; reservedCents?: number }
export interface CommandReceipt { id: string; week: number; status: 'accepted' | 'rejected'; reason?: Rejection }
export interface Allocation { serving: ResourceUnits; development: ResourceUnits; research: ResourceUnits }
export interface CompanyRecord { id: string; name: string; cashCents: MoneyCents; arrearsCents: MoneyCents; founderOwnershipBps: number; founderFte: ResourceUnits; activeStaff: number; earnedRevenueCents: MoneyCents; totalOperatingExpenseCents: MoneyCents; lastWeek: { revenueCents: number; operatingExpenseCents: number; cashChangeCents: number } }
export interface LedgerFact { id: string; companyId: string; week: number; sourceId: string; category: 'rent' | 'overhead' | 'operating' | 'revenue' | 'capital' | 'financing'; amountCents: MoneyCents; label: string; kind: 'expense' | 'receipt' }
export interface LedgerEntry extends LedgerFact { paidCents: MoneyCents; unpaidCents: MoneyCents }
export interface CompanySlice extends WorkforceFields { companies: Record<string, CompanyRecord>; ledger: LedgerEntry[]; postedFacts: Record<string, true> }
export interface ComputeFleet extends ComputeWave1Fields, ComputeInfrastructureFields { companyId: string; cloudCU: ResourceUnits; ownedCU: ResourceUnits; memoryMU: ResourceUnits; occupiedMemoryMU: ResourceUnits; allocation: Allocation; lastWork: Allocation; reservedCU: ResourceUnits; deliveredEquipmentIds: string[]; inventory: Record<string, { cu: number; memoryMU: number; arrivedWeek: number }> }
export interface ComputeSlice extends Wave28FacilityFields, InfrastructureSliceFields, Wave4HardwareFields, FacilityRetrofitSliceFields, RackRelocationSliceFields, Wave8ComputeCostFields { fleets: Record<string, ComputeFleet> }
export interface ModelVersion extends ModelWave1Fields { modelDesign?: import('./model-design').ModelDesignReceipt; advancedCapabilities?: AdvancedScores; id: string; name: string; companyId: string; family: import('./model-design').ModelFamily; architecture: 'dense' | 'sparse'; status: 'checkpoint' | 'evaluated' | 'released'; capabilityBps: { conversation: number; documents: number; coding: number; tools: number }; reliabilityBps: number; residentMU: number; source: string; behavior?: ModelBehavior; foundationAnchor?: CapabilityScores; scenarioStart?: boolean; runtimeVariant?: ModelRuntimeVariant; planner?: PlannerTrait; policy?: ModelPolicy }
export interface DataPacket extends DataProvenanceFields { advancedCoverageBps?: AdvancedScores; id: string; name: string; rawUnits: number; readyUnits: number; qualityBps: number; coverageBps: { conversation: number; documents: number; coding: number; tools: number }; rights: { hosted: boolean; weights: boolean; feedback: boolean }; prepared: boolean }
export interface DomainSlices {
  company: CompanySlice;
  compute: ComputeSlice;
  models: ModelSlice;
  data: DataSlice;
  research: ResearchSlice;
  products: ProductsSlice;
  markets: MarketsSlice;
  agents: AgentSlice;
  campaign: Wave4CampaignFields & { milestones: string[]; endingStreaks: { frontier: number; platform: number; specialist: number } };
}
export type SliceKey = keyof DomainSlices;
export interface StaffDemand { role: StaffRole; staffWeeks: ResourceUnits }
export interface WorkRequest extends WorkloadCompatibility { id: string; companyId: string; taskId: string; category: WorkCategory; normalizedWorkCUw: number; memoryMU: number; priority: number; staffPriority?: number; poolId: string; staffDemand?: readonly StaffDemand[]; supervision?: { role: StaffRole; workPerStaffWeek: ResourceUnits }; headroomBps?: number; sharedAdapterMemory?: SharedAdapterMemory }
export interface ResourceGrant { requestId: string; physicalCUw: number; hardwareEffectiveCUw: number; memoryMU: number; poolId: string; sharedMemoryMU?: number }
export interface StaffGrant { requestId: string; grants: readonly StaffDemand[] }
export interface ResourceFrame { requests: WorkRequest[]; computeGrants: ResourceGrant[]; staffGrants: StaffGrant[] }
export interface RandomStream { state: number; draws: number }
export interface ScheduledItem { id: string; companyId: string; dueWeek: number; kind: 'equipment_delivery' | 'model_release'; targetId: string; quantityCU?: number; memoryMU?: number }
export interface JournalEntry { id: string; week: number; category: 'system' | 'command' | 'finance' | 'delivery' | 'project' | 'market'; message: string }
export interface PhaseRecord { phase: Phase; facts: number; events: number }
export interface TickReport { week: number; phases: PhaseRecord[]; chargedCents: number; receivedCents: number; scheduledCount: number }
export interface GameState {
  schemaVersion: number; contentVersion: string; buildVersion: string;
  revision: number; week: number; nextId: number; seed: string; playerCompanyId: string;
  random: Record<string, RandomStream>;
  slices: DomainSlices;
  queuedCommands: GameCommand[]; commandReceipts: Record<string, CommandReceipt>;
  scheduled: ScheduledItem[]; journal: JournalEntry[]; lastTick: TickReport | null;
}
export interface ModuleContext { week: number; phase: Phase; content: GameContent; facts: readonly LedgerFact[]; resources: Readonly<ResourceFrame>; random: { draw: (key: string) => number } }
export interface DomainResult { updates?: Partial<DomainSlices>; facts?: LedgerFact[]; workRequests?: WorkRequest[]; computeGrants?: ResourceGrant[]; staffGrants?: StaffGrant[]; messages?: { category: JournalEntry['category']; message: string; companyId?: string; public?: boolean }[]; schedule?: ScheduledItem[]; fulfilledScheduleIds?: string[]; commands?: PlannedCommand[] }
export interface DomainModule { id: string; owns: readonly SliceKey[]; handlers: Partial<Record<Phase, (state: Readonly<GameState>, context: ModuleContext) => DomainResult>>; grantResources?: (state: Readonly<GameState>, context: ModuleContext) => DomainResult; commandKinds?: readonly CommandPayload['kind'][]; validateCommand?: (state: Readonly<GameState>, command: GameCommand, content: GameContent) => Rejection | undefined; quoteCommand?: (state: Readonly<GameState>, command: GameCommand, content: GameContent) => CommandQuote; applyCommand?: (state: Readonly<GameState>, command: GameCommand, content: GameContent) => DomainResult }
export interface ResearchDefinition { id: string; name: string; requires: string[]; feeCents: number; role: StaffRole; staffWeeks: number; workCUw: number; description: string; implemented: boolean; parentId?: string }
export interface StaffDefinition { id: StaffRole; name: string; weeklyCents: number; recruitmentCents: number; onboardingWeeks: number; availableOnResearchEntry?: string }
export interface HardwareDefinition { id: string; name: string; purchaseCentsPerCU: number; cloudCentsPerCUWeek: number; variableCentsPerCUw: number; memoryMUPerCU: number; trainingMultiplier: number; servingMultiplier: number; powerPerCU: number }
export interface GameContent {
  infrastructure: InfrastructureContent;
  version: string; buildVersion: string; title: string;
  opening: { companyId: string; companyName: string; seed: string; cashCents: number; cloudCU: number; memoryMU: number; rentCentsPerCUWeek: number; overheadCentsPerWeek: number; waitlist: number; allocation: Allocation };
  clock: { secondsPerWeek: number; speeds: readonly number[] };
  seedModel: ModelVersion; starterData: DataPacket;
  preparation: { feeCents: number; staffWeeks: number };
  firstTraining: { id: string; name: string; workCUw: number; relevantUnits: number; conversationTargetBps: number; reliabilityAnchorBps: number; reliabilityTargetBps: number };
  evaluation: { workCUw: number; researchStaffWeeks: number; cases: number };
  firstSale: FirstSaleContent;
  staff: StaffDefinition[]; hardware: HardwareDefinition[]; research: ResearchDefinition[];
  roadmap: { wave: number; title: string; description: string; status: 'complete' | 'current' | 'planned' }[];
}
export interface PreviewResult { accepted: boolean; reason?: Rejection; sourceRevision: number; summary: string; weeklyCostCents: number; upfrontCostCents: number; weeklyCostDeltaCents: number; cashAfterCommitmentsCents: number; availableCU: number; allocation?: Allocation }
export interface SubmitResult { state: GameState; accepted: boolean; commandId?: string; reason?: Rejection }
export interface TickResult { state: GameState; accepted: boolean; reason?: Rejection }
export interface DiagnosticResult { ok: boolean; checks: { name: string; passed: boolean; detail: string }[]; fingerprint: string }
