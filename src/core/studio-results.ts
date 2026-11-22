import { modelResearchQuoteForLevel, MODEL_RESEARCH_FOCUSES } from '../modules/model-research';
import { canChooseStaffSpecialty, careerOutput, careerSalary, staffDisplayName } from '../modules/staff-careers';
import { formatWorkPoints, getStaffPotentialOutput, WORK_POINT_LABELS } from '../modules/workforce-points';
import { CUSTOMER_BRIEFS } from '../content/customer-briefs';
import { getModelDevelopmentRows } from '../modules/model-development';
import { modelScoreHighlights } from './model-score-highlights';
import { CONTENT } from '../content/catalog';
import type { GameState } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { evaluationSuite } from '../modules/lab-evaluation';
import { formatMoney } from './math';
import type { StudioProject } from './studio';
import { trainingBaseUnavailableReason, type StudioIntent } from './studio-tasks';

export const STUDIO_RESULT_LIMIT = 200;
export type StudioResultKind = 'data' | 'training' | 'evaluation' | 'research' | 'deployment' | 'staff' | 'brief';
export type StudioResultTarget =
  | { kind: 'intent'; intent: StudioIntent }
  | { kind: 'research'; researchId: string; projectId: string }
  | { kind: 'product'; productId: string; deploymentId: string; modelId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'resources'; projectId?: string }
  | { kind: 'staff'; staffId?: string }
  | { kind: 'save' };
