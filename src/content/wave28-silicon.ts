const U = 1_000_000_000;

/** Fictional Gen2 redesign targets. Research eligibility does not pay any design or prototype cost. */
export const GEN2_SILICON_RULES = {
  requiredResearch: 'S6', maxSuccessorsPerCompany: 8,
  // Covers every bounded hardware/location/profile interval and fabric conversion.
  maximumReceiptBuckets: 4096,
  designFeeCents: 1_800_000, designHardwareStaff: 6 * U, designWorkCUw: 12 * U,
  prototypeFeeCents: 750_000, prototypeHardwareStaff: 3 * U, prototypeMlStaff: U, prototypeWorkCUw: 6 * U,
  memoryBonusMUPerCU: U, throughputBps: 11_000, productionPriceBps: 11_000,
} as const;
