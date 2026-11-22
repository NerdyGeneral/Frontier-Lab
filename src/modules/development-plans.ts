import type { CommandPayload, CommandQuote, DomainResult, GameCommand, GameContent, GameState, Rejection } from '../contracts/types';
import type { DevelopmentPlan, DevelopmentPlanSpec, DevelopmentPlanStep } from '../contracts/development-plans';
import { DEVELOPMENT_PLAN_LIMIT } from '../contracts/development-plans';
import { canonicalStateHash } from '../core/canonical';
import { formatMoney } from '../core/math';
import { getWeeklyBaseCost, reservedCash } from '../core/selectors';
import { evaluationSuite } from './lab-evaluation';
import { getTrainingPreview, packetOwnedBy, validateTrainingOptions } from './lab-planner';
import { preparationTerms } from './lab-data';
import { hasResearch } from './research';

export const developmentPacketIds = (spec: DevelopmentPlanSpec) => [...new Set([spec.training.packetId, ...(spec.training.packetIds ?? [])])];
export const activeDevelopmentPlan = (state: Readonly<GameState>) => Object.values(state.slices.models.developmentPlans ?? {}).find(p => p.companyId === state.playerCompanyId && !['review', 'cancelled'].includes(p.status));
export function developmentFeeSpent(state: Readonly<GameState>, plan: DevelopmentPlan): number {
  return plan.steps.reduce((sum, step) => sum + (state.commandReceipts[step.commandId]?.status === 'accepted' ? step.feeCents : 0), 0);
}
export function developmentPreviewState(state: Readonly<GameState>, spec: Pick<DevelopmentPlanSpec, 'training'>): GameState {
  const next = structuredClone(state);
  for (const id of [...new Set([spec.training.packetId, ...(spec.training.packetIds ?? [])])]) {
    const packet = next.slices.data.packets[id];
    if (packet) { packet.prepared = true; packet.readyUnits = packet.rawUnits; }
  }
  return next;
}
export function developmentQuote(state: Readonly<GameState>, spec: DevelopmentPlanSpec, content: GameContent) {
  const prepared = developmentPreviewState(state, spec);
  const training = getTrainingPreview(prepared, state.playerCompanyId, spec.training, content);
  const preparationFeeCents = developmentPacketIds(spec).reduce((sum, id) => {
    const packet = state.slices.data.packets[id];
    const existing = Object.values(state.slices.data.preparationJobs).some(job => job.companyId === state.playerCompanyId && job.packetId === id && job.status !== 'complete');
    return sum + (packet && !packet.prepared && !existing ? preparationTerms(packet, content).feeCents : 0);
  }, 0);
  return { training, preparationFeeCents, totalFeeCents: preparationFeeCents + training.feeCents, weeklyBaseCostCents: getWeeklyBaseCost(state, content) };
}
function reject(message: string, code: Rejection['code'] = 'INVALID_COMMAND'): Rejection { return { code, message }; }
export function developmentPlanForCommand(state: Readonly<GameState>, commandId: string): DevelopmentPlan | undefined {
  return Object.values(state.slices.models.developmentPlans ?? {}).find(p => p.steps.some(step => step.commandId === commandId));
}
export function developmentStageAdmission(state: Readonly<GameState>, command: GameCommand, content: GameContent, availableCash?: number): Rejection | undefined {
  const plan = developmentPlanForCommand(state, command.id);
  if (!plan) return;
  if (plan.status !== 'running') return reject('The development plan is stopped. Its unstarted stage was not charged.', 'NOT_READY');
  if (state.queuedCommands.some(other => other.companyId === plan.companyId && ('planId' in other.payload && other.payload.planId === plan.id)
    && (other.payload.kind === 'cancel_development_plan' || other.payload.kind === 'set_development_plan_paused' && other.payload.paused))) return reject('Your queued pause or cancellation takes priority over the next development stage.', 'NOT_READY');
  if (state.week > plan.deadlineWeek) return reject('The development deadline has been reached. Extend the plan to continue.', 'NOT_READY');
  const step = plan.steps.find(item => item.commandId === command.id)!;
  if (canonicalStateHash(step.payload) !== canonicalStateHash(command.payload)) return reject('The queued stage differs from the authorized development plan.');
  if (developmentFeeSpent(state, plan) + step.feeCents > plan.feeBudgetCents) return reject('The next stage exceeds the project-fee budget.', 'INSUFFICIENT_FUNDS');
  const cash = availableCash ?? state.slices.company.companies[plan.companyId].cashCents - reservedCash(state, plan.companyId);
  if (cash - step.feeCents - getWeeklyBaseCost(state, content, plan.companyId) < plan.cashReserveCents)
    return reject('Starting this stage would threaten the cash reserve after known weekly bills.', 'INSUFFICIENT_FUNDS');
}
export function validateDevelopmentCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload;
  if (p.kind === 'start_development_plan') {
    const plans = Object.values(state.slices.models.developmentPlans ?? {});
    if (command.companyId !== state.playerCompanyId) return reject('Delegated plans are available for your lab.');
    if (plans.length >= DEVELOPMENT_PLAN_LIMIT) return reject('This campaign has reached its saved development-plan limit. Manual development remains available.');
    if (plans.some(plan => plan.companyId === command.companyId && !['review', 'cancelled'].includes(plan.status))
      || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind)) return reject('Finish or stop the current development plan before starting another.', 'ALREADY_ACTIVE');
    // The command's fixed boundary keeps the same advertised window at submission and commit.
    if (p.deadlineWeek < command.issuedForWeek + 2 || p.deadlineWeek > command.issuedForWeek + 519) return reject('Choose a deadline 3 to 520 weeks from now.');
    for (const id of developmentPacketIds(p)) {
      const packet = state.slices.data.packets[id];
      if (!packet || !packetOwnedBy(packet, command.companyId, state.playerCompanyId) || !packet.rawUnits) return reject('Choose owned datasets containing usable training data.', 'NOT_READY');
    }
    const suite = evaluationSuite(p.suiteId);
    if (!suite || (suite.requiredResearch && !hasResearch(state, command.companyId, suite.requiredResearch))) return reject('Unlock the selected evaluation before delegating this plan.', 'NOT_READY');
    if (!['basic-conversation-1', 'expanded-capabilities-1', 'advanced-capabilities-1', 'behavior-cases-1'].includes(p.suiteId)) return reject('Use a capability or behavior evaluation for the connected plan. Challenge and independent tests stay available after review.');
    const prepared = developmentPreviewState(state, p);
    const invalid = validateTrainingOptions(prepared, command.companyId, p.training, content); if (invalid) return invalid;
    const quote = developmentQuote(state, p, content);
    if (quote.training.reason) return quote.training.reason;
    if (quote.totalFeeCents > p.feeBudgetCents) return reject(`The planned preparation and training fees are ${formatMoney(quote.totalFeeCents)}. Increase the fee budget or change the design.`, 'INSUFFICIENT_FUNDS');
    if (state.slices.company.companies[command.companyId].cashCents - reservedCash(state, command.companyId) - quote.totalFeeCents - quote.weeklyBaseCostCents < p.cashReserveCents) return reject('The plan needs more cash above the chosen reserve and known weekly bills.', 'INSUFFICIENT_FUNDS');
    return;
  }
  if (!('planId' in p)) return reject('Choose a development plan.');
  const plan = state.slices.models.developmentPlans?.[p.planId];
  if (!plan || plan.companyId !== command.companyId) return reject('Choose one of your saved development plans.', 'NOT_READY');
  if (['review', 'cancelled'].includes(plan.status)) return reject('This plan has ended. Its outputs remain available.', 'NO_IMPROVEMENT');
  if (p.kind === 'revise_development_plan') {
    if (p.deadlineWeek < command.issuedForWeek + 1 || p.deadlineWeek > command.issuedForWeek + 519) return reject('Choose a future deadline within 520 weeks.');
    if (p.feeBudgetCents < developmentFeeSpent(state, plan)) return reject('The revised fee budget must cover fees already paid.');
  }
  if (p.kind === 'set_development_plan_paused' && !p.paused && plan.deadlineWeek < command.issuedForWeek) return reject('Extend the deadline before resuming the plan.', 'NOT_READY');
}
export function quoteDevelopmentCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const p = command.payload;
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.kind === 'start_development_plan'
    ? `Delegate preparation, training and ${evaluationSuite(p.suiteId)?.name}. Up to ${formatMoney(p.feeBudgetCents)} in project fees, ${formatMoney(p.cashReserveCents)} cash reserve, deadline Week ${p.deadlineWeek}. Rent, salaries and metered work continue separately. Review the result before release.`
    : p.kind === 'cancel_development_plan' ? 'Stop future handoffs and pause unfinished work. Keep every completed dataset, model and report.'
    : p.kind === 'revise_development_plan' ? 'Update the limits and resume this development plan with its saved work.'
    : p.kind === 'set_development_plan_paused' && p.paused ? 'Pause the plan and its current work. Weekly operating bills continue.' : 'Resume the plan from its saved stage.' };
}
export function setDevelopmentJobsPaused(state: GameState, plan: DevelopmentPlan, paused: boolean) {
  for (const step of plan.steps) {
    const job = state.slices.data.preparationJobs['preparation-' + step.commandId]
      ?? state.slices.models.trainingRuns['training-' + step.commandId]
      ?? state.slices.models.evaluationRuns['evaluation-' + step.commandId];
    if (job && job.status !== 'complete') { job.status = paused ? 'paused' : 'running'; job.lastProgress = 0; job.lastBottleneck = paused ? 'Paused with the development plan.' : ''; }
  }
}
export function applyDevelopmentCommand(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const next = structuredClone(state), models = next.slices.models;
  models.developmentPlans ??= {};
  const p = command.payload;
  if (p.kind === 'start_development_plan') {
    const { kind: _, ...spec } = p;
    const id = 'development-' + command.id;
    models.developmentPlans[id] = { ...structuredClone(spec), id, companyId: command.companyId, createdWeek: state.week,
      status: 'running', stage: 'prepare', steps: [], message: 'Preparing the selected data, then training and evaluation. A decision is required before release.' };
  } else if ('planId' in p) {
    const plan = models.developmentPlans[p.planId]!;
    if (p.kind === 'revise_development_plan') { plan.feeBudgetCents = p.feeBudgetCents; plan.cashReserveCents = p.cashReserveCents; plan.deadlineWeek = p.deadlineWeek; plan.status = 'running'; }
    if (p.kind === 'set_development_plan_paused') plan.status = p.paused ? 'paused' : 'running';
    if (p.kind === 'cancel_development_plan') { plan.status = 'cancelled'; plan.decisionWeek = state.week; }
    plan.message = plan.status === 'cancelled' ? 'Plan stopped. Completed outputs and paid work are preserved.' : plan.status === 'paused' ? 'Paused by you. Change the limits or resume when ready.' : 'Resumed with saved progress and current limits.';
    setDevelopmentJobsPaused(next, plan, plan.status !== 'running');
  }
  return { updates: { models, data: next.slices.data }, messages: [{ companyId: command.companyId, category: 'project', message: p.kind === 'start_development_plan' ? `Development plan “${p.name.trim()}” authorized. Routine handoffs will run within its limits.` : 'Development plan updated; existing outputs are preserved.' }] };
}

