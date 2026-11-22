import type { BatchOrderDefinition, BatchOrderId } from '../contracts/wave14-batch';
import { RESOURCE_SCALE as U } from '../contracts/types';

export const BATCH_COMMANDS = ['set_batch_job_placement', 'install_batch_scheduler', 'accept_batch_job', 'set_batch_job_paused', 'cancel_batch_job'] as const;
export const BATCH_RULES = {
  researchId: 'R12', schedulerFeeCents: 150_000, schedulerWorkCUw: 2 * U, schedulerStaff: 2 * U,
  maximumWeeklySchedulerWorkCUw: U, maximumWeeklySchedulerStaff: U, schedulerMemoryMU: U, schedulerPriority: 35,
  servingPriorityBase: 100, jobWorkspaceMU: U / 4, commercialStaffPerWeek: U / 4,
  weeklyWorkCapsCUw: [2 * U, 4 * U, 8 * U, 16 * U] as readonly number[],
  maximumClaimsPerOrder: 3, maximumJobsPerCompany: 9, maximumJobs: 36, maximumSchedulers: 4, maximumReceiptBuckets: 24,
} as const;

/** Finite benign work orders from existing developer customers; they create no new market accounts. */
export const BATCH_ORDERS: readonly BatchOrderDefinition[] = [
  { id: 'archive-tagging', name: 'Archive tagging', description: 'Prepare a bounded archive of benign document labels for an existing developer customer.',
    domain: 'documents', minimumScoreBps: 3000, minimumReliabilityBps: 8000,
    requests: 40_000, inputTokensPerRequest: 2000, outputTokensPerRequest: 250, windowWeeks: 4,
    inputPriceCentsPerMillion: 5000, outputPriceCentsPerMillion: 25_000 },
  { id: 'code-index', name: 'Code index', description: 'Generate a fixed backlog of benign code descriptions for an existing developer customer.',
    domain: 'coding', minimumScoreBps: 5000, minimumReliabilityBps: 8000,
    requests: 60_000, inputTokensPerRequest: 2500, outputTokensPerRequest: 500, windowWeeks: 6,
    inputPriceCentsPerMillion: 5000, outputPriceCentsPerMillion: 25_000 },
  { id: 'longform-digest', name: 'Long-form digest', description: 'Process a fixed collection of long benign documents for an existing developer customer.',
    domain: 'documents', minimumScoreBps: 5500, minimumReliabilityBps: 9000,
    requests: 60_000, inputTokensPerRequest: 5000, outputTokensPerRequest: 500, windowWeeks: 6,
    inputPriceCentsPerMillion: 5000, outputPriceCentsPerMillion: 25_000 },
];
export const BATCH_ORDER_BY_ID: Readonly<Record<BatchOrderId, BatchOrderDefinition>> = Object.fromEntries(BATCH_ORDERS.map(order => [order.id, order])) as Record<BatchOrderId, BatchOrderDefinition>;
