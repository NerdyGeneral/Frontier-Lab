import type { EndingId } from '../contracts/wave4-campaign';

/** Fictional campaign goals. Three strategic routes, each proved over consecutive weeks. */
export const ENDING_RULES: Readonly<Record<EndingId, { name: string; description: string; weeks: number }>> = {
  frontier: { name: 'Frontier laboratory', description: 'Deliver a broadly capable, tested frontier model while funding a reliable, profitable company.', weeks: 8 },
  platform: { name: 'Trusted platform', description: 'Serve a broad consumer and developer base with reliable delivery and a sustainable margin.', weeks: 12 },
  specialist: { name: 'Essential specialist', description: 'Become a dependable business supplier with strong domain performance and lasting customer commitments.', weeks: 12 },
};
export const ENDING_IDS: readonly EndingId[] = ['frontier', 'platform', 'specialist'];
export const CAMPAIGN_HISTORY_LIMIT = 16;
