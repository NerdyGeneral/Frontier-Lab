/** AI Systems adds optional, versioned designs and paid customer evidence. */
export const AI_SYSTEMS_CONTENT_VERSION = '0.37.0';

export const isAISystemsResearch = (value: unknown): boolean =>
  typeof value === 'string' && /^A(?:[1-9]|1[0-2])$/.test(value);

/** Reject future records before migrating a historical save. Player-authored
 * names and journal prose do not count as feature evidence. */
export function containsAISystemsFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'systemsBriefs') || Object.hasOwn(item, 'system')
    || item.kind === 'accept_systems_brief' || isAISystemsResearch(item.researchId)
    || (typeof item.suiteId === 'string' && item.suiteId.startsWith('systems-'))
    || ['completed', 'methods', 'researchIds'].some(key => Array.isArray(item[key]) && item[key].some(isAISystemsResearch))
    || (item.completedByCompany && typeof item.completedByCompany === 'object'
      && Object.values(item.completedByCompany).some(ids => Array.isArray(ids) && ids.some(isAISystemsResearch)))) return true;
  return Object.values(item).some(containsAISystemsFeatures);
}
