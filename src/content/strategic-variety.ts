import type { ChapterId, ProductAudience, RoutingPolicy } from '../contracts/strategic-variety';

export const ROUTING_POLICIES: Record<RoutingPolicy, { name: string; secondaryShareBps: number; description: string }> = {
  economy: { name: 'Economy', secondaryShareBps: 8000, description: 'Send 80% of requests to the cheaper model. Lowest compute use, with more of that model’s quality and behavior.' },
  balanced: { name: 'Balanced', secondaryShareBps: 6000, description: 'Send 60% to the cheaper model and 40% to the primary model.' },
  quality: { name: 'Quality', secondaryShareBps: 2000, description: 'Keep 80% with the primary model. Pay more serving compute to rely chiefly on its strengths.' },
};
export const PRODUCT_AUDIENCES: Record<ProductAudience, { name: string; description: string }> = {
  broad: { name: 'Broad audience', description: 'Keep the existing customer mix. No positioning bonus or penalty.' },
  value: { name: 'Value seekers', description: 'Win more price-sensitive customers when their reference bill is affordable. Lose appeal with demanding buyers; an expensive offer weakens the value promise.' },
  professional: { name: 'Professional use', description: 'Appeal to demanding buyers with task quality 75+, reliability 90%+, and fulfilled service 95%+. Weaker service or quality hurts this promise.' },
};
export const CHAPTERS: Record<ChapterId, { title: string; description: string; weeks: number; requirements: string[] }> = {
  'first-product': { title: 'Your first paying product', description: 'Build, test and serve a model of your own.', weeks: 1,
    requirements: ['A completed player training run and paid capability evaluation', 'At least one paying account on that model', 'At least 90% of customer requests fulfilled'] },
  'efficient-portfolio': { title: 'Make two models earn their keep', description: 'Run a profitable service with an economical model portfolio.', weeks: 3,
    requirements: ['Active two-model routing with the Economy policy', 'At least one paying account and 95% fulfillment', 'Positive company operating surplus for three consecutive weeks'] },
  'advanced-specialist': { title: 'Build an advanced specialist', description: 'Turn a measured advanced skill into reliable paid service.', weeks: 2,
    requirements: ['An advanced evaluation on the exact live model', 'Reasoning, long context or multimodal at 70+', 'Paying service with 95% fulfillment for two consecutive weeks'] },
  'frontier-lab': { title: 'A frontier model in the real world', description: 'Prove a broadly capable custom frontier model while keeping the company profitable.', weeks: 3,
    requirements: ['A trained custom Frontier model with core skills 80+ and all three advanced skills 60+', 'Paid capability and advanced evaluations on that model', 'Paying service, 95% fulfillment and positive operating surplus for three consecutive weeks'] },
};
