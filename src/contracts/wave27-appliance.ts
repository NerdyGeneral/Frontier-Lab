import type { ChipFoundry } from './wave4-hardware';
import type { BusinessCustomerDefinition, CommercialContract, CommercialInvoice } from './wave3-commerce';
import type { EvaluatedReleaseIdentity } from './wave27-canary';

export type PrivateApplianceBuyerId = 'cedar-records';
export type Wave27ApplianceCommand = {
  kind: 'accept_private_appliance_order'; buyerId: PrivateApplianceBuyerId;
  modelId: string; designId: string; foundry: ChipFoundry;
};

/** One immutable configuration ships to the customer's fleet, never to the lab's serving pool. */
export interface PrivateApplianceConfiguration {
  release: EvaluatedReleaseIdentity;
  designId: string; designFingerprint: string; foundry: ChipFoundry; racks: 2;
  attemptedCU: number; usableCU: number; memoryMU: number; yieldBps: number;
  weeklyWorkCUw: number; weeklyCapacityCUw: number; requiredMemoryMU: number;
  leadWeeks: number; fabricationCostCents: number;
}
export interface PrivateApplianceArtifact {
  id: string; acceptedWeek: number; configuration: PrivateApplianceConfiguration;
}
export interface PrivateApplianceOrder {
  id: string; buyerId: PrivateApplianceBuyerId; companyId: string; commandId: string;
  modelId: string; contractId: string; configuration: PrivateApplianceConfiguration;
  orderedWeek: number; arrivalWeek: number; shippedWeek: number | null;
  acceptedWeek: number | null; settledWeek: number | null;
  fabricationFactId: string; bundleReceiptId: string; bundlePriceCents: number;
  delivery: { completedStaff: number; grantCount: number; firstWeek: number | null;
    latestGrant: { week: number; remainingBefore: number; grantedStaff: number } | null };
  artifact: PrivateApplianceArtifact | null;
}
export interface Wave27ApplianceFields {
  privateApplianceOrders?: Partial<Record<PrivateApplianceBuyerId, PrivateApplianceOrder>>;
}
export interface PrivateApplianceBuyer extends BusinessCustomerDefinition {
  id: PrivateApplianceBuyerId;
  racks: 2; architecture: 'dense'; target: 'inference'; memory: 'wide';
  minimumUsefulCU: number; minimumMemoryMU: number; maximumLeadWeeks: number;
  inputTokensPerRequest: number; outputTokensPerRequest: number;
  bundlePriceCents: number;
}
export interface PrivateAppliancePreview {
  eligible: boolean; reasons: string[]; configuration: PrivateApplianceConfiguration | null;
  fabricationCostCents: number; deliverySetupCents: number; upfrontCostCents: number;
  bundlePriceCents: number; licenseWeeklyCents: number; supportStaffPerWeek: number;
  requiredDeliveryStaff: number; termWeeks: number;
}
export interface PrivateApplianceOrderView {
  order: PrivateApplianceOrder;
  phase: 'fabricating' | 'installing' | 'ready' | 'accepted';
  contract: CommercialContract;
  invoices: CommercialInvoice[];
  fabricationPaid: boolean; deliverySetupPaid: boolean; bundleSettled: boolean;
  installedArtifact: PrivateApplianceArtifact | null;
}
export interface PrivateApplianceView {
  unlocked: boolean; gateReason: string; buyer: PrivateApplianceBuyer;
  available: boolean; unavailableReason: string;
  models: Array<{ id: string; name: string; family: string; architecture: string; residentMU: number;
    documentsBps: number; reliabilityBps: number; weights: boolean; eligible: boolean; reasons: string[] }>;
  designs: Array<{ id: string; name: string; status: string; eligible: boolean; reasons: string[] }>;
  foundries: Array<{ id: ChipFoundry; name: string; availableRackSlots: number | null }>;
  orders: PrivateApplianceOrderView[];
  supportStaffPerWeek: number; requiredDeliveryStaff: number;
}
