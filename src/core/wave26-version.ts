/** Historical envelopes cannot carry future research, commands or receipts. */
export function containsSyntheticFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'synthetic') || Object.hasOwn(item, 'syntheticJobs') || item.kind === 'synthetic'
    || ['start_synthetic_generation', 'start_synthetic_review', 'set_synthetic_job_paused'].includes(String(item.kind))
    || item.recipeId === 'targeted-synthetic' || item.researchId === 'S1' || item.researchId === 'S2') return true;
  if (Array.isArray(value) && value.some(item => item === 'S1' || item === 'S2')) return true;
  return Object.values(item).some(containsSyntheticFeatures);
}
