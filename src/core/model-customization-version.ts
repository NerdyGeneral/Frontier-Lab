export const MODEL_CUSTOMIZATION_CONTENT_VERSION = '0.35.0';

export const isModelCustomizationResearch = (value: unknown): boolean =>
  typeof value === 'string' && /^M(?:[1-9]|1[0-3])$/.test(value);

/** Reject new engineering choices or paid discoveries before old-save migration. */
export function containsModelCustomizationFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'customization') || isModelCustomizationResearch(item.researchId)
    || ['completed', 'methods'].some(key => Array.isArray(item[key]) && item[key].some(isModelCustomizationResearch))
    || (item.completedByCompany && typeof item.completedByCompany === 'object'
      && Object.values(item.completedByCompany).some(ids => Array.isArray(ids) && ids.some(isModelCustomizationResearch)))) return true;
  return Object.values(item).some(containsModelCustomizationFeatures);
}
