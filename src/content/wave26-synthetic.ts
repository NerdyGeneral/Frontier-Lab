export const SYNTHETIC_CONTENT_VERSION = '0.26.0';
const U = 1_000_000_000;
/** Application prices are authored game rules. S1/S2 discovery costs are from
 * the Studio expansion specification; every application pays separately. */
export const SYNTHETIC_RULES = {
  protocol: 'targeted-synthetic-1' as const, auditProtocol: 'synthetic-audit-1' as const,
  catalogId: 'audited-synthetic', recipeId: 'targeted-synthetic',
  candidateUnits: 100, minimumSourceUnits: 100, minimumTeacherScoreBps: 6000,
  minimumSourceQualityBps: 6000, minimumTeacherReliabilityBps: 6000,
  generationFeeCents: 150_000, reviewFeeCents: 50_000, trainingFeeCents: 100_000,
  generationBaseWork: 8 * U, generationWorkPerMlWeek: 16 * U,
  reviewStaff: 2 * U, auditStaff: U, auditWork: 2 * U, auditMemory: U,
  maximumWeeklyStaff: U, sourceOverlapUnits: 20, holdoutOverlapUnits: 10,
  trainingWork: 12 * U, trainingEvidence: 40, maximumTargetGainBps: 1500, teacherMarginBps: 500,
  maximumJobs: 32, maximumReceiptBuckets: 64, requestPriority: 45,
} as const;
