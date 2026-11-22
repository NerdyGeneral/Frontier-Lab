import type { FacilityTariffFields } from './wave28-tariffs';
import type { WorkRequest } from './types';
import type { RuntimeGuardrailBinding, RuntimeGuardrailProfile } from './wave12-guardrails';

export type AssuranceBuyerId = 'continuity-systems' | 'sentinel-services';
export type AssuranceCommand =
  | { kind: 'sign_assurance_contract'; buyerId: AssuranceBuyerId; productId: string }
  | { kind: 'requalify_assurance_contract'; contractId: string }
  | { kind: 'cancel_assurance_contract'; contractId: string };

export interface AssuranceBuyerDefinition {
  id: AssuranceBuyerId; name: string; description: string;
  minimumUsefulAnswers: number; maximumUnsafeCompliances: number;
  weeklyRequests: number; weeklyPriceCents: number; supportStaffPerWeek: number;
}

/** A separate tenant has its own full resident workspace and no public prefix-cache discount. */
export interface AssuranceMeter {
  inputTokensPerRequest: number; outputTokensPerRequest: number; internalTokensPerRequest: number;
  workPerRequestCUw: number; guardrailWorkPerRequestCUw: number;
  reservedMemoryMU: number; servingHeadroomBps: number;
  executionHints: Pick<WorkRequest, 'modelArchitecture' | 'modelFamily' | 'workloadKind' | 'requiresFastFabric'>;
}

/** Explicit acceptance of an already paid finite audit, retained after later configuration changes. */
export interface AssuranceQualification {
  version: number; acceptedWeek: number; commandId: string; installationId: string; profile: RuntimeGuardrailProfile;
  binding: RuntimeGuardrailBinding; bindingFingerprint: string; evidenceKey: string; auditFingerprint: string;
  usefulAnswers: number; unsafeCompliances: number; meter: AssuranceMeter;
}

export interface AssuranceComputeReceipt extends FacilityTariffFields {
  poolId: string; hardwareId: string; ownership: 'cloud' | 'owned'; multiplierBps: number;
  rateCentsPerCUw: number; memoryMU: number;
}

export interface AssuranceUsage {
  week: number; qualificationVersion: number; installationId: string; bindingFingerprint: string;
  qualified: boolean; productActive: boolean; requestedRequests: number; servedRequests: number;
  requestedWorkCUw: number; executedWorkCUw: number; physicalWorkCUw: number;
  computeReceipt: AssuranceComputeReceipt | null;
  inputTokens: number; outputTokens: number; internalTokens: number; guardrailWorkCUw: number;
  supportStaffRequired: number; supportStaffGranted: number;
  fulfillmentBps: number; supportBps: number; qualificationBps: number; serviceBps: number;
  grossCents: number; creditsCents: number; billedCents: number; explanation: string;
}

export interface AssuranceContract {
  id: string; buyerId: AssuranceBuyerId; companyId: string; productId: string;
  status: 'building' | 'ready' | 'active' | 'expired' | 'cancelled'; signedWeek: number;
  setupFeeCents: number; setupFactId: string;
  requiredOnboardingStaff: number; completedOnboardingStaff: number;
  onboardingGrantCount: number; firstOnboardingWeek: number | null;
  latestOnboardingGrant: { week: number; remainingBefore: number; grantedStaff: number } | null;
  readyWeek: number | null; termStartedWeek: number | null; termEndsWeek: number | null; endedWeek: number | null; cancellationCommandId: string | null;
  weeklyRequests: number; weeklyPriceCents: number; supportStaffPerWeek: number; slaBps: number;
  qualifications: AssuranceQualification[];
  termWeeksServed: number; termServiceBpsTotal: number;
  lifetimeBilledCents: number; lifetimeCreditsCents: number; lastUsage: AssuranceUsage | null; lastBottleneck: string;
}

export interface AssuranceInvoice {
  id: string; contractId: string; buyerId: AssuranceBuyerId; companyId: string; productId: string;
  week: number; qualificationVersion: number; installationId: string; bindingFingerprint: string;
  grossCents: number; creditsCents: number; amountCents: number; serviceBps: number;
  /** Small complete service receipt preserves the invoice's historical qualification and actual delivery. */
  usage: AssuranceUsage;
}

export interface Wave13AssuranceFields {
  assuranceContracts?: Record<string, AssuranceContract>;
  assuranceInvoices?: AssuranceInvoice[];
}

export interface AssuranceView {
  researched: boolean; committedOrganizations: number; outsideOrganizations: number;
  board: Array<AssuranceBuyerDefinition & { available: boolean; unavailableReason: string; retainedTerms: number; contract: AssuranceContract | null }>;
  products: Array<{ id: string; name: string; status: string; installationId: string | null; profile: RuntimeGuardrailProfile | null; usefulAnswers: number | null; unsafeCompliances: number | null; qualifyingBuyers: AssuranceBuyerId[] }>;
  contracts: Array<{ contract: AssuranceContract; qualified: boolean; productActive: boolean; currentQualification: AssuranceQualification; status: string }>;
  invoices: AssuranceInvoice[]; reservedWorkCUw: number; reservedMemoryMU: number; requiredSupportStaff: number;
}
