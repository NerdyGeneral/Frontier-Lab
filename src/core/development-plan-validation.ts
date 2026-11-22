import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import type { DevelopmentPlanSpec } from '../contracts/development-plans';
import { DEVELOPMENT_PLAN_LIMIT } from '../contracts/development-plans';
import { canonicalStateHash } from './canonical';
import { assertCommandShape } from './command-shape';
import { CONTENT } from '../content/catalog';
import { TRAINING_RECIPES } from '../content/wave2-lab';
import { getModelDesignForecast } from '../modules/model-design';
import { packetOwnedBy } from '../modules/lab-planner';
import { preparationTerms } from '../modules/lab-data';

function fail(message: string): never { throw new Error('Development plan: ' + message); }
function integer(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) fail(name + ' must be a nonnegative safe integer.');
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(value)) fail('invalid identifier.');
}
function keys(value: object, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('unknown or missing fields.');
}
function limits(spec: Pick<DevelopmentPlanSpec, 'feeBudgetCents' | 'cashReserveCents' | 'deadlineWeek'>) {
  integer(spec.feeBudgetCents, 'Fee budget', 100_000_000_000); integer(spec.cashReserveCents, 'Cash reserve', 100_000_000_000); integer(spec.deadlineWeek, 'Deadline');
}
export function assertDevelopmentPlanCommand(payload: CommandPayload) {
  if (payload.kind === 'start_development_plan') {
    keys(payload, ['kind', 'name', 'training', 'suiteId', 'feeBudgetCents', 'cashReserveCents', 'deadlineWeek']);
    if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(payload.name)) fail('choose a name of 1–60 characters.');
    limits(payload);
    if (payload.training?.kind !== 'start_training') fail('the plan must contain one training design.');
    keys(payload.training, ['kind', 'baseModelId', 'packetId'], ['modelDesign', 'recipeId', 'packetIds', 'profile', 'workspace', 'continueFromParent', 'automatedCheckpoints', 'teacherModelId', 'teacherDomain', 'architecture', 'asAdapter', 'replay', 'curriculum']);
    assertCommandShape(payload.training);
    if (!['basic-conversation-1', 'expanded-capabilities-1', 'advanced-capabilities-1', 'behavior-cases-1'].includes(payload.suiteId)) fail('choose a capability or behavior test.');
  } else if (payload.kind === 'revise_development_plan') {
    keys(payload, ['kind', 'planId', 'feeBudgetCents', 'cashReserveCents', 'deadlineWeek']); id(payload.planId); limits(payload);
  } else if (payload.kind === 'set_development_plan_paused') {
    keys(payload, ['kind', 'planId', 'paused']); id(payload.planId); if (typeof payload.paused !== 'boolean') fail('choose pause or resume.');
  } else if (payload.kind === 'cancel_development_plan') { keys(payload, ['kind', 'planId']); id(payload.planId); }
  else fail('unknown plan command.');
}

