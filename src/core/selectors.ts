import { formatWorkPoints } from '../modules/workforce-points';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import type { CommandPayload, GameCommand, GameContent, GameState, GameView, JobStatus, TrainingRun } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { getInfrastructureBaseCost } from '../modules/compute-pools';
import { getPayrollCents, getWorkforce } from '../modules/company';
import { careerSalary } from '../modules/staff-careers';
import { checkedAdd, formatUnits, mulDiv } from './math';
import { freezeDeep } from './canonical';

export function reservedCash(state: GameState, companyId = state.playerCompanyId): number {
  return state.queuedCommands.filter(c => c.companyId === companyId).reduce((sum, c) => checkedAdd(sum, c.reservedCents ?? 0), 0);
}
export function getWeeklyBaseCost(state: GameState, content: GameContent = CONTENT, companyId = state.playerCompanyId): number {
  return checkedAdd(checkedAdd(mulDiv(state.slices.compute.fleets[companyId].cloudCU, content.opening.rentCentsPerCUWeek, RESOURCE_SCALE), content.opening.overheadCentsPerWeek), checkedAdd(getPayrollCents(state, companyId, content), getInfrastructureBaseCost(state, companyId, content)));
}
/** Count current bills and pending increases without executing work or forecasting
 * revenue. Pending savings can still fail admission, so they count only after
 * application. Commit callers pass only remaining commands to avoid double counts. */
export function getKnownWeeklyBaseCost(state: GameState, content: GameContent = CONTENT, {
  companyId = state.playerCompanyId, commands = state.queuedCommands, week = state.week + 1,
}: { companyId?: string; commands?: readonly GameCommand[]; week?: number } = {}): number {
  const fleet = state.slices.compute.fleets[companyId];
  const salaries = new Map(Object.values(state.slices.company.staff).filter(member => member.companyId === companyId)
    .map(member => [member.id, careerSalary(member, content.staff.find(role => role.id === member.role)!.weeklyCents)]));
  const payroll = () => [...salaries.values()].reduce(checkedAdd, 0);
  const currentPayroll = payroll(), rent = (cu: number) => mulDiv(cu, content.opening.rentCentsPerCUWeek, RESOURCE_SCALE);
  let cloudCU = fleet.cloudCU;
  const project = (payload: CommandPayload, id: string) => {
    if (payload.kind === 'apply_studio_plan') payload.commands.forEach((member, index) => project(member, `${id}:plan:${index}`));
    else if (payload.kind === 'set_cloud_capacity') cloudCU = Math.max(cloudCU, payload.cu);
    else if (payload.kind === 'set_batch_capacity') cloudCU = Math.max(cloudCU, payload.cloudCU);
    else if (payload.kind === 'hire_staff') {
      const role = content.staff.find(role => role.id === payload.role);
      if (role) salaries.set(`staff:${id}`, role.weeklyCents);
    }
  };
  for (const command of commands) if (command.companyId === companyId && command.issuedForWeek <= week
    && !Object.hasOwn(state.commandReceipts, command.id)) project(command.payload, command.id);
  return checkedAdd(getWeeklyBaseCost(state, content, companyId), checkedAdd(rent(cloudCU) - rent(fleet.cloudCU), payroll() - currentPayroll));
}
/** Last week's delivered recurring service, after credits. Briefs, agent jobs,
 * batch deliveries and hardware/appliance sales remain cash receipts, but their
 * one-time payments cannot fund every future week. Invoice histories also keep
 * this estimate independent of the company ledger's bounded display history. */
