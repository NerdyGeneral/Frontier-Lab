import type { FacilityRetrofitDefinition, FacilityRetrofitKind } from '../contracts/wave8-retrofits';

const U = 1_000_000_000;

/** Fictional site engineering costs; neither extension purchases rack slots or accelerators. */
export const FACILITY_RETROFIT_RULES = {
  requiredResearch: 'R12',
  maxTypesPerFacility: 2,
  requestPriority: 17,
} as const;

export const FACILITY_RETROFITS: readonly FacilityRetrofitDefinition[] = [
  { kind: 'power-feed', name: 'Power feed extension', envelopeName: 'Power', purchaseCents: 1_800_000,
    requiredWeeks: 4, requiredStaff: 2 * U, envelopeUnits: 112 * U, weeklyCents: 6_000, operatingStaff: U / 20 },
  { kind: 'cooling-loop', name: 'Cooling loop expansion', envelopeName: 'Cooling', purchaseCents: 1_400_000,
    requiredWeeks: 3, requiredStaff: 3 * U / 2, envelopeUnits: 112 * U, weeklyCents: 4_000, operatingStaff: U / 20 },
];

export function facilityRetrofitDefinition(kind: FacilityRetrofitKind): FacilityRetrofitDefinition {
  const definition = FACILITY_RETROFITS.find(item => item.kind === kind);
  if (!definition) throw new Error('The facility retrofit type is unknown.');
  return definition;
}
