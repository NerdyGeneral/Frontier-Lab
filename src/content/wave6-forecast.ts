/** Authored planning assumptions. These change a preview, never the simulation. */
export const CAPACITY_FORECAST_RULES = {
  researchId: 'R12A',
  method: 'capacity-forecast',
  horizonWeeks: 12,
  defaultBaseGrowthBps: 200,
  defaultStressGrowthBps: 500,
  maximumGrowthBps: 1000,
} as const;

export const CAPACITY_FORECAST_ASSUMPTIONS = [
  'Week one starts with customers due to be active next week. Later weeks grow that group at your chosen rate, up to the market’s current size. A product with no customers stays at zero in this preview.',
  'Next week’s unfinished trials repeat in every forecast week. Models, product settings, prices, caches, and retrieval indexes stay as they are. This preview does not predict new signups, cancellations, competition, outages, or model upgrades.',
  'All signed private services and model licenses keep their reserved weekly capacity and support, even while delivery is unfinished. The preview assumes service continues past contract end dates; actual renewal is separate.',
  'Only hardware already running and staff ready and assigned today count. Queued choices, onboarding hires, deliveries, construction, and upgrades in progress add no capacity to this preview.',
  'This forecast covers customer service. Development and research keep their current compute limits. Agent jobs and research-assistant calls need extra serving capacity beyond what is shown.',
  'The cloud suggestion first gives serving any spare capacity, then adds general cloud GPUs in whole CU. Development and research keep their current limits. Normal hardware and memory requirements still apply. The price shown is extra rent; it cannot fix staff shortages or provide sparse-compatible hardware.',
  'Previewing costs nothing and reserves no resources. Confirm hires, assignments, and rentals separately. This forecast does not estimate revenue, new project fees, construction payments, or future cash.',
] as const;
