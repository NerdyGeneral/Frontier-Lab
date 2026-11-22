import type { FacilityTariffFields } from './wave28-tariffs';
import type { ProductFeatures } from './wave2-market';
import type { PolicyHoldoutCase, PolicyHoldoutTotals } from './wave11-policy';

export type RuntimeGuardrailProfile = 'balanced' | 'strict';

export type RuntimeGuardrailCommand =
  | { kind: 'install_runtime_guardrail'; productId: string; profile: RuntimeGuardrailProfile }
  | { kind: 'set_runtime_guardrail_enabled'; productId: string; enabled: boolean };

/** An exact paid model report pair, independent of mutable model display/release status. */
export interface RuntimeGuardrailModelBinding {
  modelId: string;
  modelFingerprint: string;
  capabilityReportId: string;
  policyReportId: string;
}

export interface RuntimeGuardrailBinding {
  productKind: 'basic-chat' | 'developer-api';
  primary: RuntimeGuardrailModelBinding;
  secondary: RuntimeGuardrailModelBinding | null;
  secondaryShareBps: number;
  features: ProductFeatures;
}

/** The same reserved case is observed before and after the authored runtime rule. */
export interface RuntimeGuardrailAuditCase {
  id: string;
  modelId: string;
  route: 'primary' | 'secondary';
  category: PolicyHoldoutCase['category'];
  eligibility: PolicyHoldoutCase['eligibility'];
  challenge: PolicyHoldoutCase['challenge'];
  baseline: PolicyHoldoutCase['outcome'];
  guarded: PolicyHoldoutCase['outcome'];
}

export interface RuntimeGuardrailAudit {
  protocol: 'runtime-guardrails-v1';
  evidenceKey: string;
  bindingFingerprint: string;
  profile: RuntimeGuardrailProfile;
  baseline: PolicyHoldoutTotals;
  guarded: PolicyHoldoutTotals;
  primaryCases: number;
  secondaryCases: number;
  /** Standard service estimates for these 100 probes; rollout work is paid separately below. */
  baselineStandardWorkCUw: number;
  guardedStandardWorkCUw: number;
  cases: RuntimeGuardrailAuditCase[];
}

/** Coalesced real grants keep an interrupted installation's history bounded. */
export interface RuntimeGuardrailWorkReceipt extends FacilityTariffFields {
  hardwareId: string;
  ownership: 'cloud' | 'owned';
  multiplierBps: number;
  rateCentsPerCUw: number;
  physicalCUw: number;
  effectiveCUw: number;
  conversionRemainder: number;
  grants: number;
  firstWeek: number;
  lastWeek: number;
}

export interface RuntimeGuardrailInstallation {
  id: string;
  companyId: string;
  productId: string;
  protocol: 'runtime-guardrails-v1';
  profile: RuntimeGuardrailProfile;
  binding: RuntimeGuardrailBinding;
  bindingFingerprint: string;
  evidenceKey: string;
  status: 'building' | 'ready' | 'active';
  enabled: boolean;
  startedWeek: number;
  completedWeek: number | null;
  availableWeek: number | null;
  requiredWork: number;
  completedWork: number;
  physicalWork: number;
  memoryMU: number;
  requiredStaff: number;
  completedStaff: number;
  workReceipts: Record<string, RuntimeGuardrailWorkReceipt>;
  latestGrant: { week: number; poolId: string; receiptKey: string; remainingBefore: number; requestedWork: number; effectiveCUw: number; physicalCUw: number; memoryMU: number } | null;
  staffGrantCount: number;
  firstStaffWeek: number | null;
  latestStaffGrant: { week: number; remainingBefore: number; grantedStaff: number } | null;
  audit: RuntimeGuardrailAudit | null;
  lastBottleneck: string;
}

/** Benign live traffic only. Restricted-policy outcomes belong to the separate paid audit. */
export interface RuntimeGuardrailUsage {
  installationId: string;
  profile: RuntimeGuardrailProfile;
  bindingFingerprint: string;
  requestWorkCUw: number;
  checkWorkCUw: number;
  requestedRequests: number;
  checkedRequests: number;
  uncheckedRequests: number;
  baselineFalseRefusalBps: number;
  technicalErrorBps: number;
  addedFalseRefusalBps: number;
  additionalFalseRefusals: number;
  /** Modeled conditional tendencies, never counts of unsafe live customer requests. */
  baselineUnsafeComplianceBps: number;
  guardedUnsafeComplianceBps: number;
}

/** Frozen in release evidence. Absent on a product that has never adopted this system. */
export interface RuntimeGuardrailConfiguration {
  installationId: string;
  profile: RuntimeGuardrailProfile;
  enabled: boolean;
  bindingFingerprint: string;
  pendingInstallationId?: string;
}

export interface RuntimeGuardrailView {
  researched: boolean;
  installation: RuntimeGuardrailInstallation | null;
  pending: RuntimeGuardrailInstallation | null;
  active: boolean;
  capturedInputsMatch: boolean;
  status: string;
  usage: RuntimeGuardrailUsage | null;
  usageWeek: number | null;
}

export interface Wave12GuardrailFields {
  /** Kept absent until first adoption so older companies retain their exact representation. */
  runtimeGuardrails?: Record<string, RuntimeGuardrailInstallation>;
}
