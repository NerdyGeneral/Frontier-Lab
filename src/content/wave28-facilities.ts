import type { FacilityProfile, FacilityProfileDefinition } from '../contracts/wave28-facilities';

const U = 1_000_000_000;
export const FACILITY_SPECIALIZATION_RULES = {
  requiredResearch: 'S5', requestPriority: 18, maximumHistoryPerSite: 12,
  purchaseCents: 1_800_000, requiredWeeks: 3, requiredStaff: 3 * U, requiredWork: 6 * U, requiredMemory: 2 * U,
} as const;

export const FACILITY_PROFILES: readonly FacilityProfileDefinition[] = [
  { profile: 'serving', name: 'Serving profile',
    benefit: '10% lower GPU use costs for serving and other inference jobs at this site.',
    tradeoff: 'Training jobs share a limit of 90% of each pool’s GPU capacity. Fixed upkeep, salaries, and cloud rent stay the same.',
    purchaseCents: FACILITY_SPECIALIZATION_RULES.purchaseCents, requiredWeeks: 3, requiredStaff: 3 * U, requiredWork: 6 * U, requiredMemory: 2 * U,
    trainingCapacityBps: 9000, servingCapacityBps: 10000, crossRackTrainingBps: 10000, servingVariableCostBps: 9000 },
  { profile: 'training', name: 'Training profile',
    benefit: 'Compatible training across connected racks does 10% more work, after hardware and network effects.',
    tradeoff: 'Serving and other inference jobs share a limit of 90% of each pool’s GPU capacity, including spare capacity held for service.',
    purchaseCents: FACILITY_SPECIALIZATION_RULES.purchaseCents, requiredWeeks: 3, requiredStaff: 3 * U, requiredWork: 6 * U, requiredMemory: 2 * U,
    trainingCapacityBps: 10000, servingCapacityBps: 9000, crossRackTrainingBps: 11000, servingVariableCostBps: 10000 },
];

export function facilityProfileDefinition(profile: FacilityProfile): FacilityProfileDefinition {
  const definition = FACILITY_PROFILES.find(item => item.profile === profile);
  if (!definition) throw new Error('Choose a serving or training site profile.');
  return definition;
}
