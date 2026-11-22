/** Historical envelopes cannot contain release telemetry or appliance obligations. */
export function containsStudioReleaseFeatures(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, 'canaryReleases') || Object.hasOwn(item, 'canary')
    || Object.hasOwn(item, 'privateApplianceOrders')
    || ['start_release_canary', 'stop_release_canary', 'accept_private_appliance_order'].includes(String(item.kind))
    || item.customerId === 'cedar-records' || item.buyerId === 'cedar-records'
    || item.researchId === 'S3' || item.researchId === 'S4') return true;
  if (Array.isArray(value) && value.some(item => item === 'S3' || item === 'S4')) return true;
  return Object.values(item).some(containsStudioReleaseFeatures);
}