/** Runs only on the engine's private candidate, after settlement. Ordinary command admission remains authoritative. */
export function advanceDevelopmentPlans(state: GameState, content: GameContent, admit: (command: GameCommand) => { quote?: CommandQuote; rejection?: Rejection }, announce: (message: string) => void) {
  for (const plan of Object.values(state.slices.models.developmentPlans ?? {})) {
    if (plan.status !== 'running') continue;
    const block = (message: string) => { plan.status = 'blocked'; plan.message = message; plan.decisionWeek = state.week; setDevelopmentJobsPaused(state, plan, true); announce(`${plan.name}: ${message}`); };
    const latest = (key: string) => [...plan.steps].reverse().find(step => step.key === key);
    const pending = plan.steps.find(step => state.queuedCommands.some(c => c.id === step.commandId));
    if (pending) continue;
    const evaluationStep = latest('evaluate');
    const evaluation = evaluationStep && state.slices.models.evaluationRuns['evaluation-' + evaluationStep.commandId];
    if (evaluation?.status === 'complete' && evaluation.reportId) {
      plan.status = 'review'; plan.stage = 'review'; plan.modelId = evaluation.modelId; plan.reportId = evaluation.reportId;
      plan.completedWeek = state.slices.models.reports[evaluation.reportId].week; plan.decisionWeek = state.week;
      plan.message = 'Evaluation is ready. Review the evidence, then release the model or choose an improvement.'; announce(`${plan.name}: ${plan.message}`); continue;
    }
    if (state.week >= plan.deadlineWeek) { block('The deadline has arrived. Extend it to continue from saved progress.'); continue; }
    if (state.slices.company.companies[plan.companyId].cashCents - reservedCash(state, plan.companyId) - getWeeklyBaseCost(state, content, plan.companyId) < plan.cashReserveCents) {
      block('Known weekly bills would threaten the cash reserve. Review the plan limits or operating costs.'); continue;
    }
    const queue = (key: string, payload: DevelopmentPlanStep['payload']) => {
      if (plan.steps.length >= 1040) { block('This plan reached its retained stage-history limit. Continue the saved work manually or start a new plan.'); return; }
      if (state.queuedCommands.length >= 128) { block('The command queue is full. Settle existing changes, then resume.'); return; }
      const command: GameCommand = { id: 'development-stage-' + state.nextId, companyId: plan.companyId, issuedForWeek: state.week + 1, payload: structuredClone(payload) };
      const result = admit(command);
      if (result.rejection || !result.quote) { block(result.rejection?.message ?? 'The next stage cannot be admitted.'); return; }
      const fee = result.quote.upfrontCostCents;
      if (developmentFeeSpent(state, plan) + fee > plan.feeBudgetCents) { block('The next stage exceeds the project-fee budget. Review the limit to continue.'); return; }
      if (state.slices.company.companies[plan.companyId].cashCents - reservedCash(state, plan.companyId) - fee - getWeeklyBaseCost(state, content, plan.companyId) < plan.cashReserveCents) { block('The next stage would threaten the cash reserve after known weekly bills.'); return; }
      command.reservedCents = fee; state.nextId++;
      plan.steps.push({ key, commandId: command.id, issuedWeek: command.issuedForWeek, feeCents: fee, payload: structuredClone(payload) });
      state.queuedCommands.push(command);
      plan.message = `Next stage scheduled for Week ${command.issuedForWeek}. Project fees paid: ${formatMoney(developmentFeeSpent(state, plan))}.`;
    };
    const rejected = plan.steps.find(step => state.commandReceipts[step.commandId]?.status === 'rejected' && latest(step.key) === step);
    if (rejected && rejected.issuedWeek === state.week) { block(state.commandReceipts[rejected.commandId].reason?.message ?? 'The next stage was rejected; no fee was charged.'); continue; }
    const rawId = developmentPacketIds(plan).find(id => !state.slices.data.packets[id]?.prepared);
    if (rawId) {
      plan.stage = 'prepare';
      const job = Object.values(state.slices.data.preparationJobs).find(item => item.packetId === rawId && item.companyId === plan.companyId && item.status !== 'complete');
      if (job) { plan.message = job.status === 'paused' ? 'A selected dataset has a paused preparation job. Resume it in Datasets.' : 'Preparing selected data. Training starts when every source is ready.'; if (job.status === 'paused') block(plan.message); }
      else queue('prepare:' + rawId, { kind: 'prepare_data', packetId: rawId });
      continue;
    }
    plan.stage = 'train';
    const trainingStep = latest('train');
    const training = trainingStep && state.slices.models.trainingRuns['training-' + trainingStep.commandId];
    if (!training) { queue('train', plan.training); continue; }
    if (training.status !== 'complete') { plan.message = training.lastBottleneck || 'Training the approved design. Evaluation will start automatically.'; if (training.status === 'paused') block('Training was paused. Resume the development plan to continue.'); continue; }
    plan.modelId = training.outputModelId; plan.stage = 'evaluate';
    if (!evaluation) { queue('evaluate', { kind: 'evaluate_model', modelId: training.outputModelId, suiteId: plan.suiteId }); continue; }
    plan.message = evaluation.lastBottleneck || 'Evaluating the finished model. Review is the final checkpoint.';
    if (evaluation.status === 'paused') block('Evaluation was paused. Resume the development plan to continue.');
  }
}
