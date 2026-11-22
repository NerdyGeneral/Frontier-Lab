import type { PrivateApplianceBuyer } from '../contracts/wave27-appliance';

const U = 1_000_000_000;

/** One fictional buyer, one supported workload and one finite hardware order. */
export const PRIVATE_APPLIANCE_BUYER: PrivateApplianceBuyer = {
  id: 'cedar-records', name: 'Cedar Records',
  description: 'A document team buying one evaluated model and a fixed local appliance, with a separate license and support term.',
  domain: 'documents', kinds: ['customer-hosted'], minimumScoreBps: 6000, minimumReliabilityBps: 9000,
  weeklyRequests: 30_000, hostedWeeklyCents: 0, licenseWeeklyCents: 30_000,
  hostedSetupCents: 0, licenseSetupCents: 100_000, termWeeks: 12, slaBps: 9900,
  racks: 2, architecture: 'dense', target: 'inference', memory: 'wide',
  minimumUsefulCU: 14 * U, minimumMemoryMU: 32 * U, maximumLeadWeeks: 8,
  inputTokensPerRequest: 600, outputTokensPerRequest: 100,
  bundlePriceCents: 3_800_000,
};

export const PRIVATE_APPLIANCE_RULES = {
  requiredResearch: 'S4',
  supportedFamilies: ['compact', 'medium'],
  sessionMemoryMU: U,
} as const;

export const PRIVATE_APPLIANCE_COMMANDS = ['accept_private_appliance_order'] as const;