export interface StudioResultAction { label: string; target: StudioResultTarget }
export interface StudioResult {
  key: string;
  kind: StudioResultKind;
  week: number;
  sourceId: string;
  title: string;
  summary: string;
  details: readonly { label: string; value: string }[];
  action: StudioResultAction | null;
  developmentAction?: StudioResultAction;
  unavailableReason?: string;
}
export interface StudioResultFlag { reviewed: boolean; dismissed: boolean }
export type StudioResultFlags = Readonly<Record<string, StudioResultFlag>>;
export interface StudioAttention {
  key: string;
  title: string;
  detail: string;
  tone?: 'warning' | 'info';
  action?: StudioResultAction;
}
export interface StudioResultFilter {
  kind: StudioResultKind | 'all';
  week: number | null;
  visibility: 'all' | 'unreviewed' | 'reviewed' | 'dismissed';
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const resultKey = (kind: StudioResultKind, sourceId: string, week: number, identity: string) =>
  `${kind}:${JSON.stringify([sourceId, week, identity])}`;
const units = (value: number) => Number((value / RESOURCE_SCALE).toFixed(2)).toString();

/** Historical outcomes come only from retained owned records and their actual
 * completion/activation dates. UI acknowledgement metadata is never a source.
 * No clock, RNG, save, command, or simulation state is touched by this selector. */
export function selectStudioResults(game: GameState): readonly StudioResult[] {
  const owner = game.playerCompanyId;
  const result = new Map<string, StudioResult>();
  const realWeek = (week: number | null | undefined): week is number =>
    Number.isSafeInteger(week) && (week as number) >= 0 && (week as number) <= game.week;
  const own = <T extends { companyId: string }>(record: Record<string, T>, id: string) => {
    const item = Object.hasOwn(record, id) ? record[id] : undefined;
    return item?.companyId === owner ? item : undefined;
  };
  const packet = (id: string) => {
    const item = Object.hasOwn(game.slices.data.packets, id) ? game.slices.data.packets[id] : undefined;
    return item && (item.companyId === owner || (!item.companyId && item.id === CONTENT.starterData.id)) ? item : undefined;
  };
  const add = (entry: StudioResult) => { if (!result.has(entry.key)) result.set(entry.key, entry); };

  const developmentAction = (modelId: string): StudioResultAction | undefined => trainingBaseUnavailableReason(game, modelId)
    ? undefined : { label: 'Continue training this version', target: { kind: 'intent', intent: { kind: 'training-base', baseModelId: modelId } } };

  for (const job of Object.values(game.slices.data.preparationJobs)) {
    if (job.companyId !== owner || job.status !== 'complete' || !realWeek(job.completedWeek)) continue;
    const data = packet(job.packetId), week = job.completedWeek;
    add({ key: resultKey('data', job.id, week, job.packetId), kind: 'data', week, sourceId: job.id,
      title: job.kind === 'curate' ? 'Data curation complete' : job.kind === 'deduplicate' ? 'Data deduplication complete' : 'Data preparation complete',
      summary: data?.name ?? 'Completed dataset is unavailable',
      details: [{ label: 'Dataset', value: data?.name ?? 'Unavailable in this lab' },
        { label: 'Preparation', value: `${formatWorkPoints(job.completedStaff)} points performed` },
        ...(data ? [{ label: 'Ready data', value: `${data.readyUnits.toLocaleString('en-US')} units` }] : [])],
      action: data?.prepared ? { label: 'Train with this dataset', target: { kind: 'intent', intent: { kind: 'training-data', packetId: job.packetId } } } : null,
      ...(!data?.prepared ? { unavailableReason: 'This preparation is in your history, but its dataset is no longer available. Choose another dataset in Training.' } : {}),
    });
  }
  for (const job of Object.values(game.slices.data.syntheticJobs ?? {})) {
    if (job.companyId !== owner || (job.phase !== 'ready' && job.phase !== 'complete') || !realWeek(job.completedWeek)) continue;
    const data = packet(job.outputPacketId), week = job.completedWeek;
    const available = data?.prepared && (job.availableWeek ?? Infinity) <= game.week;
    add({ key: resultKey('data', job.id, week, job.outputPacketId), kind: 'data', week, sourceId: job.id,
      title: 'Synthetic data audit complete', summary: data?.name ?? `${job.domain} synthetic data`,
      details: [{ label: 'Domain', value: job.domain },
        { label: 'Accepted data', value: `${job.audit?.acceptedUnits.toLocaleString('en-US') ?? 'Not recorded'} units` },
        { label: 'Available for training', value: job.availableWeek === null ? 'Not recorded' : `Week ${job.availableWeek}` }],
      action: available ? { label: 'Train with this dataset', target: { kind: 'intent', intent: { kind: 'training-data', packetId: job.outputPacketId } } } : null,
      ...(!available ? { unavailableReason: job.availableWeek !== null && job.availableWeek > game.week
        ? `The audit is complete. The prepared dataset becomes available in Week ${job.availableWeek}.`
        : 'This checked dataset is no longer available. Choose another dataset to continue.' } : {}),
    });
  }
  for (const run of Object.values(game.slices.models.trainingRuns)) {
    if (run.companyId !== owner || run.status !== 'complete' || !realWeek(run.completedWeek)) continue;
    const model = own(game.slices.models.versions, run.outputModelId), base = own(game.slices.models.versions, run.baseModelId), week = run.completedWeek;
    const change = base && model ? modelScoreHighlights(getModelDevelopmentRows(base, model, run.plan?.kind)) : undefined;
    add({ key: resultKey('training', run.id, week, run.outputModelId), kind: 'training', week, sourceId: run.id,
      title: 'Training complete', summary: model?.name ?? 'Trained model is unavailable',
      details: [{ label: 'Trained model', value: model?.name ?? 'Unavailable in this lab' },
        { label: 'Method', value: run.plan?.recipeName ?? run.recipeId },
        { label: run.plan?.kind === 'foundation' ? 'Reference model' : 'Base model', value: base?.name ?? 'Original base unavailable' },
        ...(change?.gain ? [{ label: run.plan?.kind === 'foundation' ? 'Advantage over reference' : 'Largest improvement', value: change.gain }] : []),
        ...(change?.loss ? [{ label: run.plan?.kind === 'foundation' ? 'Weakness against reference' : 'Largest tradeoff', value: change.loss }] : []),
        { label: 'Work performed', value: `${units(run.completedWork)} CUw` },
        ...(model ? [{ label: 'Conversation', value: `${model.capabilityBps.conversation / 100}` }, { label: 'Reliability', value: `${model.reliabilityBps / 100}` }] : [])],
      action: model ? { label: 'Test this model', target: { kind: 'intent', intent: { kind: 'training-result', runId: run.id } } } : null,
      developmentAction: developmentAction(run.outputModelId),
      ...(!model ? { unavailableReason: 'This run is in your history, but its model is no longer available. Choose another model in the Test station.' } : {}),
    });
  }
  // A report is already the durable result. Do not also emit its evaluation run.
  for (const report of Object.values(game.slices.models.reports)) {
    if (report.companyId !== owner || !report.heldOut || !realWeek(report.week)) continue;
    const model = own(game.slices.models.versions, report.modelId), suite = evaluationSuite(report.suiteId)?.name ?? 'Basic conversation';
    add({ key: resultKey('evaluation', report.id, report.week, report.modelId), kind: 'evaluation', week: report.week, sourceId: report.id,
      title: report.challenge?.passed ? 'Challenge title earned' : report.challenge ? 'Challenge evaluation complete' : Object.values(game.slices.models.developmentPlans ?? {}).some(plan => plan.reportId === report.id) ? 'Development plan ready for review' : report.scenarioStart ? 'Starting test results' : 'Evaluation complete',
      summary: `${model?.name ?? 'Candidate unavailable'} · ${suite}`,
      details: [{ label: 'Candidate', value: model?.name ?? 'Unavailable in this lab' }, { label: 'Evaluation', value: suite },
        { label: 'Cases passed', value: `${report.passedCases} / ${report.cases.length}` },
        ...(report.challenge ? [{ label: 'Challenge', value: report.challenge.earnedTitle ?? 'Improve this model to attempt the tier again.' }] : []),
        { label: 'Conversation', value: `${report.capabilityBps.conversation / 100}` }, { label: 'Reliability', value: `${report.reliabilityBps / 100}` }],
      action: model ? { label: 'Review this report', target: { kind: 'intent', intent: { kind: 'report', reportId: report.id } } } : null,
      developmentAction: developmentAction(report.modelId),
      ...(!model ? { unavailableReason: 'You can read this report, but the model it tested is no longer available.' } : {}),
    });
  }
  for (const project of Object.values(game.slices.research.projects)) {
    if (project.companyId !== owner || project.status !== 'complete' || !realWeek(project.completedWeek)) continue;
    const definition = CONTENT.research.find(item => item.id === project.researchId), week = project.completedWeek;
    add({ key: resultKey('research', project.id, week, project.researchId), kind: 'research', week, sourceId: project.id,
      title: 'Research complete', summary: definition?.name ?? project.researchId,
      details: [{ label: 'Discovery', value: definition?.name ?? project.researchId },
        { label: 'Available', value: project.availableWeek === undefined ? 'Availability not recorded' : `Week ${project.availableWeek}` },
        { label: 'Work performed', value: `${units(project.completedWork)} CUw · ${formatWorkPoints(project.completedStaff)} ${WORK_POINT_LABELS[project.role]} points` },
        ...(definition ? [{ label: 'Effect', value: definition.description }] : [])],
      action: { label: 'View this discovery', target: { kind: 'research', researchId: project.researchId, projectId: project.id } },
    });
  }
  for (const project of Object.values(game.slices.research.modelResearch ?? {})) {
    if (project.companyId !== owner || project.status !== 'complete' || !realWeek(project.availableWeek)) continue;
    const week = project.availableWeek;
    add({ key: resultKey('research', project.id, week, String(project.level)), kind: 'research', week, sourceId: project.id,
      title: 'Architecture discovery available', summary: `Level ${project.level} · ${modelResearchQuoteForLevel(project.level).unlock}`,
      details: [{ label: 'Focus', value: MODEL_RESEARCH_FOCUSES[project.focus ?? 'balanced'].name }, { label: 'Available', value: `Week ${week}` }, { label: 'Research work', value: `${units(project.completedWork)} CUw · ${formatWorkPoints(project.completedStaff)} Research points` }],
      action: { label: 'Explore architecture research', target: { kind: 'intent', intent: { kind: 'task', task: 'architecture-research' } } },
    });
  }
  for (const deployment of Object.values(game.slices.products.deployments)) {
    // readyWeek is the recorded activation week, not an inferred completion date.
    if (deployment.companyId !== owner || deployment.status !== 'active' || !realWeek(deployment.readyWeek)) continue;
    const product = own(game.slices.products.offers, deployment.productId), model = own(game.slices.models.versions, deployment.modelId), week = deployment.readyWeek;
    const available = !!product && !!model && product.deploymentId === deployment.id;
    add({ key: resultKey('deployment', deployment.id, week, deployment.modelId), kind: 'deployment', week, sourceId: deployment.id,
      title: deployment.scenarioStart ? 'Starting deployment' : 'Product activated', summary: product?.name ?? 'Product unavailable',
      details: [{ label: 'Product', value: product?.name ?? 'Unavailable in this lab' }, { label: 'Deployed candidate', value: model?.name ?? 'Unavailable in this lab' },
        { label: 'Activation', value: `Week ${week}` }, { label: 'Deployment work', value: `${formatWorkPoints(deployment.completedStaff)} Design points performed` }],
      action: available ? { label: 'View this deployment', target: { kind: 'product', productId: deployment.productId, deploymentId: deployment.id, modelId: deployment.modelId } } : null,
      ...(!available ? { unavailableReason: 'This model is no longer running the product. Open the product to see its current model and status.' } : {}),
    });
  }
  for (const staff of Object.values(game.slices.company.staff)) {
    if (staff.companyId !== owner || staff.scenarioStart || !realWeek(staff.readyWeek)) continue;
    const definition = CONTENT.staff.find(item => item.id === staff.role);
    add({ key: resultKey('staff', staff.id, staff.readyWeek, staff.role), kind: 'staff', week: staff.readyWeek, sourceId: staff.id,
      title: 'Onboarding complete', summary: definition?.name ?? staff.role,
      details: [{ label: 'Role', value: definition?.name ?? staff.role }, { label: 'Hired', value: `Week ${staff.hiredWeek}` },
        { label: 'Ready to work', value: `Week ${staff.readyWeek}` }, { label: 'Current weekly output', value: Object.entries(game.slices.company.passiveWorkforce ? careerOutput(staff) : getStaffPotentialOutput(staff.role, staff.assignedFte)).filter(([, amount]) => amount > 0).map(([role, amount]) => `${formatWorkPoints(amount)} ${WORK_POINT_LABELS[role as typeof staff.role]}`).join(' · ') + ' points / week' },
        ...(definition ? [{ label: 'Weekly pay', value: `${formatMoney(careerSalary(staff, definition.weeklyCents))} / week` }] : [])],
      action: { label: 'View team output', target: { kind: 'staff', staffId: staff.id } },
    });
  }
  for (const brief of Object.values(game.slices.campaign.customerBriefs ?? {})) {
    if (brief.status === 'active' || !realWeek(brief.finishedWeek)) continue;
    const definition = CUSTOMER_BRIEFS[brief.id];
    const delivered = brief.status === 'completed';
    add({
      key: resultKey('brief', brief.id, brief.finishedWeek, brief.status),
      kind: 'brief', week: brief.finishedWeek, sourceId: brief.id,
      title: definition.title,
      summary: delivered ? `${definition.client} paid ${formatMoney(definition.feeCents)}.` : `Missed the week ${brief.deadlineWeek} deadline for ${definition.client}.`,
      details: [{ label: 'Delivery target', value: definition.terms }, { label: 'Final progress', value: brief.feedback }],
      action: { label: 'Open customer briefs', target: { kind: 'intent', intent: { kind: 'panel', panel: 'customer-briefs' } } },
    });
  }
  return [...result.values()].sort((a, b) => b.week - a.week || compare(a.key, b.key)).slice(0, STUDIO_RESULT_LIMIT);
}

/** The bounded evidence window is selected before any attention/type filter. */
export function filterStudioResults(results: readonly StudioResult[], flags: StudioResultFlags, filter: StudioResultFilter): readonly StudioResult[] {
  return results.slice(0, STUDIO_RESULT_LIMIT).filter(item => {
    const flag = flags[item.key];
    if (filter.kind !== 'all' && item.kind !== filter.kind) return false;
    if (filter.week !== null && item.week !== filter.week) return false;
    if (filter.visibility === 'dismissed') return !!flag?.dismissed;
    if (flag?.dismissed) return false;
    return filter.visibility === 'all' || (filter.visibility === 'reviewed' ? !!flag?.reviewed : !flag?.reviewed);
  });
}

/** Current conditions deliberately have no historical completion date and no
 * persisted acknowledgement flag. Their underlying records decide visibility. */
export function selectStudioAttention(game: GameState, projects: readonly StudioProject[], issues: readonly StudioAttention[] = []): readonly StudioAttention[] {
  const owner = game.playerCompanyId, attention = new Map<string, StudioAttention>();
  const add = (item: StudioAttention) => { if (!attention.has(item.key)) attention.set(item.key, item); };
  for (const issue of issues) add(issue);
  for (const plan of Object.values(game.slices.models.developmentPlans ?? {})) {
    if (plan.status === 'blocked' || plan.status === 'review') add({ key: 'development:' + plan.id, title: plan.name, detail: plan.message, tone: plan.status === 'blocked' ? 'warning' : 'info', action: { label: 'Review development plan', target: { kind: 'intent', intent: { kind: 'panel', panel: 'development-plans' } } } });
  }
  for (const project of projects) {
    if (project.status === 'blocked' && project.bottleneck) add({ key: `project:${project.id}`, title: project.title,
      detail: project.bottleneck, tone: 'warning', action: { label: 'Fix this problem', target: { kind: 'resources', projectId: project.id } } });
    else if (project.status === 'waiting') add({ key: `project:${project.id}`, title: project.title,
      detail: project.detail, tone: 'info', action: { label: 'View this project', target: { kind: 'project', projectId: project.id } } });
  }
  for (const staff of Object.values(game.slices.company.staff)) {
    if (staff.companyId !== owner) continue;
    const definition = CONTENT.staff.find(item => item.id === staff.role);
    if (staff.readyWeek <= game.week) {
      if (canChooseStaffSpecialty(staff)) add({
        key: `career:${staff.id}`, title: `${staffDisplayName(staff)} can choose a specialty`, tone: 'info',
        detail: 'Choose a career path to change the points this employee contributes each week.',
        action: { label: 'Choose a specialty', target: { kind: 'staff', staffId: staff.id } },
      });
      continue;
    }
    add({ key: `onboarding:${staff.id}`, title: `${definition?.name ?? staff.role} is onboarding`, tone: 'info',
      detail: `Ready in Week ${staff.readyWeek}. ${definition ? `${formatMoney(definition.weeklyCents)} in wages is already due each week. ` : ''}They can start work after onboarding.`,
      action: { label: 'Review staff readiness', target: { kind: 'staff', staffId: staff.id } } });
  }
  const fleet = game.slices.compute.fleets[owner];
  if (fleet?.lastBottleneck) add({ key: 'compute:current', title: 'Compute needs attention', detail: fleet.lastBottleneck, tone: 'warning',
    action: { label: 'Review people and compute', target: { kind: 'resources' } } });
  return [...attention.values()];
}
