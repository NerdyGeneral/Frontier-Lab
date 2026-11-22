import type { InfrastructureContent } from '../contracts/wave2-infrastructure';

const U = 1_000_000_000;

/** Authored M07 values. Efficient sites, resilience and R14 fabric stay gated. */
export const INFRASTRUCTURE_CONTENT: InfrastructureContent = {
  rackCU: 8 * U,
  deliveryWeeks: 6,
  installationStaffWeeks: U,
  maxRacksPerCompany: 64,
  maxFacilitiesPerCompany: 4,
  colocationCentsPerRackWeek: 16_000,
  colocationStaffPerRack: U / 4,
  ownedMaintenanceCentsPerCUWeek: 500,
  siteFixedCentsPerWeek: 24_000,
  siteBaseStaff: U / 4,
  siteStaffPer16CU: U / 4,
  siteSlotsCU: 64 * U,
  sitePowerUnits: 64 * U,
  siteCoolingUnits: 64 * U,
  crossRackTrainingBps: 7000,
  stages: [
    { id: 'reservation', name: 'Site reservation', costCents: 400_000, elapsedWeeks: 2, staffWeeks: U / 4 },
    { id: 'preparation', name: 'Site preparation', costCents: 400_000, elapsedWeeks: 2, staffWeeks: U / 2 },
    { id: 'shell', name: 'Shell', costCents: 1_200_000, elapsedWeeks: 6, staffWeeks: 3 * U / 4 },
    { id: 'power-cooling', name: 'Power and cooling', costCents: 1_400_000, elapsedWeeks: 6, staffWeeks: 3 * U / 2 },
    { id: 'network-storage', name: 'Network and storage', costCents: 400_000, elapsedWeeks: 2, staffWeeks: U / 2 },
    { id: 'acceptance', name: 'Acceptance', costCents: 200_000, elapsedWeeks: 2, staffWeeks: U / 2 },
  ],
};
