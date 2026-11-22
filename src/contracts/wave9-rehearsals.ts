import type { FacilityTariffFields } from './wave28-tariffs';
import type { ProductFeatures, ProductKind } from './wave2-market';
import type { RuntimeGuardrailConfiguration } from './wave12-guardrails';
import type { RoutingPolicy } from './strategic-variety';

export type Wave9RehearsalCommand =
  | { kind: 'start_release_rehearsal'; productId: string; candidateModelId: string }
  | { kind: 'set_release_rehearsal_paused'; rehearsalId: string; paused: boolean };

/** Settings are captured once; changes can make old evidence stale without rewriting it. */
export interface ReleaseConfiguration {
  /** Balanced remains omitted so historical configuration fingerprints are stable. */
  routingPolicy?: RoutingPolicy;
  guardrail?: RuntimeGuardrailConfiguration;
  productKind: ProductKind;
  features: ProductFeatures;
  contractId: string;
  allowance: number;
  retrieval: { id: string; packetId: string; readyWeek: number | null } | null;
  efficiency: { id: string; kind: string; modelId: string; secondaryModelId: string | null; routingProtocol?: 2; retrievalId: string | null; evidencePacketId: string | null; enabled: boolean; readyWeek: number | null }[];
}

/** Every review case represents the same fixed number of standard exchanges. */
export interface ReleaseRehearsalOutcomes {
  cases: number;
  useful: number;
  confidentError: number;
  falseRefusal: number;
  clarification: number;
  technicalErrorBps: number;
}

/** Compact actual-grant totals, grouped by hardware conversion and authored tariff. */
export interface RehearsalWorkReceipt extends FacilityTariffFields {
  hardwareId: string;
  ownership: 'cloud' | 'owned';
  multiplierBps: number;
  rateCentsPerCUw: number;
  physicalCUw: number;
  effectiveCUw: number;
  /** Sum(physical * multiplier - executed * 10000), including integer rounding. */
  conversionRemainder: number;
  grants: number;
  firstWeek: number;
  lastWeek: number;
}

export interface RehearsalLatestGrant {
  week: number;
  poolId: string;
  receiptKey: string;
  remainingBefore: number;
  physicalCUw: number;
  effectiveCUw: number;
  memoryMU: number;
}

export interface ReleaseRehearsalArm {
  modelId: string;
  modelFingerprint: string;
  capabilityReportId: string;
  requiredWork: number;
  completedWork: number;
  memoryMU: number;
  physicalWork: number;
  workReceipts: Record<string, RehearsalWorkReceipt>;
  latestGrant: RehearsalLatestGrant | null;
  outcomes: ReleaseRehearsalOutcomes | null;
}

export interface ReleaseRehearsal {
  id: string;
  companyId: string;
  productId: string;
  protocol: 'release-rehearsal-1';
  sourceDeploymentId: string;
  sourceModelId: string;
  candidateModelId: string;
  configuration: ReleaseConfiguration;
  configurationFingerprint: string;
  evidenceKey: string;
  status: 'running' | 'ready' | 'complete';
  paused: boolean;
  startedWeek: number;
  completedWeek: number | null;
  availableWeek: number | null;
  requiredStaff: number;
  completedStaff: number;
  lastStaffWeek: number | null;
  latestReview: { week: number; remainingBefore: number; grantedStaff: number } | null;
  arms: { source: ReleaseRehearsalArm; candidate: ReleaseRehearsalArm };
  lastBottleneck: string;
}

export interface Wave9RehearsalFields {
  /** Omitted until used, preserving the representation of earlier companies. */
  releaseRehearsals?: Record<string, ReleaseRehearsal>;
}
