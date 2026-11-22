import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import type { CommandPayload, GameContent, GameState, JobStatus } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { SYSTEM_RULES, VARIANT_RULES } from '../content/wave4-research';
import type { SystemRolloutKind } from '../contracts/wave4-research';
import { getCampaignView } from '../modules/campaign-progress';
import { getComputePools } from '../modules/compute-pools';
import { freezeDeep } from './canonical';
import { mulDiv } from './math';
import { getGameView } from './selectors';

export type StudioStatus = 'idle' | 'working' | 'waiting' | 'blocked' | 'complete';
export type StudioStationId = 'data' | 'lab' | 'models' | 'people' | 'compute' | 'product';
export type StudioPanelId = 'data' | 'lab-projects' | 'models' | 'people' | 'compute' | 'product' | 'developer-api' | 'research' | 'infrastructure' | 'chips' | 'campaign' | 'synthetic-data' | 'release-desk' | 'campus' | 'applied-research' | 'capacity-forecast' | 'agents' | 'compute-costs';
export type StudioProjectKind = 'data' | 'synthetic data' | 'training' | 'evaluation' | 'deployment' | 'research' | 'facility' | 'site profile' | 'rack' | 'chip' | 'fabrication' | 'canary' | 'private appliance' | 'model application' | 'system rollout' | 'handover' | 'rollback';
export interface StudioProject {
  id: string; title: string; kind: StudioProjectKind; status: StudioStatus;
  progressBps: number; detail: string; bottleneck: string;
  targetPanel: StudioPanelId; stationId: StudioStationId; startedWeek: number;
}
export interface StudioStation {
  id: StudioStationId; title: string; subtitle: string; status: StudioStatus;
  detail: string; bottleneck: string; targetPanel: StudioPanelId;
  projectId: string | null; progressBps: number | null;
}
export interface StudioMilestone {
  id: 'dataReady' | 'trained' | 'evaluated' | 'deployed' | 'firstSale';
  label: string; complete: boolean; targetPanel: StudioPanelId; stationId: StudioStationId;
}
export interface StudioView {
  week: number; companyName: string; roomTier: 'garage' | 'studio' | 'campus';
  summary: {
    cashCents: number; availableCashCents: number; reservedCashCents: number;
    runwayWeeks: number | null; weeklyBaseCostCents: number; revenueCents: number;
    /** Headcounts include the founder; FTE and resource amounts retain RESOURCE_SCALE. */
    readyStaff: number; onboardingStaff: number; totalStaff: number;
    workforceFte: number; grantedFte: number; cloudCU: number; ownedCU: number; totalCU: number;
    executedCUw: number; memoryMU: number; memoryInUseMU: number; queuedCount: number;
  };
  stations: StudioStation[]; projects: StudioProject[]; milestones: StudioMilestone[];
  nextAction: {
    title: string; detail: string; targetPanel: StudioPanelId; stationId: StudioStationId;
    stage: 'prepare' | 'train' | 'evaluate' | 'release' | 'earn' | 'grow'; actionLabel: string;
  };
}

const percent = (done: number, required: number) => required > 0 ? Math.max(0, Math.min(10000, mulDiv(done, 10000, required))) : 10000;
const units = (value: number) => Number((value / RESOURCE_SCALE).toFixed(2)).toString();
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const statusOrder: Record<StudioStatus, number> = { blocked: 0, working: 1, waiting: 2, idle: 3, complete: 4 };

const rolloutPanels: Record<SystemRolloutKind, StudioPanelId> = {
  'run-supervisor': 'applied-research', 'research-assistant': 'applied-research', 'adapter-bank': 'applied-research',
  deduplication: 'data', 'capacity-forecast': 'capacity-forecast', 'action-receipts': 'agents', 'cost-accounting': 'compute-costs',
};

function designWork(work: { completedWork: number; requiredWork: number; completedStaff: number; requiredStaff: number }) {
  return {
    progressBps: Math.min(percent(work.completedWork, work.requiredWork), percent(work.completedStaff, work.requiredStaff)),
    detail: `${formatWorkPoints(work.completedStaff)} / ${formatWorkPoints(work.requiredStaff)} Design points · ${units(work.completedWork)} / ${units(work.requiredWork)} development CUw`,
  };
}

