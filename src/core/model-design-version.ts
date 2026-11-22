/** Old content headers cannot conceal paid custom designs, advanced skills or research iterations. */
export function containsModelDesignFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (['modelDesign', 'modelResearch', 'advancedCapabilities', 'advancedCoverageBps', 'advanced'].some(key => Object.hasOwn(item, key))
    || item.family === 'edge' || item.family === 'frontier'
    || item.recipeId === 'custom-model-foundation' || item.recipeId === 'custom-model-adaptation'
    || item.suiteId === 'advanced-capabilities-1'
    || (typeof item.catalogId === 'string' && item.catalogId.startsWith('advanced-'))
    || item.kind === 'start_model_research' || item.kind === 'set_model_research_paused') return true;
  return Object.values(item).some(containsModelDesignFeatures);
}