export function getRecentRecurringRevenueCents(state: Readonly<GameState>, companyId = state.playerCompanyId): number {
  const products = state.slices.products;
  return [...products.invoices, ...products.commercialInvoices, ...(products.assuranceInvoices ?? [])]
    .filter(invoice => invoice.companyId === companyId && invoice.week === state.week)
    .reduce((total, invoice) => checkedAdd(total, invoice.amountCents), 0);
}
export function trainingRunProgress(run: TrainingRun) {
  const design = run.plan?.preparationRequired ?? 0;
  const teacher = run.plan?.teacher?.requiredWork ?? 0;
  const stages = [
    ...(design ? [{ name: 'Design foundation', done: run.preparationCompleted ?? 0, total: design, format: formatWorkPoints, unit: 'Research points' }] : []),
    ...(teacher ? [{ name: 'Generate teacher examples', done: run.teacherWorkCompleted ?? 0, total: teacher, format: formatUnits, unit: 'serving CUw' }] : []),
    { name: 'Train new version', done: run.completedWork + (run.checkpointOverheadCompleted ?? 0),
      total: run.requiredWork + (run.plan?.checkpointOverheadRequired ?? 0), format: formatUnits, unit: 'development CUw' },
  ];
  const index = stages.findIndex(stage => stage.done < stage.total);
  const current = index < 0 ? stages.length - 1 : index, stage = stages[current];
  const stageNumber = stages.length > 1 ? `Stage ${current + 1} of ${stages.length} · ` : '';
  const label = run.status === 'complete' ? 'New version ready' : stage.name;
  return {
    detail: `${stageNumber}${label} · ${stage.format(stage.done)} / ${stage.format(stage.total)} ${stage.unit}${run.checkpointWork > 0 && run.status !== 'complete' ? ' · checkpoint saved' : ''}`,
    progressBps: stage.total ? Math.min(10000, mulDiv(stage.done, 10000, stage.total)) : 10000,
  };
}

