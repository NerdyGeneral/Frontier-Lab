/** Historical headers cannot conceal paid campus or successor-silicon adoption. */
export function containsCampusFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'facilitySpecializations') || Object.hasOwn(item, 'specialization')
    || Object.hasOwn(item, 'successor') || Object.hasOwn(item, 'facilityTariff')
    || ['start_facility_specialization', 'set_facility_specialization_paused', 'start_chip_successor'].includes(String(item.kind))
    || item.researchId === 'S5' || item.researchId === 'S6') return true;
  if (Array.isArray(value) && value.some(item => item === 'S5' || item === 'S6')) return true;
  return Object.values(item).some(containsCampusFeatures);
}
