import type { ChipDesign, ChipSpecification } from '../contracts/wave4-hardware';
import { GEN2_SILICON_RULES } from './wave28-silicon';
import { mulDiv } from '../core/math';

const U = 1_000_000_000;

/** Fictional late-game coefficients. Purchases never include installation or running costs. */
export const CHIP_RULES = {
  maxDesignsPerCompany: 8,
  maxBatchesPerCompany: 64,
  servingHistoryWeeks: 8,
  baseDesignFeeCents: 2_000_000,
  sparseDesignFeeCents: 500_000,
  wideDesignFeeCents: 300_000,
  prototypeFeeCents: 500_000,
  designHardwareStaff: 4 * U,
  sparseExtraHardwareStaff: 2 * U,
  designWorkCUw: 8 * U,
  sparseExtraWorkCUw: 4 * U,
  prototypeHardwareStaff: 2 * U,
  prototypeMlStaff: U,
  prototypeWorkCUw: 4 * U,
  fabricationWeeks: 5,
  balancedPurchaseCentsPerCU: 110_000,
  widePurchaseCentsPerCU: 140_000,
  sparsePurchaseExtraCentsPerCU: 15_000,
  fabricCostCents: 800_000,
  fabricElapsedWeeks: 3,
  fabricStaff: 2 * U,
  fabricWorkCUw: 4 * U,
  fabricFixedCentsPerWeek: 8_000,
  fabricOperatingStaff: U / 20,
  fabricCrossRackBps: 9_500,
} as const;

export function chipSpecificationKey(spec: ChipSpecification): string {
  return `${spec.architecture}:${spec.target}:${spec.memory}`;
}

export function chipSpecificationValues(spec: ChipSpecification) {
  const sparse = spec.architecture === 'sparse', wide = spec.memory === 'wide', training = spec.target === 'training';
  return {
    designFeeCents: CHIP_RULES.baseDesignFeeCents + (sparse ? CHIP_RULES.sparseDesignFeeCents : 0) + (wide ? CHIP_RULES.wideDesignFeeCents : 0),
    designHardwareStaff: CHIP_RULES.designHardwareStaff + (sparse ? CHIP_RULES.sparseExtraHardwareStaff : 0),
    designWorkCUw: CHIP_RULES.designWorkCUw + (sparse ? CHIP_RULES.sparseExtraWorkCUw : 0),
    purchaseCentsPerCU: (wide ? CHIP_RULES.widePurchaseCentsPerCU : CHIP_RULES.balancedPurchaseCentsPerCU) + (sparse ? CHIP_RULES.sparsePurchaseExtraCentsPerCU : 0),
    memoryMUPerCU: (wide ? 4 : 2) * U,
    trainingBps: training ? (wide ? 19_000 : 22_000) + (sparse ? 2_000 : 0) : 0,
    servingBps: training ? 0 : (wide ? 16_500 : 20_000) + (sparse ? 1_000 : 0),
    powerPerCU: training ? (wide ? 1.3 : 1.1) : (wide ? 0.85 : 0.6),
    variableCentsPerCUw: training ? (wide ? 4_500 : 4_000) : (wide ? 3_000 : 2_500),
    deliveryWeeks: CHIP_RULES.fabricationWeeks + (sparse ? 1 : 0) + (wide ? 1 : 0),
  };
}

/** The single design-aware hardware profile. An original design returns its original values unchanged. */
export function chipDesignValues(design: Pick<ChipDesign, 'spec' | 'successor'>) {
  const base = chipSpecificationValues(design.spec);
  if (!design.successor) return base;
  return { ...base, designFeeCents: GEN2_SILICON_RULES.designFeeCents, designHardwareStaff: GEN2_SILICON_RULES.designHardwareStaff,
    designWorkCUw: GEN2_SILICON_RULES.designWorkCUw,
    purchaseCentsPerCU: mulDiv(base.purchaseCentsPerCU, GEN2_SILICON_RULES.productionPriceBps, 10_000, 'ceil'),
    memoryMUPerCU: base.memoryMUPerCU + (design.successor.improvement === 'memory' ? GEN2_SILICON_RULES.memoryBonusMUPerCU : 0),
    trainingBps: design.successor.improvement === 'throughput' ? mulDiv(base.trainingBps, GEN2_SILICON_RULES.throughputBps, 10_000) : base.trainingBps,
    servingBps: design.successor.improvement === 'throughput' ? mulDiv(base.servingBps, GEN2_SILICON_RULES.throughputBps, 10_000) : base.servingBps };
}

export function chipPrototypeValues(design: Pick<ChipDesign, 'successor'>) {
  const rules = design.successor ? GEN2_SILICON_RULES : CHIP_RULES;
  return { feeCents: rules.prototypeFeeCents, hardwareStaff: rules.prototypeHardwareStaff,
    mlStaff: rules.prototypeMlStaff, workCUw: rules.prototypeWorkCUw };
}