export function getGameView(state: GameState, content: GameContent = CONTENT): GameView {
  const id = state.playerCompanyId, company = state.slices.company.companies[id], fleet = state.slices.compute.fleets[id];
  const workforce = getWorkforce(state, id, state.week);
  const models = Object.values(state.slices.models.versions).filter(m => m.companyId === id);
  const trainedModels = models.filter(m => m.trainingRunId && state.slices.models.trainingRuns[m.trainingRunId]?.status === 'complete' && m.id === state.slices.models.trainingRuns[m.trainingRunId].outputModelId);
  const evaluatedModels = models.filter(m => Object.values(state.slices.models.reports).some(r => r.modelId === m.id && r.basicChatEligible && isCapabilitySuite(r.suiteId)));
  const activeProduct = Object.values(state.slices.products.offers).find(p => p.companyId === id) ?? null;
  const activeContract = activeProduct ? state.slices.products.contracts[activeProduct.contractId] ?? null : null;
  const usage = activeProduct ? state.slices.products.lastUsage[activeProduct.id] ?? null : null;
  const deployed = state.slices.campaign.milestones.includes('first-deployment') || company.earnedRevenueCents > 0 || Object.values(state.slices.products.offers).some(p => p.companyId === id && p.status !== 'deploying');
  const progress = { dataReady: state.slices.data.packets[content.starterData.id]?.prepared ?? false, trained: trainedModels.length > 0, evaluated: evaluatedModels.length > 0, deployed, firstSale: company.earnedRevenueCents > 0 };
  const labJobs: GameView['labJobs'] = [];
  const percent = (done: number, required: number) => required ? Math.min(10000, mulDiv(done, 10000, required)) : 10000;
  const add = (id: string, title: string, status: JobStatus, progressBps: number, detail: string, bottleneck: string) => labJobs.push({ id, title, status, progressBps, detail, bottleneck });
  for (const job of Object.values(state.slices.data.preparationJobs)) if (job.companyId === id) add(job.id, job.kind === 'deduplicate' ? 'Deduplicate dataset' : job.kind === 'curate' ? 'Curate dataset' : 'Prepare dataset', job.status, percent(job.completedStaff, job.requiredStaff), `${formatWorkPoints(job.completedStaff)} / ${formatWorkPoints(job.requiredStaff)} Data points`, job.lastBottleneck);
  for (const run of Object.values(state.slices.models.trainingRuns)) {
    if (run.companyId !== id) continue;
    const progress = trainingRunProgress(run);
    const method = run.plan?.recipeName ?? content.firstTraining.name;
    const source = state.slices.models.versions[run.baseModelId], output = state.slices.models.versions[run.outputModelId];
    const version = run.status === 'complete' ? output?.name
      : source && (run.plan?.kind === 'foundation' ? `Reference model ${source.name}` : `From ${source.name}`);
    const title = version ? `${method} · ${version}` : method;
    add(run.id, title, run.status, progress.progressBps, progress.detail, run.lastBottleneck);
  }
  for (const job of Object.values(state.slices.models.evaluationRuns)) if (job.companyId === id) add(job.id, 'Held-out evaluation', job.status, Math.min(percent(job.completedWork, job.requiredWork), percent(job.completedStaff, job.requiredStaff)), `${job.completedWork / RESOURCE_SCALE} / ${job.requiredWork / RESOURCE_SCALE} CUw · ${formatWorkPoints(job.completedStaff)} / ${formatWorkPoints(job.requiredStaff)} Research points`, job.lastBottleneck);
  const completedAmbitions = Object.keys(state.slices.campaign.endings).length;
  const nextMilestone = completedAmbitions > 0 ? { title: `${completedAmbitions} company ambition${completedAmbitions === 1 ? '' : 's'} achieved`, detail: 'Your company continues. Inspect your earned routes in Company ambitions, pursue another route, or keep developing models and infrastructure.' }
    : progress.firstSale ? { title: 'Build a lasting AI company', detail: 'Company ambitions track your results each week. Review each route’s requirements and follow the links to work on the next goal.' }
    : !progress.dataReady ? { title: 'Prepare your training data', detail: 'Start preparing the sample for $1,000. Your founder contributes Data points as the weeks advance. The sample needs 40 points.' }
    : !progress.trained ? { title: 'Adapt Seed 0', detail: 'Start the 12-CUw adaptation with development compute. Your team contributes Design points to supervise it. An ML engineer adds 30 Design points per week after onboarding.' }
    : !progress.evaluated ? { title: 'Evaluate your new checkpoint', detail: 'Generate Research points and run the held-out evaluation. It needs two development CUw and 10 Research points; testing measures the saved model.' }
    : !progress.deployed ? { title: 'Launch Basic Chat', detail: 'Deploy an evaluated model with 20 Design points. Reserve serving capacity before launch; activation occurs at the following weekly boundary.' }
    : { title: 'Serve trials and earn the first bill', detail: 'Keep serving compute available. Trials consume real work, and converted subscribers begin using and paying for the service the next week.' };
  const weeklyBaseCostCents = getWeeklyBaseCost(state, content), payrollCents = getPayrollCents(state, id, content);
  const committed = reservedCash(state), availableCashCents = Math.max(0, company.cashCents - committed);
  const projectedIncome = getRecentRecurringRevenueCents(state, id);
  const recentVariableCost = state.slices.company.ledger.filter(entry => entry.companyId === id && entry.week === state.week && entry.sourceId === 'owned-gpu-work' && entry.kind === 'expense').reduce((sum, entry) => checkedAdd(sum, entry.amountCents), 0);
  const deficit = weeklyBaseCostCents + recentVariableCost - projectedIncome;
  const training = Object.values(state.slices.models.trainingRuns).find(r => r.companyId === id && r.status === 'running');
  const lastTrainingGrant = training ? fleet.lastGrants.find(g => g.requestId === training.id + ':work')?.grantedWork : undefined;
  const supervised = Object.values(state.slices.research.systemRollouts).some(rollout => rollout.companyId === id && rollout.method === 'run-supervisor' && rollout.status === 'active');
  const rate = training ? supervised ? lastTrainingGrant ?? 0
    : Math.min(fleet.allocation.development, mulDiv(workforce.capacity.ml, content.firstSale.trainingWorkPerMl, RESOURCE_SCALE), lastTrainingGrant ?? Number.MAX_SAFE_INTEGER) : 0;
  return freezeDeep(structuredClone({ weeklyBaseCostCents, operatingSurplusCents: company.lastWeek.revenueCents - company.lastWeek.operatingExpenseCents, reservedCashCents: committed, availableCashCents, runwayWeeks: deficit <= 0 ? null : Math.floor(availableCashCents / deficit), payrollCents, cloudRentCents: mulDiv(fleet.cloudCU, content.opening.rentCentsPerCUWeek, RESOURCE_SCALE), nextMilestone, progress, workforce, labJobs, trainedModels, evaluatedModels, activeProduct, activeContract, usage, trainingForecastWeeks: training && rate > 0 ? Math.ceil((training.requiredWork - training.completedWork) / rate) : null, memoryInUse: fleet.occupiedMemoryMU }));
}
