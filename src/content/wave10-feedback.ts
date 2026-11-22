import type { FeedbackConsent, FeedbackSampling } from '../contracts/wave10-feedback';

/** Fictional game balance; these are not claims about real consent or model performance. */
export const FEEDBACK_RULES = {
  protocol: 'customer-feedback-1' as const,
  requiredResearch: 'R5',
  weeks: 4,
  casesPerWeek: 25,
  maximumCases: 100,
  maximumPerProduct: 8,
  maximumHistory: 16,
  consentBps: { 'hosted-only': 2500, distribution: 1000 } satisfies Record<FeedbackConsent, number>,
};

export const FEEDBACK_SAMPLING: { id: FeedbackSampling; name: string; description: string }[] = [
  { id: 'representative', name: 'Representative sample', description: 'Samples opted-in paying accounts across their served responses. Broader task coverage; half the reviewed cases count as behavior evidence.' },
  { id: 'failure-focused', name: 'Failure-focused sample', description: 'Collects estimated mistakes, false refusals and uncertainty from opted-in paid service. Fewer cases when failures are rare; narrower coverage and more behavior evidence.' },
];

export const FEEDBACK_CONSENTS: { id: FeedbackConsent; name: string; description: string }[] = [
  { id: 'hosted-only', name: 'Hosted training only · 25% opt in', description: 'More accounts participate. Models trained on this dataset can be hosted but cannot be licensed as weights.' },
  { id: 'distribution', name: 'Weight distribution allowed · 10% opt in', description: 'Fewer accounts participate. Weight licensing remains possible only when the source model lineage also permits it.' },
];

export const FEEDBACK_SCOPE = 'Game-authored, aggregate feedback from paid Chat or API service. No live LLM is called and no real conversations are collected. Trials, rehearsals, business documents, private hosting and weight-license use do not contribute. Collection changes no model, customer price or product behavior; a separate paid review must produce data before ordinary training, evaluation and release can use it.';

export const FEEDBACK_ROW_LABELS = {
  sampled: 'Consented cases collected',
  'no-paid-service': 'No completed paid service',
  'source-changed': 'Source deployment changed',
  'no-consent-cases': 'Too few served opted-in accounts',
  'no-negative-cases': 'No estimated opted-in negative responses',
} as const;
