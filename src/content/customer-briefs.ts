import type { BriefId, SpecialistBriefId } from '../contracts/customer-briefs';
import type { CapabilityDomain } from '../contracts/wave2-lab';
import type { AdvancedDomain } from '../contracts/advanced-skills';

const U = 1_000_000_000;
export interface SpecialistBriefRule {
  minimumScores: Partial<Record<CapabilityDomain | AdvancedDomain, number>>;
  reliabilityBps: number;
  residentMU: number;
  workPerThousandCUw: number;
  requestsPerWeek: number;
  extendedContext: boolean;
  falseRefusalBps?: number;
  confidentErrorBps?: number;
}
/** Measured model requirements, not prescribed architecture choices. */
export const SPECIALIST_BRIEF_RULES: Readonly<Record<SpecialistBriefId, SpecialistBriefRule>> = {
  'compact-efficiency': { minimumScores: { conversation: 4500 }, reliabilityBps: 8800, residentMU: U,
    workPerThousandCUw: 0.15 * U, requestsPerWeek: 1000, extendedContext: false },
  'visual-documents': { minimumScores: { documents: 6500, multimodal: 6000 }, reliabilityBps: 9000, residentMU: 16 * U,
    workPerThousandCUw: 1.2 * U, requestsPerWeek: 2000, extendedContext: false },
  'long-context-review': { minimumScores: { documents: 6500, longContext: 7000 }, reliabilityBps: 9000, residentMU: 24 * U,
    workPerThousandCUw: 1.5 * U, requestsPerWeek: 2000, extendedContext: true },
  'support-at-scale': { minimumScores: { conversation: 6500 }, reliabilityBps: 9000, residentMU: 6 * U,
    workPerThousandCUw: 0.5 * U, requestsPerWeek: 10000, extendedContext: false, falseRefusalBps: 500, confidentErrorBps: 1600 },
};

interface BriefDefinition {
  title: string;
  client: string;
  weeks: number;
  qualifyingWeeks: number;
  feeCents: number;
  terms: string;
  advice: string;
}

export const CUSTOMER_BRIEFS: Record<BriefId, BriefDefinition> = {
  'launch-window': {
    title: 'Launch weekend', client: 'Marquee Tickets', weeks: 4, qualifyingWeeks: 2, feeCents: 480000,
    terms: 'Deliver 1 extra CUw of launch traffic and fulfill at least 85% of ordinary demand on the same paying product for two weeks in a row.',
    advice: 'Leave spare serving compute and memory for another model copy plus 0.25 MU of launch sessions after your regular customers have been served.',
  },
  'lean-service': {
    title: 'Lower the compute bill', client: 'Private hosting client', weeks: 6, qualifyingWeeks: 2, feeCents: 660000,
    terms: 'Beat the lowest settled compute bill from the last three weeks by 10% while the same private hosting contract bills and receives at least 95% of its requested work. Hold both targets for two weeks in a row.',
    advice: 'Right-size your cloud reservation or reduce owned GPU work. The comparison includes cloud rent, site and rack upkeep, and metered GPU work.',
  },
  'research-sprint': {
    title: 'Research fellowship', client: 'Linden Foundation', weeks: 6, qualifyingWeeks: 1, feeCents: 400000,
    terms: 'Start and finish one new research project during the fellowship. Previously started projects are ineligible.',
    advice: 'Choose a discovery you can fund and reserve research compute. Your team supplies matching points each week.',
  },
  'model-acceptance': {
    title: 'Model acceptance test', client: 'Northline Press', weeks: 8, qualifyingWeeks: 1, feeCents: 600000,
    terms: 'Start a new training run, finish its model and pass the Basic Chat eligibility gate on a held-out capability evaluation during the commission.',
    advice: 'Choose a prepared dataset that improves the source model. Leave time and development compute for testing.',
  },
  'compact-efficiency': {
    title: 'A capable small assistant', client: 'Pocket Desk', weeks: 6, qualifyingWeeks: 2, feeCents: 900000,
    terms: 'Deliver 1,000 client requests in each of two consecutive weeks. The model needs conversation 45, reliability 88%, at most 1 MU of resident memory, and at most 0.15 serving CUw per 1,000 standard requests.',
    advice: 'Use an existing model with a paid Expanded capabilities report. Small foundations, lower precision or an efficient deployment can qualify; their earned quality still has to meet the targets. Leave capacity for an extra model copy and 0.25 MU of sessions.',
  },
  'visual-documents': {
    title: 'Read the visual record', client: 'Meridian Archives', weeks: 6, qualifyingWeeks: 2, feeCents: 1400000,
    terms: 'Deliver 2,000 client requests in each of two consecutive weeks. The model needs documents 65, multimodal 60, reliability 90%, at most 16 MU of resident memory, and at most 1.2 serving CUw per 1,000 standard requests.',
    advice: 'Earn the document and visual skills from suitable training evidence, then run Expanded capabilities and Reasoning, context & multimodal tests. Saved paid reports are accepted. The client workload needs an extra model copy and 0.25 MU of sessions.',
  },
  'long-context-review': {
    title: 'Keep the whole case in view', client: 'Alder Case Review', weeks: 6, qualifyingWeeks: 2, feeCents: 1600000,
    terms: 'Deliver 2,000 long-input client requests in each of two consecutive weeks. The model needs documents 65, long context 70, reliability 90%, at most 24 MU of resident memory, and at most 1.5 serving CUw per 1,000 standard requests.',
    advice: 'Extended context and grounded training are possible approaches. Both Expanded capabilities and Reasoning, context & multimodal reports must be paid and retained. Long-input requests use 50% more work than the standard reference, plus an extra model copy and 0.5 MU of sessions.',
  },
  'support-at-scale': {
    title: 'Support at scale', client: 'Relay Customer Care', weeks: 6, qualifyingWeeks: 2, feeCents: 1800000,
    terms: 'Deliver 10,000 client requests in each of two consecutive weeks. The model needs conversation 65, reliability 90%, false refusals at most 5%, confident errors at most 16%, at most 6 MU of memory, and at most 0.5 serving CUw per 1,000 standard requests.',
    advice: 'A compact model with paid behavior tuning can balance helpful answers against mistakes. A paid Expanded capabilities report is required. Reserve the shown client workload and an extra model copy plus 0.25 MU of sessions alongside ordinary customers.',
  },
  'consultancy-pilot': {
    title: 'Deliver the chat pilot', client: 'Alder & Finch', weeks: 8, qualifyingWeeks: 1, feeCents: 800000,
    terms: 'Train a model, pass its Basic Chat evaluation and launch that model as a live Basic Chat product by the end of Week 8.',
    advice: 'Prepare your training data, adapt the model, test it and complete deployment. Handover occurs as soon as the pilot is live.',
  },
};