function ambitionAction(state: GameState, content: GameContent): StudioView['nextAction'] {
  const campaign = getCampaignView(state, content);
  const remaining = campaign.routes.filter(route => route.achievedWeek === null);
  const completion = (route: typeof remaining[number]) => route.criteria.filter(item => item.met).length / route.criteria.length;
  const closest = remaining.sort((a, b) => b.streak - a.streak || completion(b) - completion(a))[0];
  const base = { stage: 'grow', targetPanel: 'campaign', stationId: 'product' } as const;
  if (!closest) return { ...base, title: 'All company ambitions earned', detail: 'Review when you earned each ending. Your lab can keep developing models and serving customers.', actionLabel: 'View earned ambitions' };
  const next = closest.criteria.find(item => !item.met);
  return { ...base, title: closest.name, actionLabel: 'Review ambition progress',
    detail: next ? `${next.label} is at ${next.current}. The goal is ${next.target}. Open the requirements to see where to work on it.`
      : `All requirements met. Keep them up for ${closest.requiredWeeks - closest.streak} more weeks to earn this ambition.` };
}

/** "Running" is eligibility in the engine, not proof that a grant produced work. */
function jobStatus(status: JobStatus, lastProgress: number, bottleneck: string): StudioStatus {
  if (status === 'complete') return 'complete';
  if (status === 'paused') return 'waiting';
  if (bottleneck) return 'blocked';
  return lastProgress > 0 ? 'working' : 'waiting';
}

function queuedStation(payload: CommandPayload): StudioStationId | null {
  switch (payload.kind) {
    case 'prepare_data': case 'buy_data': case 'curate_data': case 'deduplicate_data': return 'data';
    case 'start_synthetic_generation': case 'start_synthetic_review': case 'set_synthetic_job_paused': return 'data';
    case 'start_training': return 'lab';
    case 'evaluate_model': return 'models';
    case 'hire_staff': case 'specialize_staff': case 'dismiss_staff': case 'assign_founder': case 'set_staff_allocation': return 'people';
    case 'allocate_compute': case 'set_cloud_capacity': case 'set_batch_capacity':
    case 'start_facility_specialization': case 'set_facility_specialization_paused': case 'start_chip_successor':
    case 'order_rack': case 'install_rack': case 'set_rack_parked': case 'start_facility': case 'fund_facility_stage': return 'compute';
    case 'accept_customer_brief': case 'deploy_product': case 'set_product_terms': case 'set_product_paused':
    case 'start_release_canary': case 'stop_release_canary': case 'accept_private_appliance_order': return 'product';
    default: return null;
  }
}

