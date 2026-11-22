import type { CapabilityScores, ModelBehavior } from './wave2-lab';
import type { AgentRecovery, PlannerTrait } from './wave7-agents';

export type AgentTool = 'read_ticket' | 'search_docs' | 'send_reply' | 'issue_credit'
  | 'read_repository' | 'read_issue' | 'read_test_spec' | 'run_sandbox_tests' | 'publish_patch';
export type AgentMode = 'draft' | 'approval' | 'bounded';
export type AgentVerification = 'basic' | 'independent';
export type AgentStage = 'plan' | 'lookup' | 'draft' | 'sandbox' | 'check' | 'review' | 'action' | 'audit' | 'recover';
export type AgentJobStatus = 'running' | 'paused' | 'awaiting-approval' | 'complete' | 'failed' | 'cancelled' | 'handed-off';
export type AgentDraftOutcome = 'useful' | 'confident-error' | 'false-refusal' | 'clarification';

export interface AgentConfiguration {
  mode: AgentMode;
  verification: AgentVerification;
  tools: AgentTool[];
  maxSteps: number;
  maxRetries: number;
  /** Maximum effective CUw across every model pass, tool call, check and retry. */
  workBudget: number;
}
export type Wave3AgentCommand =
  | ({ kind: 'start_agent_job'; orderId: string; modelId: string } & AgentConfiguration)
  | { kind: 'set_agent_job_paused'; jobId: string; paused: boolean }
  | { kind: 'review_agent_job'; jobId: string; decision: 'approve' | 'reject' }
  | { kind: 'recover_agent_job'; jobId: string; maxSteps: number; workBudget: number }
  | { kind: 'cancel_agent_job'; jobId: string };

export interface AgentOrderDefinition {
  id: string; name: string; description: string; caseCount: number;
  setupCents: number; draftFeeCents: number; outcomeFeeCents: number; failurePenaltyCents: number;
  minConversationBps: number; minDocumentsBps: number; minToolsBps: number;
  coding?: { minCodingBps: number; minReliabilityBps: number };
  difficultyBps: number; readTools: AgentTool[]; actionTool: AgentTool;
}
export interface AgentOrderView extends AgentOrderDefinition {
  templateId: string; cycle: number; availableWeek: number; expiresWeek: number; claimed: boolean;
}
export interface AgentModelSnapshot {
  planner?: PlannerTrait;
  id: string; name: string; family: import('./model-design').ModelFamily; residentMU: number; architecture?: 'dense' | 'sparse'; workBps?: number;
  capabilityBps: CapabilityScores; reliabilityBps: number; behavior: ModelBehavior; reportId: string;
}
export interface AgentStageRecord {
  index: number; stage: AgentStage; attempt: number; tool: AgentTool | null;
  startedWeek: number; completedWeek: number; work: number; physicalWork: number; staff: number;
  inputTokens: number; outputTokens: number; calls: number; note: string;
}
export interface AgentJob {
  recovery?: AgentRecovery; handedOffTo?: string;
  id: string; companyId: string; orderId: string; templateId: string; cycle: number;
  acceptedWeek: number; completedWeek: number | null; configuration: AgentConfiguration;
  model: AgentModelSnapshot; terms: AgentOrderDefinition; evidenceKey: string;
  status: AgentJobStatus; stage: AgentStage; stageStartedWeek: number;
  stageWork: number; stagePhysicalWork: number; stageStaff: number;
  steps: number; retries: number; attempt: number; lookupIndex: number; plannedTools: AgentTool[];
  spentWork: number; physicalWork: number; reviewStaff: number;
  inputTokens: number; outputTokens: number; modelCalls: number; checkerRuns: number; toolCalls: number;
  claimedComplete: boolean; draftOutcome: AgentDraftOutcome | null; checkerPassed: boolean | null;
  humanDecision: 'pending' | 'approved' | 'rejected' | null;
  deliveredDraft: boolean; actionApplied: boolean; actualSuccess: boolean | null; verifiedOutcome: boolean;
  permissionBlocks: number; receiptId: string | null; invoiceId: string | null;
  billedCents: number; penaltyCents: number; lastBottleneck: string; history: AgentStageRecord[];
}
export interface AgentActionReceipt {
  id: string; jobId: string; companyId: string; orderId: string; tool: AgentTool;
  week: number; caseCount: number; correct: boolean; authorizedBy: 'human' | 'bounded-policy';
}
export interface AgentInvoice {
  id: string; jobId: string; companyId: string; week: number;
  basis: 'reviewed-draft' | 'verified-outcome'; amountCents: number; caseCount: number;
}
export interface AgentCompanyTotals {
  accepted: number; complete: number; failed: number; deliveredDrafts: number; verifiedOutcomes: number;
  revenueCents: number; penaltyCents: number;
}
export interface AgentSlice {
  activeJobIds: string[];
  jobs: Record<string, AgentJob>;
  actionReceipts: Record<string, AgentActionReceipt>;
  invoices: AgentInvoice[];
  /** Latest accepted four-week intake per company/template; older intakes cannot reopen. */
  claims: Record<string, number>;
  totalsByCompany: Record<string, AgentCompanyTotals>;
}
export interface AgentJobView {
  job: AgentJob; title: string; stageLabel: string; progressBps: number;
  stageRequiredWork: number; stageRequiredStaff: number; stageMemory: number;
  expectedBillCents: number; billingLabel: string;
  canReview: boolean; canPause: boolean; canCancel: boolean;
}
export interface AgentView {
  unlocked: boolean; independentUnlocked: boolean; boundedUnlocked: boolean;
  nextCycleWeek: number; orders: AgentOrderView[]; codingOrders: AgentOrderView[];
  models: Pick<AgentModelSnapshot, 'id' | 'name' | 'family' | 'residentMU' | 'capabilityBps' | 'reliabilityBps' | 'workBps'>[];
  jobs: AgentJobView[]; invoices: AgentInvoice[];
  /** Actual correctness is customer evidence only after the paid post-action audit. */
  receipts: (Omit<AgentActionReceipt, 'correct'> & { correct: boolean | null })[];
  totals: AgentCompanyTotals;
}
