/** Connected Company keeps paid historical work intact and opts new work into
 * outcome-based projects, customer workloads, and company progression. */
export const CONNECTED_COMPANY_CONTENT_VERSION = '0.38.0';
export const hasConnectedCompanyRules = (version: string): boolean => version === CONNECTED_COMPANY_CONTENT_VERSION;

/** New records cannot be smuggled into a historical save before migration. */
export function containsConnectedCompanyFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'developmentPlanArchive') || Object.hasOwn(item, 'progression')
    || Object.hasOwn(item, 'retiredWeek')
    || (item.systems && typeof item.systems === 'object' && Object.hasOwn(item.systems, 'focus'))
    || Object.keys(item).some(key => key.startsWith('business-workload:'))
    || ['start_research_experiment', 'configure_product_offer', 'retire_product'].includes(String(item.kind))
    || (['deploy_product', 'sign_business_contract'].includes(String(item.kind)) && Object.hasOwn(item, 'workload'))
    || (item.kind === 'deploy_product' && Object.hasOwn(item, 'name'))
    || (item.workload && typeof item.workload === 'object')
    || (Object.hasOwn(item, 'training') && ['objective', 'leadStaffId', 'capacityShareBps'].some(key => Object.hasOwn(item, key)))
    || (item.kind === 'revise_development_plan' && ['leadStaffId', 'capacityShareBps'].some(key => Object.hasOwn(item, key)))
    || (item.version === 2 && Object.hasOwn(item, 'briefId') && Object.hasOwn(item, 'qualifyingWeeks'))) return true;
  return Object.values(item).some(containsConnectedCompanyFeatures);
}
