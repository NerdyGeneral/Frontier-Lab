import { CONTENT } from '../content/catalog';
import { chipDesignValues } from '../content/wave4-hardware';
import type { ComputePool, GameContent, GameState } from '../contracts/types';
import type { FacilityWorkRequest } from '../contracts/wave28-facilities';
import type { FacilityTariffFields } from '../contracts/wave28-tariffs';
import { facilityWorkClass, getHistoricalPoolWorkCostRate } from './compute-pools';
import { getFacilitySpecializationAtWeek } from './facility-specialization';

/** Different sites and paid profile generations keep distinct cumulative buckets. */
export function facilityTariffBinding(pool: ComputePool, request: FacilityWorkRequest): FacilityTariffFields {
  return pool.ownership === 'owned' && pool.specialization?.profile === 'serving' && facilityWorkClass(request) === 'serving'
    ? { facilityTariff: { poolId: pool.id, specializationId: pool.specialization.id } } : {};
}

/** Conditional spread preserves every pre-Campus receipt key. */
export function facilityTariffIdentity(receipt: FacilityTariffFields): FacilityTariffFields {
  return Object.hasOwn(receipt, 'facilityTariff') ? { facilityTariff: receipt.facilityTariff } : {};
}

export function assertFacilityTariffPool(receipt: FacilityTariffFields, poolId: string): void {
  if (receipt.facilityTariff && receipt.facilityTariff.poolId !== poolId) throw new Error('Facility tariff receipt changed its actual connected pool.');
}

/** A retained actual grant closes the optional-proof omission path, even when
 * its cumulative bucket began before the site's profile was activated. */
export function assertFacilityTariffGrant(state: Readonly<GameState>,
  receipt: FacilityTariffFields & { ownership: 'cloud' | 'owned'; hardwareId: string; rateCentsPerCUw: number },
  companyId: string, poolId: string, week: number, request: FacilityWorkRequest, content: GameContent = CONTENT): void {
  assertFacilityTariffPool(receipt, poolId);
  const hardware = content.hardware.find(item => item.id === receipt.hardwareId);
  const design = state.slices.compute.chipDesigns?.[receipt.hardwareId];
  const base = receipt.ownership === 'cloud' ? content.opening.rentCentsPerCUWeek
    : hardware?.variableCentsPerCUw ?? (design ? chipDesignValues(design).variableCentsPerCUw : undefined);
  if (base === undefined || receipt.rateCentsPerCUw !== validatedFacilityRate(state, receipt, companyId, base, week, week, request, poolId)) {
    throw new Error('Facility tariff does not match its retained actual pool grant.');
  }
}

/** Validate the paid profile that was active for the entire receipt interval.
 * A later switch cannot change old service costs or grant a foreign site a discount. */
export function validatedFacilityRate(state: Readonly<GameState>,
  receipt: FacilityTariffFields & { ownership: 'cloud' | 'owned' | null; hardwareId: string | null },
  companyId: string, baseRateCentsPerCUw: number, firstWeek: number, lastWeek: number,
  request: FacilityWorkRequest, capturedPoolId?: string | null): number {
  if (!Object.hasOwn(receipt, 'facilityTariff')) {
    if (capturedPoolId && receipt.hardwareId && receipt.ownership === 'owned'
      && getHistoricalPoolWorkCostRate(state, capturedPoolId, receipt.hardwareId, firstWeek, baseRateCentsPerCUw, request) !== baseRateCentsPerCUw) {
      throw new Error('Discounted facility work is missing its paid profile receipt.');
    }
    return baseRateCentsPerCUw;
  }
  const binding = receipt.facilityTariff;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join() !== 'poolId,specializationId'
    || typeof binding.poolId !== 'string' || typeof binding.specializationId !== 'string'
    || receipt.ownership !== 'owned' || !receipt.hardwareId || facilityWorkClass(request) !== 'serving') {
    throw new Error('Facility tariff proof is invalid for this workload.');
  }
  const profile = state.slices.compute.facilitySpecializations?.[binding.specializationId];
  if (!profile || profile.companyId !== companyId || profile.profile !== 'serving'
    || binding.poolId !== `owned:${profile.facilityId}:${receipt.hardwareId}`
    || state.slices.compute.facilities[profile.facilityId]?.companyId !== companyId
    || profile.activatedWeek === null || firstWeek < profile.activatedWeek || lastWeek < firstWeek
    || lastWeek > state.week || (profile.retiredWeek !== null && lastWeek >= profile.retiredWeek)
    || getFacilitySpecializationAtWeek(state, profile.facilityId, firstWeek)?.id !== profile.id
    || getFacilitySpecializationAtWeek(state, profile.facilityId, lastWeek)?.id !== profile.id
    || (capturedPoolId != null && capturedPoolId !== binding.poolId)) {
    throw new Error('Facility tariff does not match its paid site profile and actual service weeks.');
  }
  return getHistoricalPoolWorkCostRate(state, binding.poolId, receipt.hardwareId, firstWeek, baseRateCentsPerCUw, request);
}
