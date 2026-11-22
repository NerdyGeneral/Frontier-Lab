export const SPECIALIST_BRIEF_IDS = ['compact-efficiency', 'visual-documents', 'long-context-review', 'support-at-scale'] as const;
export type SpecialistBriefId = typeof SPECIALIST_BRIEF_IDS[number];
export const OPTIONAL_BRIEF_IDS = ['launch-window', 'lean-service', 'research-sprint', 'model-acceptance', ...SPECIALIST_BRIEF_IDS] as const;
export type OptionalBriefId = typeof OPTIONAL_BRIEF_IDS[number];
export type BriefId = OptionalBriefId | 'consultancy-pilot';
export type CustomerBriefCommand = { kind: 'accept_customer_brief'; briefId: OptionalBriefId };

export interface BriefBinding {
  targetId: string | null;
  contractGeneration: number;
  baselineCostCents: number;
  /** New commissions retain the selected model's paid reports and delivered client weeks. */
  specialist?: {
    version: 1;
    capabilityReportId: string;
    advancedReportId: string | null;
    deliveryWeeks: number[];
  };
}

export interface CustomerBrief extends BriefBinding {
  id: BriefId;
  status: 'active' | 'completed' | 'expired';
  startedWeek: number;
  deadlineWeek: number;
  finishedWeek: number | null;
  qualifyingWeeks: number;
  feedback: string;
}
