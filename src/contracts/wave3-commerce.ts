import type { ModelVersion, WorkRequest } from './types';

export type CommercialContractKind = 'private-hosted' | 'customer-hosted';
export type CommercialStatus = 'building' | 'ready' | 'active' | 'expired' | 'terminated';
export interface RetrievalEvidence {
  packetId: string; sourceIds: string[]; qualityBps: number; documentCoverageBps: number;
  documentBonusBps: number; extraInputTokens: number; lookupWorkCUw: number; indexMemoryMU: number;
}
export interface RetrievalInstallation {
  id: string; companyId: string; productId: string; evidence: RetrievalEvidence;
  startedWeek: number; requiredStaff: number; completedStaff: number;
  status: 'building' | 'ready' | 'active'; readyWeek: number | null;
  lastUpkeepWeek: number | null; lastUpkeepRequired: number; lastUpkeepGranted: number;
  lastFreshnessBps: number; lastBottleneck: string;
}
export interface BusinessCustomerDefinition {
  id: string; name: string; description: string; domain: 'documents' | 'coding';
  kinds: readonly CommercialContractKind[]; minimumScoreBps: number; minimumReliabilityBps: number;
  weeklyRequests: number; hostedWeeklyCents: number; licenseWeeklyCents: number;
  hostedSetupCents: number; licenseSetupCents: number; termWeeks: number; slaBps: number;
}
export interface CommercialUsage {
  workload?: import('./product-workloads').ProductWorkloadUsage;
  week: number; requestedWorkCUw: number; executedWorkCUw: number; physicalWorkCUw: number;
  inputTokens: number; outputTokens: number; dataStaffRequired: number; dataStaffGranted: number;
  supportStaffRequired: number; supportStaffGranted: number; freshnessBps: number;
  fulfillmentBps: number; serviceBps: number; technicalErrorBps: number | null;
  grossCents: number; creditsCents: number; billedCents: number; explanation: string;
}
export interface CommercialContract {
  workload?: import('./product-workloads').ProductWorkloadReceipt;
  id: string; customerId: string; companyId: string; modelId: string;
  contractKind: CommercialContractKind; generation: number; signedWeek: number;
  setupFeeCents: number; setupFactId: string; status: CommercialStatus;
  requiredDeliveryStaff: number; completedDeliveryStaff: number; readyWeek: number | null;
  termStartedWeek: number | null; termEndsWeek: number | null; termIndex: number;
  autoRenew: boolean; termWeeksServed: number; termServiceBpsTotal: number; breachWeeks: number;
  endedWeek: number | null; lastBottleneck: string; evidence: RetrievalEvidence | null;
  rights: { hosted: boolean; weights: boolean }; weeklyPriceCents: number; weeklyRequests: number;
  reservedWorkCUw: number; reservedMemoryMU: number; servingHeadroomBps: number;
  inputTokensPerRequest: number; outputTokensPerRequest: number; workPerRequestCUw: number;
  dataStaffPerWeek: number; supportStaffPerWeek: number;
  lifetimeBilledCents: number; lifetimeCreditsCents: number; lastUsage: CommercialUsage | null;
}
export interface CommercialInvoice {
  workload?: import('./product-workloads').ProductWorkloadReceipt;
  id: string; contractId: string; customerId: string; companyId: string; modelId: string;
  contractKind: CommercialContractKind; generation: number; termIndex: number; week: number;
  grossCents: number; creditsCents: number; amountCents: number; serviceBps: number;
}
export interface Wave3CommerceFields {
  retrievalInstalls: Record<string, RetrievalInstallation>;
  commercialContracts: Record<string, CommercialContract>;
  commercialInvoices: CommercialInvoice[];
}
export type Wave3CommerceCommand =
  | { kind: 'install_retrieval'; productId: string; packetId: string }
  | { kind: 'sign_business_contract'; customerId: string; modelId: string; contractKind: CommercialContractKind; packetId?: string; workload?: import('./product-workloads').ProductWorkloadId }
  | { kind: 'set_business_renewal'; contractId: string; renew: boolean };

export interface BusinessView {
  research: { retrieval: boolean; enterprise: boolean };
  board: Array<BusinessCustomerDefinition & { contract: CommercialContract | null; available: boolean; unavailableReason: string }>;
  models: Array<{ id: string; name: string; family: ModelVersion['family']; documentsBps: number; codingBps: number; reliabilityBps: number; hosted: boolean; weights: boolean; evaluated: boolean }>;
  packets: Array<{ id: string; name: string; qualityBps: number; documentCoverageBps: number; documentBonusBps: number }>;
  products: Array<{ id: string; name: string; modelId: string; status: string; installation: RetrievalInstallation | null }>;
  installations: RetrievalInstallation[]; contracts: CommercialContract[]; invoices: CommercialInvoice[];
  committedOrganizations: number; outsideOrganizations: number;
  reservedWorkCUw: number; reservedMemoryMU: number;
  requiredDataStaff: number; requiredSupportStaff: number;
}
export interface BusinessAdmissionContext { standardRequests: readonly WorkRequest[] }