/** Presentation-only adapter. It neither advances the engine nor writes preferences or saves. */
export function getStudioView(state: GameState, content: GameContent = CONTENT): StudioView {
  const owner = state.playerCompanyId, company = state.slices.company.companies[owner];
  const fleet = state.slices.compute.fleets[owner], view = getGameView(state, content);
  const pools = getComputePools(state, owner, content);
  const projects: StudioProject[] = [];
  const mine = <T extends { companyId: string }>(items: Record<string, T>) => Object.values(items).filter(item => item.companyId === owner);
  const labJobs = new Map(view.labJobs.map(job => [job.id, job]));

  for (const job of mine(state.slices.data.preparationJobs)) {
    const item = labJobs.get(job.id)!;
    projects.push({ ...item, kind: 'data', status: jobStatus(job.status, job.lastProgress, job.lastBottleneck),
      targetPanel: 'data', stationId: 'data', startedWeek: job.startedWeek });
  }
  for (const job of mine(state.slices.data.syntheticJobs ?? {})) {
    const phaseLabels = { generating: 'Teacher generation', 'awaiting-review': 'Generation complete · fund review & audit', reviewing: 'Data review', auditing: 'Independent overlap audit', ready: `Audited packet available in Week ${job.availableWeek}`, complete: 'Audited packet ready for training' };
    const waiting = job.paused || job.phase === 'awaiting-review' || job.phase === 'ready';
    projects.push({ id: job.id, title: `${job.domain[0].toUpperCase() + job.domain.slice(1)} synthetic data`, kind: 'synthetic data',
      status: job.phase === 'complete' ? 'complete' : waiting ? 'waiting' : jobStatus('running', job.lastProgress, job.lastBottleneck),
      progressBps: Math.min(10000, mulDiv(job.generation.completedWork, 4000, job.generation.requiredWork)
        + mulDiv(job.review.completedStaff, 3000, job.review.requiredStaff)
        + mulDiv(job.auditCompute.completedWork, 1500, job.auditCompute.requiredWork)
        + mulDiv(job.auditStaff.completedStaff, 1500, job.auditStaff.requiredStaff)),
      detail: `${job.paused ? 'Paused · ' : ''}${phaseLabels[job.phase]}${job.audit ? ` · ${job.audit.acceptedUnits} accepted units` : ''}`,
      bottleneck: waiting || job.phase === 'complete' ? '' : job.lastBottleneck,
      targetPanel: 'synthetic-data', stationId: 'data', startedWeek: job.startedWeek });
  }
  for (const run of mine(state.slices.models.trainingRuns)) {
    const item = labJobs.get(run.id)!;
    // Teacher generation has an explanatory message in lastBottleneck even while it progresses.
    const teacherProgress = !!run.plan?.teacher && run.lastProgress > 0 && run.lastBottleneck.startsWith('Teacher generation is separate');
    projects.push({ ...item, kind: 'training', status: jobStatus(run.status, run.lastProgress, teacherProgress ? '' : run.lastBottleneck),
      targetPanel: 'lab-projects', stationId: 'lab', startedWeek: run.startedWeek });
  }
  for (const run of mine(state.slices.models.evaluationRuns)) {
    const item = labJobs.get(run.id)!;
    projects.push({ ...item, kind: 'evaluation', status: jobStatus(run.status, run.lastProgress || (run.lastBottleneck ? 0 : run.completedStaff), run.lastBottleneck),
      targetPanel: 'models', stationId: 'models', startedWeek: run.startedWeek });
  }
  for (const run of mine(state.slices.models.applicationRuns ?? {})) {
    const work = designWork(run);
    const status = jobStatus(run.status, run.lastProgress || run.completedStaff, run.lastBottleneck);
    const source = state.slices.models.versions[run.sourceModelId];
    projects.push({ id: run.id, title: `${VARIANT_RULES[run.variant].name} · ${source?.name ?? run.sourceModelId}`, kind: 'model application',
      status, progressBps: work.progressBps, detail: status === 'complete' ? 'Variant created and available for evaluation' : run.status === 'paused' ? 'Paused · ' + work.detail : work.detail,
      bottleneck: status === 'blocked' ? run.lastBottleneck : '', targetPanel: 'applied-research', stationId: 'models', startedWeek: run.startedWeek });
  }
  for (const rollout of mine(state.slices.research.systemRollouts ?? {})) {
    const work = designWork(rollout);
    const status = rollout.status === 'active' ? 'complete' : rollout.status === 'ready' ? 'waiting'
      : jobStatus('running', rollout.completedWork || rollout.completedStaff, rollout.lastBottleneck);
    projects.push({ id: rollout.id, title: SYSTEM_RULES[rollout.method].name, kind: 'system rollout', status, progressBps: work.progressBps,
      detail: rollout.status === 'active' ? 'System installed' : rollout.status === 'ready' ? `System activates in Week ${rollout.readyWeek}` : work.detail,
      bottleneck: status === 'blocked' ? rollout.lastBottleneck : '', targetPanel: rolloutPanels[rollout.method], stationId: 'models', startedWeek: rollout.startedWeek });
  }
  for (const release of mine(state.slices.products.preparedReleases ?? {})) {
    const productName = state.slices.products.offers[release.productId]?.name ?? 'Product';
    for (const job of release.rollback ? [release, release.rollback] : [release]) {
      if (job.status === 'discarded') continue;
      const rollback = job !== release;
      const work = designWork(job);
      const status = job.status === 'preparing' ? jobStatus(job.paused ? 'paused' : 'running', job.lastProgress, job.lastBottleneck)
        : job.status === 'scheduled' || job.status === 'ready' ? 'waiting' : 'complete';
      let detail = job.paused ? 'Preparation paused · ' + work.detail : work.detail;
      if (job.status === 'ready') detail = (job.availableWeek ?? 0) > state.week ? `Ready to schedule in Week ${job.availableWeek}` : 'Ready to schedule the model switch';
      if (job.status === 'scheduled') detail = `Model switch scheduled for Week ${job.cutoverWeek}`;
      if (status === 'complete') detail = rollback ? 'Previous model restored' : 'Model handover completed';
      projects.push({ id: job.id, title: `${productName} · ${rollback ? 'restore previous model' : 'model handover'}`, kind: rollback ? 'rollback' : 'handover',
        status, progressBps: work.progressBps, detail, bottleneck: status === 'blocked' ? job.lastBottleneck : '',
        targetPanel: 'release-desk', stationId: 'product', startedWeek: job.startedWeek });
    }
  }
  for (const deployment of mine(state.slices.products.deployments)) {
    const product = state.slices.products.offers[deployment.productId];
    projects.push({ id: deployment.id, title: `Release ${product?.name ?? 'model'}`, kind: 'deployment',
      status: deployment.status === 'active' ? 'complete' : deployment.status === 'ready' ? 'waiting'
        : jobStatus('running', deployment.completedStaff, deployment.lastBottleneck),
      progressBps: percent(deployment.completedStaff, deployment.requiredStaff),
      detail: deployment.status === 'ready' ? `Activates in Week ${deployment.readyWeek}`
        : deployment.status === 'active' ? 'Deployed and available for service'
          : `${formatWorkPoints(deployment.completedStaff)} / ${formatWorkPoints(deployment.requiredStaff)} Design points`,
      bottleneck: deployment.lastBottleneck, targetPanel: product?.kind === 'developer-api' ? 'developer-api' : 'product',
      stationId: 'product', startedWeek: deployment.startedWeek });
  }
  for (const project of mine(state.slices.research.projects)) {
    const pending = project.status === 'complete' && (project.availableWeek ?? 0) > state.week;
    projects.push({ id: project.id, title: content.research.find(item => item.id === project.researchId)?.name ?? project.researchId,
      kind: 'research', status: pending ? 'waiting' : jobStatus(project.status, project.lastProgress || (project.lastBottleneck ? 0 : project.completedStaff), project.lastBottleneck),
      progressBps: Math.min(percent(project.completedWork, project.requiredWork), percent(project.completedStaff, project.requiredStaff)),
      detail: pending ? `Discovery available in Week ${project.availableWeek}`
        : `${units(project.completedWork)} / ${units(project.requiredWork)} CUw · ${formatWorkPoints(project.completedStaff)} / ${formatWorkPoints(project.requiredStaff)} ${WORK_POINT_LABELS[project.role]} points`,
      bottleneck: project.lastBottleneck, targetPanel: 'research', stationId: 'models', startedWeek: project.startedWeek });
  }
  for (const project of mine(state.slices.research.modelResearch ?? {})) {
    const pending = project.status === 'complete' && (project.availableWeek ?? 0) > state.week;
    projects.push({ id: project.id, title: `Architecture research · level ${project.level}`,
      kind: 'research', status: pending ? 'waiting' : jobStatus(project.status, project.lastProgress || (project.lastBottleneck ? 0 : project.completedStaff), project.lastBottleneck),
      progressBps: Math.min(percent(project.completedWork, project.requiredWork), percent(project.completedStaff, project.requiredStaff)),
      detail: pending ? `Architecture knowledge available in Week ${project.availableWeek}`
        : `${units(project.completedWork)} / ${units(project.requiredWork)} CUw · ${formatWorkPoints(project.completedStaff)} / ${formatWorkPoints(project.requiredStaff)} Research points`,
      bottleneck: project.lastBottleneck, targetPanel: 'research', stationId: 'models', startedWeek: project.startedWeek });
  }
  for (const rack of mine(state.slices.compute.racks)) {
    const delivered = rack.status !== 'ordered', installed = rack.status === 'installed' || rack.status === 'parked';
    projects.push({ id: rack.id, title: `${content.hardware.find(item => item.id === rack.hardwareId)?.name ?? 'Custom'} rack`, kind: 'rack',
      status: installed ? 'complete' : rack.status === 'installing' && rack.readyWeek === null
        ? jobStatus('running', rack.completedInstallStaff, rack.lastBottleneck) : 'waiting',
      progressBps: installed ? 10000 : delivered ? percent(rack.completedInstallStaff, content.infrastructure.installationStaffWeeks) : 0,
      detail: !delivered ? `Delivery in Week ${rack.arrivalWeek} · no usable capacity yet`
        : rack.readyWeek !== null && !installed ? `Installation complete · activates in Week ${rack.readyWeek}`
          : rack.status === 'inventory' ? 'Delivered · installation required'
            : installed ? (rack.status === 'parked' ? 'Parked · upkeep continues' : 'Installed')
              : `${formatWorkPoints(rack.completedInstallStaff)} / ${formatWorkPoints(content.infrastructure.installationStaffWeeks)} Operations points`,
      bottleneck: rack.lastBottleneck, targetPanel: 'infrastructure', stationId: 'compute', startedWeek: rack.orderedWeek });
  }
  for (const facility of mine(state.slices.compute.facilities)) {
    const definition = content.infrastructure.stages[facility.stageIndex], stage = facility.stages[facility.stageIndex];
    const complete = facility.status === 'active', commissioning = facility.status === 'commissioning';
    const stageProgress = stage && definition ? Math.min(percent(stage.elapsedWeeks, definition.elapsedWeeks), percent(stage.completedStaff, definition.staffWeeks)) : 0;
    projects.push({ id: facility.id, title: facility.name, kind: 'facility',
      status: complete ? 'complete' : commissioning || facility.paused ? 'waiting'
        : !stage?.paidCents || facility.lastBottleneck ? 'blocked' : 'working',
      progressBps: complete || commissioning ? 10000 : Math.min(10000, Math.floor((facility.stageIndex * 10000 + stageProgress) / content.infrastructure.stages.length)),
      detail: complete ? 'Data center ready' : commissioning ? `Ready in Week ${facility.readyWeek}` : definition?.name ?? 'Construction',
      bottleneck: facility.lastBottleneck, targetPanel: 'infrastructure', stationId: 'compute', startedWeek: facility.startedWeek });
  }
  for (const retrofit of mine(state.slices.compute.facilitySpecializations ?? {})) {
    const facility = state.slices.compute.facilities[retrofit.facilityId];
    const complete = retrofit.status === 'active' || retrofit.status === 'retired';
    projects.push({ id: retrofit.id, title: `${facility?.name ?? 'Owned site'} · ${retrofit.profile} profile`, kind: 'site profile',
      status: complete ? 'complete' : retrofit.status === 'ready' || retrofit.paused ? 'waiting' : jobStatus('running', retrofit.lastProgress, retrofit.lastBottleneck),
      progressBps: complete ? 10000 : Math.min(percent(retrofit.elapsedWeeks, retrofit.requiredWeeks), percent(retrofit.completedStaff, retrofit.requiredStaff), percent(retrofit.completedWork, retrofit.requiredWork)),
      detail: retrofit.status === 'active' ? `Active since Week ${retrofit.activatedWeek}` : retrofit.status === 'retired' ? `Replaced in Week ${retrofit.retiredWeek}`
        : retrofit.status === 'ready' ? `Profile activates in Week ${retrofit.readyWeek}` : `${formatWorkPoints(retrofit.completedStaff)} / ${formatWorkPoints(retrofit.requiredStaff)} Operations points · ${units(retrofit.completedWork)} / ${units(retrofit.requiredWork)} development CUw`,
      bottleneck: complete || retrofit.status === 'ready' ? '' : retrofit.lastBottleneck,
      targetPanel: 'campus', stationId: 'compute', startedWeek: retrofit.startedWeek });
  }
  for (const design of mine(state.slices.compute.chipDesigns)) {
    const meters = design.prototypeRun ?? design.design;
    const complete = design.status === 'validated', ready = design.status === 'design-ready' || meters.readyWeek !== null;
    projects.push({ id: design.id, title: design.successor ? `${design.name} · Gen 2 ${design.successor.improvement}` : design.name, kind: 'chip',
      status: complete ? 'complete' : design.paused || ready ? 'waiting' : jobStatus('running', meters.lastProgress, meters.lastBottleneck),
      progressBps: complete ? 10000 : Math.min(percent(meters.completedWorkCUw, meters.requiredWorkCUw), percent(meters.completedHardwareStaff, meters.requiredHardwareStaff), percent(meters.completedMlStaff, meters.requiredMlStaff)),
      detail: design.status === 'design-ready' ? 'Design ready · build and test a prototype'
        : complete ? 'Prototype validated' : `${design.prototypeRun ? 'Prototype' : 'Design'} · ${units(meters.completedWorkCUw)} / ${units(meters.requiredWorkCUw)} CUw`,
      bottleneck: meters.lastBottleneck, targetPanel: design.successor ? 'campus' : 'chips', stationId: 'compute', startedWeek: meters.startedWeek });
  }
  for (const batch of mine(state.slices.compute.chipBatches)) {
    projects.push({ id: batch.id, title: `${state.slices.compute.chipDesigns[batch.designId]?.name ?? 'Chip'} fabrication`, kind: 'fabrication',
      status: batch.status === 'delivered' ? 'complete' : 'waiting',
      progressBps: batch.status === 'delivered' ? 10000 : percent(Math.max(0, state.week - batch.orderedWeek), batch.arrivalWeek - batch.orderedWeek),
      detail: batch.status === 'delivered' ? `${batch.racks} rack${batch.racks === 1 ? '' : 's'} delivered · installation is separate`
        : `${batch.racks} rack${batch.racks === 1 ? '' : 's'} due in Week ${batch.arrivalWeek}`,
      bottleneck: '', targetPanel: 'chips', stationId: 'compute', startedWeek: batch.orderedWeek });
  }
  for (const canary of mine(state.slices.products.canaryReleases ?? {})) {
    const samples = sum(canary.observations.map(item => item.candidate.executedRequests));
    projects.push({ id: canary.id, title: `${state.slices.products.offers[canary.productId]?.name ?? 'Public release'} canary`, kind: 'canary',
      status: canary.status === 'promoted' || canary.status === 'stopped' && canary.stopCode === 'manual' ? 'complete'
        : canary.status === 'stopped' ? 'blocked' : canary.status === 'collecting' ? 'working' : 'waiting',
      progressBps: percent(samples, canary.sampleFloor),
      detail: canary.status === 'qualified' ? 'Enough test requests · choose when to switch models'
        : canary.status === 'promoted' ? 'New model is live'
          : `${samples.toLocaleString()} / ${canary.sampleFloor.toLocaleString()} candidate samples · ${units(canary.consumedWorkCUw)} / ${units(canary.budgetCUw)} CUw`,
      bottleneck: canary.status === 'stopped' ? `Week ${canary.stoppedWeek} decision: ${canary.lastMessage}` : '', targetPanel: 'release-desk', stationId: 'product', startedWeek: canary.startedWeek });
  }
  for (const order of Object.values(state.slices.products.privateApplianceOrders ?? {}).filter(item => item.companyId === owner)) {
    const contract = state.slices.products.commercialContracts[order.contractId];
    const accepted = order.acceptedWeek !== null, shipped = order.shippedWeek !== null;
    projects.push({ id: order.id, title: 'Cedar Records private appliance', kind: 'private appliance',
      status: accepted ? 'complete' : !shipped || contract.status === 'ready' ? 'waiting' : contract.lastBottleneck ? 'blocked' : 'working',
      progressBps: accepted ? 10000 : !shipped ? Math.floor(percent(Math.max(0, state.week - order.orderedWeek), order.arrivalWeek - order.orderedWeek) / 2)
        : 5000 + Math.floor(percent(contract.completedDeliveryStaff, contract.requiredDeliveryStaff) / 2),
      detail: accepted ? 'Customer accepted delivery · bundle paid · support continues'
        : !shipped ? `Two customer racks · shipment due Week ${order.arrivalWeek}`
          : `${formatWorkPoints(contract.completedDeliveryStaff)} / ${formatWorkPoints(contract.requiredDeliveryStaff)} Design points of installation`,
      bottleneck: shipped && !accepted ? contract.lastBottleneck : '', targetPanel: 'release-desk', stationId: 'product', startedWeek: order.orderedWeek });
  }
  projects.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));

  const packets = Object.values(state.slices.data.packets).filter(packet => (packet.companyId ?? owner) === owner);
  const prepared = packets.filter(packet => packet.prepared).length;
  const trained = view.trainedModels.length, evaluated = view.evaluatedModels.length;
  const workforceFte = sum(Object.values(view.workforce.capacity)), grantedFte = sum(Object.values(view.workforce.granted));
  const readyStaff = view.workforce.ready + (company.founderFte > 0 ? 1 : 0);
  const executedCUw = sum(Object.values(fleet.lastWork));
  const totalCU = sum(pools.map(pool => pool.capacityCU));
  const chat = mine(state.slices.products.offers).find(product => product.kind === 'basic-chat');
  const usage = chat ? state.slices.products.lastUsage[chat.id] : undefined;
  const currentUsage = usage?.week === state.week ? usage : undefined;
  const trials = chat ? sum(state.slices.markets.trials.filter(trial => trial.companyId === owner && trial.productId === chat.id).map(trial => trial.count)) : 0;
  const customers = chat ? sum(state.slices.markets.cohorts.filter(cohort => cohort.companyId === owner && cohort.productId === chat.id).map(cohort => cohort.count)) : 0;
  const stations: StudioStation[] = [
    { id: 'data', title: 'Data desk', subtitle: 'Prepare & curate', status: prepared ? 'complete' : 'idle', detail: `${prepared} prepared of ${packets.length} dataset${packets.length === 1 ? '' : 's'}`, bottleneck: '', targetPanel: 'data', projectId: null, progressBps: null },
    { id: 'lab', title: 'Training bench', subtitle: 'Build your model', status: trained ? 'complete' : 'idle', detail: `${trained} completed training run${trained === 1 ? '' : 's'}`, bottleneck: '', targetPanel: 'lab-projects', projectId: null, progressBps: null },
    { id: 'models', title: 'Test station', subtitle: 'Evaluate & inspect', status: evaluated ? 'complete' : 'idle', detail: `${evaluated} Chat-qualified model${evaluated === 1 ? '' : 's'}`, bottleneck: '', targetPanel: 'models', projectId: null, progressBps: null },
    { id: 'people', title: 'Team desk', subtitle: 'People & weekly points', status: grantedFte > 0 ? 'working' : view.workforce.onboarding ? 'waiting' : 'idle', detail: `${readyStaff} ready · ${view.workforce.onboarding} onboarding · ${formatWorkPoints(grantedFte)} points allocated last week`, bottleneck: '', targetPanel: 'people', projectId: null, progressBps: null },
    { id: 'compute', title: 'Compute rack', subtitle: 'Capacity & memory', status: fleet.lastBottleneck ? 'blocked' : executedCUw > 0 ? 'working' : 'idle', detail: `${units(totalCU)} usable CU · ${units(executedCUw)} CUw last week`, bottleneck: fleet.lastBottleneck, targetPanel: 'compute', projectId: null, progressBps: null },
    { id: 'product', title: 'Release desk', subtitle: view.progress.firstSale ? 'Live tests & appliances' : 'Launch Basic Chat', status: !chat ? 'idle' : chat.status === 'paused' ? 'waiting'
      : currentUsage && currentUsage.requestedWork > 0 && currentUsage.executedWork === 0 ? 'blocked'
        : currentUsage && currentUsage.executedWork > 0 ? 'working' : 'waiting',
      detail: !chat ? 'No Chat service launched' : chat.status === 'paused' ? 'Basic Chat is paused'
        : chat.status === 'deploying' ? 'Preparing deployment' : `${customers} subscriber${customers === 1 ? '' : 's'} · ${trials} trial account${trials === 1 ? '' : 's'}`,
      bottleneck: currentUsage && chat?.status === 'active' && currentUsage.requestedWork > 0 && currentUsage.executedWork === 0
        ? fleet.lastGrants.find(grant => grant.requestId === `serve:${chat.id}`)?.reason || 'No serving work was granted. Review serving capacity, memory and commitments.' : '',
      targetPanel: view.progress.firstSale ? 'release-desk' : 'product', projectId: null, progressBps: null },
  ];
  for (const station of stations) {
    // Research and infrastructure have their own workbench screens; opening a station
    // always keeps its original action panel available.
    const project = projects.find(item => item.stationId === station.id && (item.targetPanel === station.targetPanel || station.id === 'data' && item.targetPanel === 'synthetic-data') && item.status !== 'complete');
    if (project) Object.assign(station, { status: project.status, detail: project.detail, bottleneck: project.bottleneck, projectId: project.id, progressBps: project.progressBps });
    const queued = state.queuedCommands.filter(command => command.companyId === owner && (queuedStation(command.payload) === station.id
      || command.payload.kind === 'apply_studio_plan' && command.payload.commands.some(member => queuedStation(member) === station.id))).length;
    if (queued) {
      if (!project && (station.status === 'idle' || station.status === 'complete')) station.status = 'waiting';
      station.detail += ` · ${queued} change${queued === 1 ? '' : 's'} queued for Week ${state.week + 1}`;
    }
  }
  const milestones: StudioMilestone[] = [
    { id: 'dataReady', label: 'Prepare data', complete: view.progress.dataReady, targetPanel: 'data', stationId: 'data' },
    { id: 'trained', label: 'Train', complete: view.progress.trained, targetPanel: 'lab-projects', stationId: 'lab' },
    { id: 'evaluated', label: 'Evaluate', complete: view.progress.evaluated, targetPanel: 'models', stationId: 'models' },
    { id: 'deployed', label: 'Deploy', complete: view.progress.deployed, targetPanel: 'product', stationId: 'product' },
    { id: 'firstSale', label: 'First sale', complete: view.progress.firstSale, targetPanel: 'product', stationId: 'product' },
  ];
  const nextIndex = milestones.findIndex(milestone => !milestone.complete), next = milestones[nextIndex];
  const stages: StudioView['nextAction']['stage'][] = ['prepare', 'train', 'evaluate', 'release', 'earn'];
  const actions = ['Prepare your data', 'Plan a training run', 'Evaluate your model', 'Launch Basic Chat', 'Review your service'];
  const commissionedSite = mine(state.slices.compute.facilities).some(facility => facility.status === 'active');
  return freezeDeep({ week: state.week, companyName: company.name, roomTier: commissionedSite ? 'campus' : company.earnedRevenueCents > 0 ? 'studio' : 'garage',
    summary: { cashCents: company.cashCents, availableCashCents: view.availableCashCents, reservedCashCents: view.reservedCashCents,
      runwayWeeks: view.runwayWeeks, weeklyBaseCostCents: view.weeklyBaseCostCents, revenueCents: company.lastWeek.revenueCents,
      readyStaff, onboardingStaff: view.workforce.onboarding, totalStaff: readyStaff + view.workforce.onboarding,
      workforceFte, grantedFte, cloudCU: fleet.cloudCU, ownedCU: sum(pools.filter(pool => pool.ownership === 'owned').map(pool => pool.capacityCU)), totalCU,
      executedCUw, memoryMU: sum(pools.map(pool => pool.memoryMU)), memoryInUseMU: fleet.occupiedMemoryMU,
      queuedCount: state.queuedCommands.filter(command => command.companyId === owner).length },
    stations, projects, milestones,
    nextAction: next && !view.progress.firstSale ? { ...view.nextMilestone, targetPanel: next.targetPanel, stationId: next.stationId,
      stage: stages[nextIndex], actionLabel: actions[nextIndex] } : ambitionAction(state, content) });
}
