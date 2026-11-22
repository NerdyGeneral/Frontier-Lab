import type { ChipDesign, ChipFoundry, HardwareBuyerId } from '../contracts/wave4-hardware';
import { chipDesignValues } from './wave4-hardware';
import { mulDiv } from '../core/math';

const U = 1_000_000_000;
export const SILICON_CONTENT_VERSION = '0.23.0';

export const CHIP_FOUNDRIES = {
  standard: { name: 'Standard foundry', priceBps: 10_000, weeks: 0, yieldBonusBps: 0, rackSlots: null },
  express: { name: 'Express foundry', priceBps: 12_500, weeks: -2, yieldBonusBps: 0, rackSlots: 4 },
  'high-yield': { name: 'High-yield foundry', priceBps: 11_500, weeks: 2, yieldBonusBps: 1_250, rackSlots: 4 },
} satisfies Record<ChipFoundry, { name: string; priceBps: number; weeks: number; yieldBonusBps: number; rackSlots: number | null }>;

export function isChipFoundry(value: unknown): value is ChipFoundry {
  return typeof value === 'string' && Object.hasOwn(CHIP_FOUNDRIES, value);
}

export function chipProductionTerms(design: ChipDesign, racks: number, rackCU: number, foundry: ChipFoundry = 'standard') {
  const spec = chipDesignValues(design), route = CHIP_FOUNDRIES[foundry];
  const attemptedCU = racks * rackCU;
  const yieldBps = Math.min(10_000, (design.qualifiedYieldBps ?? 0) + route.yieldBonusBps);
  return {
    attemptedCU, yieldBps, usableCU: racks * mulDiv(rackCU, yieldBps, 10_000),
    leadWeeks: spec.deliveryWeeks + route.weeks,
    costCents: racks * mulDiv(mulDiv(rackCU, spec.purchaseCentsPerCU, U), route.priceBps, 10_000, 'ceil'),
  };
}

export const HARDWARE_BUYERS = {
  'relay-edge': { name: 'Relay Edge', target: 'inference', architecture: 'dense', racks: 1, minUsefulCU: 7 * U, minMemoryPerCU: 2 * U, leadWeeks: 3, priceCents: 1_450_000 },
  'vesper-systems': { name: 'Vesper Systems', target: 'inference', architecture: 'dense', racks: 2, minUsefulCU: 14 * U, minMemoryPerCU: 4 * U, leadWeeks: 8, priceCents: 3_200_000 },
  'summit-research': { name: 'Summit Research', target: 'training', architecture: 'dense', racks: 2, minUsefulCU: 14 * U, minMemoryPerCU: 2 * U, leadWeeks: 4, priceCents: 2_850_000 },
} as const satisfies Record<HardwareBuyerId, {
  name: string; target: ChipDesign['spec']['target']; architecture: ChipDesign['spec']['architecture'];
  racks: 1 | 2 | 4; minUsefulCU: number; minMemoryPerCU: number; leadWeeks: number; priceCents: number;
}>;

export function hardwareBuyerFit(design: ChipDesign, buyerId: HardwareBuyerId, terms: ReturnType<typeof chipProductionTerms>): string {
  const buyer = HARDWARE_BUYERS[buyerId];
  if (design.spec.target !== buyer.target || design.spec.architecture !== buyer.architecture) return 'The buyer requires a ' + buyer.architecture + ' ' + buyer.target + ' design.';
  if (chipDesignValues(design).memoryMUPerCU < buyer.minMemoryPerCU) return 'The buyer requires more memory per CU.';
  if (terms.usableCU < buyer.minUsefulCU) return 'This foundry route falls short of the buyer’s useful capacity requirement.';
  if (terms.leadWeeks > buyer.leadWeeks) return 'This foundry route misses the buyer’s delivery deadline.';
  return '';
}