export function assertDevelopmentPlansState(state: GameState, content: GameContent = CONTENT) {
  const plans = state.slices.models.developmentPlans;
  if (plans === undefined) return;
  if (!plans || typeof plans !== 'object' || Array.isArray(plans) || Object.keys(plans).length > DEVELOPMENT_PLAN_LIMIT) fail('invalid plan collection.');
  const commandIds = new Set<string>(); let active = 0;
  for (const [key, plan] of Object.entries(plans)) {
    keys(plan, ['id', 'companyId', 'name', 'training', 'suiteId', 'feeBudgetCents', 'cashReserveCents', 'deadlineWeek', 'createdWeek', 'status', 'stage', 'steps', 'message'], ['decisionWeek', 'completedWeek', 'modelId', 'reportId']);
    const { id: planId, companyId, createdWeek, status, stage, steps, message, decisionWeek, completedWeek, modelId, reportId, ...spec } = plan;
    id(planId); if (planId !== key || !planId.startsWith('development-') || companyId !== state.playerCompanyId) fail('plan ownership is invalid.');
    assertDevelopmentPlanCommand({ kind: 'start_development_plan', ...spec });
    integer(createdWeek, 'Created week'); if (createdWeek > state.week || plan.deadlineWeek <= createdWeek) fail('invalid plan dates.');
    const authorization = state.commandReceipts[planId.slice('development-'.length)];
    if (authorization?.status !== 'accepted' || authorization.week !== createdWeek) fail('plan has no accepted authorization at its creation boundary.');
    if (!['running', 'paused', 'blocked', 'review', 'cancelled'].includes(status) || !['prepare', 'train', 'evaluate', 'review'].includes(stage)) fail('invalid stage or status.');
    if (!['review', 'cancelled'].includes(status)) active++;
    if (typeof message !== 'string' || message.length > 2000) fail('invalid status message.');
    if (!state.slices.models.versions[plan.training.baseModelId] || state.slices.models.versions[plan.training.baseModelId].companyId !== companyId) fail('base model is missing.');
    const packets = [...new Set([plan.training.packetId, ...(plan.training.packetIds ?? [])])];
    if (packets.some(packetId => !state.slices.data.packets[packetId] || !packetOwnedBy(state.slices.data.packets[packetId], companyId, state.playerCompanyId))) fail('selected data is missing or belongs to another company.');
    if (!Array.isArray(steps) || steps.length > 1040) fail('invalid stage history.');
    const acceptedKeys = new Set<string>(); let previousIssuedWeek = createdWeek, queuedStages = 0;
    for (const step of steps) {
      keys(step, ['key', 'commandId', 'issuedWeek', 'feeCents', 'payload']); id(step.commandId); integer(step.issuedWeek, 'Stage week'); integer(step.feeCents, 'Stage fee');
      if (!step.commandId.startsWith('development-stage-') || commandIds.has(step.commandId) || step.issuedWeek <= previousIssuedWeek || step.issuedWeek > state.week + 1) fail('invalid stage identity or chronology.');
      previousIssuedWeek = step.issuedWeek;
      commandIds.add(step.commandId); assertCommandShape(step.payload);
      if (step.key === 'train') { if (canonicalStateHash(step.payload) !== canonicalStateHash(plan.training)) fail('training differs from the chosen design.'); }
      else if (step.key === 'evaluate') {
        const evaluatedModelId = step.payload.kind === 'evaluate_model' ? step.payload.modelId : '';
        if (step.payload.kind !== 'evaluate_model' || step.payload.suiteId !== plan.suiteId || !steps.some(s => s.key === 'train' && 'model-' + s.commandId === evaluatedModelId && state.commandReceipts[s.commandId]?.status === 'accepted')) fail('evaluation does not use the plan output.');
      } else if (step.payload.kind !== 'prepare_data' || step.key !== 'prepare:' + step.payload.packetId || !packets.includes(step.payload.packetId)) fail('preparation differs from selected data.');
      const expectedFee = step.payload.kind === 'prepare_data' ? preparationTerms(state.slices.data.packets[step.payload.packetId], content).feeCents
        : step.payload.kind === 'evaluate_model' ? 0 : step.payload.modelDesign
          ? getModelDesignForecast(state, companyId, step.payload.baseModelId, step.payload.packetIds ?? [step.payload.packetId], step.payload.modelDesign, step.issuedWeek).feeCents
          : TRAINING_RECIPES.find(recipe => recipe.id === (step.payload.kind === 'start_training' ? step.payload.recipeId ?? content.firstTraining.id : ''))?.feeCents;
      if (step.feeCents !== expectedFee) fail('stage fee differs from its canonical preparation or training price.');
      const queued = state.queuedCommands.find(c => c.id === step.commandId), receipt = state.commandReceipts[step.commandId];
      if (!queued && !receipt) fail('stage has no command evidence.');
      if (queued) queuedStages++;
      if (queued && (queued.companyId !== companyId || queued.issuedForWeek !== step.issuedWeek || queued.reservedCents !== step.feeCents || canonicalStateHash(queued.payload) !== canonicalStateHash(step.payload))) fail('queued stage differs from its authorization.');
      if (receipt) {
        if (receipt.week !== step.issuedWeek) fail('stage receipt has a different week.');
        if (receipt.status === 'accepted') {
          if (acceptedKeys.has(step.key)) fail('the same stage was paid more than once.'); acceptedKeys.add(step.key);
          const job = step.key === 'train' ? state.slices.models.trainingRuns['training-' + step.commandId] : step.key === 'evaluate' ? state.slices.models.evaluationRuns['evaluation-' + step.commandId] : state.slices.data.preparationJobs['preparation-' + step.commandId];
          if (!job || job.companyId !== companyId || job.startedWeek !== receipt.week) fail('accepted stage has no matching paid work.');
          if (step.payload.kind === 'prepare_data') {
            const preparation = state.slices.data.preparationJobs[job.id];
            if (!preparation || preparation.packetId !== step.payload.packetId || preparation.kind !== 'prepare') fail('paid preparation belongs to different data or work.');
          } else if (step.payload.kind === 'start_training') {
            const training = state.slices.models.trainingRuns[job.id];
            if (!training || training.baseModelId !== step.payload.baseModelId || training.packetId !== step.payload.packetId
              || training.recipeId !== (step.payload.recipeId ?? content.firstTraining.id)
              || step.payload.modelDesign && canonicalStateHash(training.plan?.modelDesign?.spec ?? null) !== canonicalStateHash(step.payload.modelDesign)
              || step.payload.profile && training.plan?.profile !== step.payload.profile
              || step.payload.workspace !== training.plan?.workspace) fail('paid training differs from the authorized choices.');
            if (steps.filter(item => item.payload.kind === 'prepare_data' && state.commandReceipts[item.commandId]?.status === 'accepted').some(item => {
              const preparation = state.slices.data.preparationJobs['preparation-' + item.commandId];
              return preparation.status !== 'complete' || preparation.completedWeek === undefined || preparation.completedWeek >= training.startedWeek;
            })) fail('training started before its prepared outputs were available.');
          } else {
            const evaluation = state.slices.models.evaluationRuns[job.id];
            const trainingStep = steps.find(item => item.key === 'train' && state.commandReceipts[item.commandId]?.status === 'accepted');
            const training = trainingStep && state.slices.models.trainingRuns['training-' + trainingStep.commandId];
            if (!evaluation || evaluation.modelId !== step.payload.modelId || (evaluation.suiteId ?? 'basic-conversation-1') !== step.payload.suiteId
              || !training || training.status !== 'complete' || training.completedWeek === undefined || training.completedWeek >= evaluation.startedWeek) fail('evaluation started before the actual completed training output.');
          }
          const facts = state.slices.company.ledger.filter(f => f.sourceId === job.id && f.week === job.startedWeek && f.kind === 'expense');
          if (facts.length && facts.reduce((sum, f) => sum + f.amountCents, 0) !== step.feeCents) fail('fee evidence differs from payment.');
        }
      }
    }
    if (queuedStages > 1) fail('more than one future stage was scheduled.');
    const accepted = steps.filter(s => state.commandReceipts[s.commandId]?.status === 'accepted');
    if (accepted.reduce((sum, s) => sum + s.feeCents, 0) > plan.feeBudgetCents) fail('paid fees exceed the authorized budget.');
    if (modelId && (!state.slices.models.versions[modelId] || !accepted.some(s => s.key === 'train' && 'model-' + s.commandId === modelId && state.slices.models.trainingRuns['training-' + s.commandId]?.status === 'complete'))) fail('output model has no completed training evidence.');
    if (decisionWeek !== undefined) { integer(decisionWeek, 'Decision week'); if (decisionWeek > state.week || decisionWeek < createdWeek) fail('invalid decision date.'); }
    if (status === 'review') {
      const report = reportId && state.slices.models.reports[reportId];
      if (!report || report.companyId !== companyId || report.modelId !== modelId || report.suiteId !== plan.suiteId || completedWeek !== report.week || stage !== 'review'
        || decisionWeek === undefined || decisionWeek < report.week || !accepted.some(s => s.key === 'evaluate' && state.slices.models.evaluationRuns['evaluation-' + s.commandId]?.reportId === reportId)) fail('review lacks the completed evaluation evidence.');
    } else if (completedWeek !== undefined || reportId !== undefined || stage === 'review') fail('unfinished plan has completion evidence.');
    if ((status === 'blocked' || status === 'cancelled') && decisionWeek === undefined) fail('stopped plan has no decision boundary.');
    if (status === 'cancelled' && steps.some(step => step.issuedWeek > decisionWeek!)) fail('cancelled plan issued another stage.');
  }
  if (active > 1) fail('only one unfinished delegated plan is supported.');
}
