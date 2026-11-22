/** New campaigns vary their opportunities and rivals; saved receipts stay frozen. */
export const GAMEPLAY_POLISH_CONTENT_VERSION = '0.36.0';

const specialistIds = ['compact-efficiency', 'visual-documents', 'long-context-review', 'support-at-scale'];
/** New receipts cannot be laundered through an older version before migration. */
export function containsGameplayPolishFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'sequenceVersion') || Object.hasOwn(item, 'tactics')
    || (Object.hasOwn(item, 'specialist') && Object.hasOwn(item, 'targetId'))
    || ['id','briefId'].some(key => typeof item[key] === 'string' && (specialistIds.includes(item[key] as string) || (item[key] as string).startsWith('brief-proof:')))
    || Object.keys(item).some(key => key.startsWith('brief-proof:'))) return true;
  return Object.values(item).some(containsGameplayPolishFeatures);
}
