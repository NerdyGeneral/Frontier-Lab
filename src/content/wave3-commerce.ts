import type { BusinessCustomerDefinition } from '../contracts/wave3-commerce';
import { PRIVATE_APPLIANCE_BUYER, PRIVATE_APPLIANCE_COMMANDS } from './wave27-appliance';

/** Fictional fixed commercial offers. Each represents one of the finite business organizations. */
export const BUSINESS_CUSTOMERS: readonly BusinessCustomerDefinition[] = [
  { id: 'aster-services', name: 'Aster Services', description: 'A small document desk with a predictable weekly workload.',
    domain: 'documents', kinds: ['private-hosted', 'customer-hosted'], minimumScoreBps: 5500, minimumReliabilityBps: 9000,
    weeklyRequests: 2000, hostedWeeklyCents: 60_000, licenseWeeklyCents: 22_000,
    hostedSetupCents: 100_000, licenseSetupCents: 75_000, termWeeks: 12, slaBps: 9800 },
  { id: 'northline-operations', name: 'Northline Operations', description: 'A larger internal document service with a stricter availability commitment.',
    domain: 'documents', kinds: ['private-hosted', 'customer-hosted'], minimumScoreBps: 6000, minimumReliabilityBps: 9200,
    weeklyRequests: 3000, hostedWeeklyCents: 90_000, licenseWeeklyCents: 30_000,
    hostedSetupCents: 150_000, licenseSetupCents: 100_000, termWeeks: 12, slaBps: 9900 },
  { id: 'vector-studio', name: 'Vector Studio', description: 'A developer who licenses a fixed coding model and runs it on its own machines.',
    domain: 'coding', kinds: ['customer-hosted'], minimumScoreBps: 5000, minimumReliabilityBps: 8500,
    weeklyRequests: 0, hostedWeeklyCents: 0, licenseWeeklyCents: 25_000,
    hostedSetupCents: 0, licenseSetupCents: 100_000, termWeeks: 12, slaBps: 9800 },
  { id: 'meridian-analysis', name: 'Meridian Analysis', description: 'A demanding document team buying a stable evaluated release.',
    domain: 'documents', kinds: ['private-hosted', 'customer-hosted'], minimumScoreBps: 6500, minimumReliabilityBps: 9400,
    weeklyRequests: 5000, hostedWeeklyCents: 140_000, licenseWeeklyCents: 40_000,
    hostedSetupCents: 200_000, licenseSetupCents: 150_000, termWeeks: 12, slaBps: 9900 },
];
export const BUSINESS_BY_ID: Readonly<Record<string, BusinessCustomerDefinition>> = Object.fromEntries([...BUSINESS_CUSTOMERS, PRIVATE_APPLIANCE_BUYER].map(item => [item.id, item]));
export const COMMERCE_RULES = {
  retrievalInstallStaff: 2_000_000_000,
  retrievalDataStaffPerOrganization: 100_000_000,
  retrievalInputTokens: 500,
  retrievalLookupWorkCUw: 20_000,
  retrievalIndexMemoryMU: 1_000_000_000,
  retrievalMaximumDocumentBonusBps: 1000,
  privateDeploymentStaff: 4_000_000_000,
  licenseDeliveryStaff: 2_000_000_000,
  supportStaffPerOrganization: 250_000_000,
  privateSessionMemoryMU: 80_000_000,
  servingHeadroomBps: 1000,
  breachServiceBps: 9000,
  consecutiveBreaches: 2,
  slaPenaltyBps: 1000,
  reofferDelayWeeks: 4,
  invoiceHistoryLimit: 100,
} as const;
export const COMMERCE_COMMANDS = ['install_retrieval', 'sign_business_contract', 'set_business_renewal', ...PRIVATE_APPLIANCE_COMMANDS] as const;
