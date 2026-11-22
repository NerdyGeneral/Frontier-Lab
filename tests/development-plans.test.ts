import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import type { DevelopmentPlanSpec } from '../src/contracts/development-plans';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertDevelopmentPlansState } from '../src/core/development-plan-validation';
import { getWeeklyBaseCost } from '../src/core/selectors';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { developmentFeeSpent, developmentQuote } from '../src/modules/development-plans';
import { developmentFeasibility, developmentArchiveProofId, limitDevelopmentRequests, pinDevelopmentGoal } from '../src/modules/development-projects';
import { createResearchModule, hasResearch } from '../src/modules/research';
import { CAREER_RANKS } from '../src/modules/staff-careers';
import { isPaidChallengeReport } from '../src/modules/model-challenges';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule } from '../src/modules/lab';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createLabModule(CONTENT)];
function step(state: GameState): GameState {
  const result = advanceWeek(state, CONTENT, modules); assert.ok(result.accepted, result.reason?.message); return result.state;
}
function queue(state: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(state, payload, CONTENT, id); assert.ok(result.accepted, result.reason?.message); return result.state;
}
function until(state: GameState, done: (game: GameState) => boolean, limit = 100): GameState {
  for (let i = 0; i < limit && !done(state); i++) state = step(state);
  assert.ok(done(state), 'The development plan did not reach its expected boundary.'); return state;
}
function reload(state: GameState): GameState {
  const decoded = deserializeState(serializeState(state)); assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}
function initial(prepared = false): GameState {
  let game = createPlayerOnlyState(); for (let i = 0; i < 3; i++) game = step(game);
  const owner = game.playerCompanyId;
  game.slices.company.companies[owner].cashCents = 100_000_000;
  game.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), research: U };
  for (const [id, role] of [['reviewer', 'research'], ['data', 'data'], ['ml1', 'ml'], ['ml2', 'ml']] as const)
    game.slices.company.staff[id] = { id, companyId: owner, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  game.slices.company.companies[owner].activeStaff = 4;
  const fleet = game.slices.compute.fleets[owner]; fleet.cloudCU = 16 * U; fleet.memoryMU = 32 * U; fleet.allocation = { serving: 0, development: 16 * U, research: 0 };
  const packet = game.slices.data.packets[CONTENT.starterData.id]; packet.prepared = prepared; packet.readyUnits = prepared ? packet.rawUnits : 0;
  assert.deepEqual(validateState(game), []); return game;
}
function spec(state: GameState, work = 24 * U): DevelopmentPlanSpec {
  const training: DevelopmentPlanSpec['training'] = { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id,
    recipeId: 'custom-model-adaptation', modelDesign: { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Delegated candidate', computeBudgetCUw: work } };
  const plan = { name: 'Prepare, train, test', training, suiteId: 'basic-conversation-1' as const, feeBudgetCents: 1_000_000, cashReserveCents: 0, deadlineWeek: state.week + 40 };
  plan.feeBudgetCents = developmentQuote(state, plan, CONTENT).totalFeeCents; return plan;
}
function start(state: GameState, plan = spec(state)): GameState { return step(queue(state, { kind: 'start_development_plan', ...plan }, 'pipeline')); }
const plan = (state: GameState) => state.slices.models.developmentPlans!['development-pipeline'];
const trainingRun = (state: GameState) => {
  const instruction = plan(state).steps.find(item => item.key === 'train' && state.commandReceipts[item.commandId]?.status === 'accepted');
  return instruction ? state.slices.models.trainingRuns['training-' + instruction.commandId] : undefined;
};
const finish = (state: GameState) => until(state, game => plan(game).status === 'review');

test('connected plan performs paid preparation, training and evaluation once, then stops for review across reload', () => {
  let game = initial(), chosen = spec(game); game = start(game, chosen);
  assert.equal(game.commandReceipts.pipeline.status, 'accepted'); assert.equal(plan(game).steps.length, 1);
  assert.equal(plan(game).steps[0].payload.kind, 'prepare_data');
  const restored = reload(game), finished = finish(game), replayed = finish(restored);
  assert.deepEqual(replayed, finished); game = finished;
  const record = plan(game), preparation = record.steps[0], training = record.steps[1], evaluation = record.steps[2];
  assert.deepEqual(record.steps.map(item => item.key), ['prepare:' + CONTENT.starterData.id, 'train', 'evaluate']);
  assert.ok(preparation.issuedWeek < training.issuedWeek && training.issuedWeek < evaluation.issuedWeek);
  assert.equal(developmentFeeSpent(game, record), chosen.feeBudgetCents);
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === 'preparation-' + preparation.commandId + ':fee').length, 1);
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === 'training-' + training.commandId + ':setup').length, 1);
  assert.equal(record.modelId, 'model-' + training.commandId); assert.equal(record.reportId, 'report-evaluation-' + evaluation.commandId);
  assert.equal(record.completedWeek, game.slices.models.reports[record.reportId!].week);
  assert.deepEqual(game.slices.products.offers, {}, 'Delegation stops before any release decision.');
  const unchanged = structuredClone(record); game = step(step(game)); assert.deepEqual(plan(game), unchanged); assert.deepEqual(reload(game), game);
});

test('a completed custom design is rejected before a delegated plan consumes a week or active slot', () => {
  let game = initial(true); const chosen = spec(game);
  game = until(queue(game, chosen.training, 'completed-design'), state => state.slices.models.trainingRuns['training-completed-design']?.status === 'complete');
  game = reload(game);
  const repeat = { ...chosen, deadlineWeek: game.week + 40,
    training: { ...chosen.training, modelDesign: { ...chosen.training.modelDesign!, name: 'Renamed repeat' } } };
  assert.equal(getTrainingPreview(game, game.playerCompanyId, repeat.training).reason?.code, 'NO_IMPROVEMENT');
  assert.equal(developmentQuote(game, repeat, CONTENT).training.reason?.code, 'NO_IMPROVEMENT');
  const direct = submitCommand(game, repeat.training), delegated = submitCommand(game, { kind: 'start_development_plan', ...repeat });
  assert.equal(direct.reason?.code, 'NO_IMPROVEMENT'); assert.equal(delegated.reason?.code, 'NO_IMPROVEMENT');
  assert.equal(delegated.accepted, false); assert.equal(delegated.state, game);
  assert.deepEqual(game.slices.models.developmentPlans ?? {}, {});
});

test('a queued custom design blocks direct and delegated duplicates but does not reject its own commit', () => {
  let game = initial(true); const chosen = spec(game, 96 * U);
  game = queue(game, chosen.training, 'queued-design');
  assert.equal(getTrainingPreview(game, game.playerCompanyId, chosen.training).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(submitCommand(game, chosen.training).reason?.code, 'ALREADY_ACTIVE');
  const delegated = submitCommand(game, { kind: 'start_development_plan', ...chosen });
  assert.equal(delegated.accepted, false); assert.equal(delegated.reason?.code, 'ALREADY_ACTIVE'); assert.equal(delegated.state, game);
  game = step(reload(game));
  assert.equal(game.commandReceipts['queued-design'].status, 'accepted');
  assert.equal(game.slices.models.trainingRuns['training-queued-design'].status, 'running');
  assert.equal(submitCommand(game, { kind: 'start_development_plan', ...chosen }).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === 'training-queued-design:setup').length, 1);
  assert.deepEqual(reload(game), game);
});

test('the advertised minimum deadline survives admission and permits the last evaluation week', () => {
  let game = initial(true); const deadlineWeek = game.week + 3;
  const chosen: DevelopmentPlanSpec = { name: 'Three week prepared plan', training: { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id },
    suiteId: 'basic-conversation-1', feeBudgetCents: 0, cashReserveCents: 0, deadlineWeek };
  game = start(game, chosen); assert.equal(game.commandReceipts.pipeline.status, 'accepted');
  game = finish(game); assert.equal(plan(game).completedWeek, deadlineWeek);
});

test('pause and resume preserve a paid training run and charge its setup only once', () => {
  let game = start(initial(true), spec(initial(true), 96 * U));
  game = until(game, state => !!trainingRun(state)); const run = trainingRun(game)!;
  game = step(queue(game, { kind: 'set_development_plan_paused', planId: plan(game).id, paused: true }));
  const work = game.slices.models.trainingRuns[run.id].completedWork;
  game = reload(step(step(game))); assert.equal(game.slices.models.trainingRuns[run.id].completedWork, work);
  assert.equal(game.slices.models.trainingRuns[run.id].status, 'paused');
  game = finish(queue(game, { kind: 'set_development_plan_paused', planId: plan(game).id, paused: false }));
  assert.equal(plan(game).steps.filter(item => item.key === 'train').length, 1);
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === run.id + ':setup').length, 1);
});

test('same-boundary pause or cancellation prevents a queued paid stage from charging, and pause can retry once', () => {
  for (const cancel of [false, true]) {
    let game = start(initial(true)); const pending = plan(game).steps[0];
    assert.equal(pending.key, 'train');
    game = queue(game, cancel ? { kind: 'cancel_development_plan', planId: plan(game).id }
      : { kind: 'set_development_plan_paused', planId: plan(game).id, paused: true }, 'stop-now');
    game = step(game);
    assert.equal(game.commandReceipts['stop-now'].status, 'accepted');
    assert.equal(game.commandReceipts[pending.commandId].status, 'rejected');
    assert.equal(game.slices.models.trainingRuns['training-' + pending.commandId], undefined);
    assert.equal(game.slices.company.postedFacts['training-' + pending.commandId + ':setup'], undefined);
    assert.equal(developmentFeeSpent(game, plan(game)), 0);
    if (cancel) {
      const record = structuredClone(plan(game)); game = step(step(game)); assert.deepEqual(plan(game), record);
    } else {
      game = finish(queue(game, { kind: 'set_development_plan_paused', planId: plan(game).id, paused: false }));
      assert.equal(plan(game).steps.filter(item => item.key === 'train' && game.commandReceipts[item.commandId]?.status === 'accepted').length, 1);
      assert.equal(developmentFeeSpent(game, plan(game)), plan(game).feeBudgetCents);
    }
    assert.deepEqual(reload(game), game);
  }
});

test('a tightened fee budget stops the next handoff and revising it continues without repeating preparation', () => {
  let game = initial(); const chosen = spec(game); game = start(game, chosen);
  game = queue(game, { kind: 'revise_development_plan', planId: plan(game).id, feeBudgetCents: CONTENT.preparation.feeCents,
    cashReserveCents: 0, deadlineWeek: chosen.deadlineWeek });
  game = until(game, state => plan(state).status === 'blocked');
  assert.match(plan(game).message, /fee budget/i); assert.equal(trainingRun(game), undefined);
  assert.equal(developmentFeeSpent(game, plan(game)), CONTENT.preparation.feeCents);
  game = finish(queue(game, { kind: 'revise_development_plan', planId: plan(game).id, feeBudgetCents: chosen.feeBudgetCents,
    cashReserveCents: 0, deadlineWeek: game.week + 20 }));
  assert.equal(plan(game).steps.filter(item => item.key.startsWith('prepare:')).length, 1);
  assert.equal(developmentFeeSpent(game, plan(game)), chosen.feeBudgetCents);
});

test('cash reserve considers known weekly bills and earlier committed fees before a delegated stage', () => {
  let game = initial(true); const chosen = { ...spec(game), cashReserveCents: 100_000 }; game = start(game, chosen);
  const stage = plan(game).steps[0], base = getWeeklyBaseCost(game, CONTENT);
  game.slices.company.companies[game.playerCompanyId].cashCents = 600_000 + stage.feeCents + base + chosen.cashReserveCents - 1;
  game = queue(game, { kind: 'buy_data', catalogId: 'specialist-coding-1' }, 'earlier-purchase');
  // Both orders are authorized; settlement must honor the reserve under either valid queue order.
  game.queuedCommands.sort((a, b) => Number(b.id === 'earlier-purchase') - Number(a.id === 'earlier-purchase'));
  assert.deepEqual(validateState(game), []); game = step(game);
  assert.equal(game.commandReceipts['earlier-purchase'].status, 'accepted'); assert.equal(game.commandReceipts[stage.commandId].status, 'rejected');
  assert.match(game.commandReceipts[stage.commandId].reason!.message, /reserve/);
  assert.equal(plan(game).status, 'blocked'); assert.equal(trainingRun(game), undefined);
  assert.equal(game.slices.company.companies[game.playerCompanyId].cashCents, chosen.cashReserveCents + stage.feeCents - 1);
});

test('deadline stops active work after its final week and an extension resumes the same paid run', () => {
  let game = initial(true); const chosen = { ...spec(game, 96 * U), deadlineWeek: game.week + 3 }; game = start(game, chosen);
  game = until(game, state => plan(state).status === 'blocked');
  assert.equal(game.week, chosen.deadlineWeek); assert.match(plan(game).message, /deadline/);
  const run = trainingRun(game)!; assert.equal(run.status, 'paused'); assert.ok(run.completedWork > 0 && run.completedWork < run.requiredWork);
  game = finish(queue(game, { kind: 'revise_development_plan', planId: plan(game).id, feeBudgetCents: chosen.feeBudgetCents, cashReserveCents: 0, deadlineWeek: game.week + 20 }));
  assert.equal(plan(game).steps.filter(item => item.key === 'train').length, 1); assert.equal(game.slices.company.ledger.filter(fact => fact.id === run.id + ':setup').length, 1);
});

test('review preserves the real report date if an individually resumed evaluation finishes while the plan is paused', () => {
  let game = start(initial(true)); game = until(game, state => plan(state).steps.some(item => item.key === 'evaluate'));
  game = step(queue(game, { kind: 'allocate_compute', serving: 0, development: U, research: 0 }));
  const evaluationId = 'evaluation-' + plan(game).steps.find(item => item.key === 'evaluate')!.commandId;
  assert.equal(game.slices.models.evaluationRuns[evaluationId].status, 'running');
  game = step(queue(game, { kind: 'set_development_plan_paused', planId: plan(game).id, paused: true }));
  game = step(queue(game, { kind: 'set_job_paused', jobId: evaluationId, paused: false }));
  const reportWeek = game.slices.models.reports[game.slices.models.evaluationRuns[evaluationId].reportId!].week;
  assert.equal(plan(game).status, 'paused');
  game = step(queue(game, { kind: 'set_development_plan_paused', planId: plan(game).id, paused: false }));
  assert.equal(plan(game).status, 'review'); assert.equal(plan(game).completedWeek, reportWeek); assert.equal(plan(game).decisionWeek, reportWeek + 1);
  assert.deepEqual(reload(game), game);
});

test('malformed authorizations and forged stage receipts are rejected even after the recent fee ledger is gone', () => {
  const opening = initial(), chosen = spec(opening);
  for (const mutate of [
    (value: Record<string, unknown>) => { value.deadlineWeek = Number.NaN; },
    (value: Record<string, unknown>) => { value.cashReserveCents = -1; },
    (value: Record<string, unknown>) => { value.training = { kind: 'cancel_development_plan', planId: 'unowned' }; },
    (value: Record<string, unknown>) => { (value.training as Record<string, unknown>).surprise = true; },
  ]) { const payload = structuredClone({ kind: 'start_development_plan', ...chosen }) as Record<string, unknown>; mutate(payload); assert.equal(submitCommand(opening, payload as unknown as CommandPayload, CONTENT).accepted, false); }
  const done = finish(start(opening, chosen)), record = plan(done);
  for (const mutate of [
    (state: GameState) => { delete state.commandReceipts.pipeline; },
    (state: GameState) => { plan(state).steps.reverse(); },
    (state: GameState) => { const instruction = plan(state).steps.find(item => item.key === 'train')!; instruction.feeCents = 0; state.slices.company.ledger = state.slices.company.ledger.filter(fact => fact.sourceId !== 'training-' + instruction.commandId); },
    (state: GameState) => { plan(state).completedWeek = state.week - 1; },
    (state: GameState) => { plan(state).feeBudgetCents = 0; },
    (state: GameState) => { plan(state).training.modelDesign!.name = 'Changed paid design'; (plan(state).steps.find(item => item.key === 'train')!.payload as DevelopmentPlanSpec['training']).modelDesign!.name = 'Changed paid design'; },
  ]) { const forged = structuredClone(done); mutate(forged); assert.throws(() => assertDevelopmentPlansState(forged, CONTENT)); }
  assert.equal(record.steps.length, 3); assert.deepEqual(reload(done), done);
});

test('a saved systems objective runs its real paid challenge after the capability baseline and survives reload', () => {
  let game = initial(true);
  game.slices.compute.fleets[game.playerCompanyId].allocation = { serving: 0, development: 14 * U, research: 2 * U };
  game = queue(game, { kind: 'start_research', researchId: 'R1' }, 'objective-research');
  for (let i = 0; i < 20 && !hasResearch(game, game.playerCompanyId, 'R1'); i++) {
    const result = advanceWeek(game, CONTENT, [...modules, createResearchModule(CONTENT)]); assert.ok(result.accepted, result.reason?.message); game = result.state;
  }
  assert.ok(hasResearch(game, game.playerCompanyId, 'R1'));
  const chosen: DevelopmentPlanSpec = { ...spec(game), objective: { kind: 'system-challenge', id: 'systems-memory-1' }, leadStaffId: 'founder', capacityShareBps: 10000 };
  game = start(game, chosen);
  game = until(game, state => plan(state).stage === 'challenge');
  const resumed = finish(reload(game)); game = finish(game); assert.deepEqual(resumed, game);
  const saved = plan(game), baseline = game.slices.models.reports[saved.reportId!], challenge = game.slices.models.reports[saved.challengeReportId!];
  assert.equal(challenge.suiteId, 'systems-memory-1'); assert.equal(challenge.modelId, saved.modelId);
  assert.equal(challenge.challenge?.admission.baselineReportId, baseline.id); assert.ok(baseline.week < challenge.week);
  assert.ok(isPaidChallengeReport(game, challenge, game.week)); assert.equal(saved.completedWeek, challenge.week);
  assert.deepEqual(saved.steps.map(stage => stage.key), ['train', 'evaluate', 'challenge']);
  assert.deepEqual(game.slices.products.offers, {}, 'A completed goal does not release or sign a customer commitment.');
  for (const mutate of [
    (value: GameState) => { plan(value).objective = { kind: 'system-challenge', id: 'systems-cost-1' }; },
    (value: GameState) => { delete plan(value).objective; },
    (value: GameState) => { delete plan(value).challengeReportId; },
  ]) { const forged = structuredClone(game); mutate(forged); assert.throws(() => assertDevelopmentPlansState(forged)); }
});

test('parallel projects reserve distinct senior leads and real capacity, and losing a lead stops that project', () => {
  let game = initial(true); for (let i = 0; i < 5; i++) game = step(game);
  game.slices.company.passiveWorkforce = true;
  game.slices.company.staff.reviewer.career = { experience: CAREER_RANKS[1].threshold, lastEarned: U / 100, earnedWeek: game.week };
  assert.deepEqual(validateState(game), []);
  const first = { ...spec(game, 160 * U), leadStaffId: 'founder', capacityShareBps: 5000 };
  const second = { ...spec(game, 120 * U), name: 'Second model line', leadStaffId: 'reviewer', capacityShareBps: 5000 };
  game = queue(game, { kind: 'start_development_plan', ...first }, 'parallel-founder');
  assert.equal(submitCommand(game, { kind: 'start_development_plan', ...second, leadStaffId: 'founder' }).accepted, false);
  assert.equal(submitCommand(game, { kind: 'start_development_plan', ...second, capacityShareBps: 6000 }).accepted, false);
  game = queue(game, { kind: 'start_development_plan', ...second }, 'parallel-senior'); game = step(game); game = step(game);
  assert.equal(Object.values(game.slices.models.developmentPlans!).filter(item => item.status === 'running').length, 2);
  const seniorPlan = game.slices.models.developmentPlans!['development-parallel-senior'];
  const seniorTraining = seniorPlan.steps.find(item => item.key === 'train')!;
  const jobId = 'training-' + seniorTraining.commandId;
  const limited = limitDevelopmentRequests(game, [{ id: jobId + ':work', companyId: game.playerCompanyId, taskId: jobId, category: 'development', normalizedWorkCUw: 80 * U, memoryMU: U, priority: 40, poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: 10 * U }] }]);
  assert.equal(limited[0].normalizedWorkCUw, 8 * U);
  assert.ok(limited[0].staffDemand![0].staffWeeks < 10 * U);
  const before = game.slices.models.trainingRuns[jobId].completedWork;
  game = step(queue(game, { kind: 'dismiss_staff', staffId: 'reviewer' }));
  assert.equal(game.slices.models.developmentPlans![seniorPlan.id].status, 'blocked');
  assert.match(game.slices.models.developmentPlans![seniorPlan.id].message, /lead/);
  assert.equal(game.slices.models.trainingRuns[jobId].completedWork, before, 'No paid work proceeds under an unavailable responsible lead.');
  assert.deepEqual(reload(game), game);
});

test('finished plans compact before the 101st authorization without losing paid outputs or archived proof', () => {
  let game = finish(start(initial(true))); game.slices.company.companies[game.playerCompanyId].cashCents = 1_000_000_000;
  const first = structuredClone(plan(game)), originalModel = structuredClone(game.slices.models.versions[first.modelId!]);
  for (let i = 0; i < 100; i++) {
    const id = 'archive-history-' + i;
    game = step(queue(game, { kind: 'start_development_plan', ...spec(game, (32 + i) * U) }, id));
    game = step(queue(game, { kind: 'cancel_development_plan', planId: 'development-' + id }));
  }
  const archived = game.slices.models.developmentPlanArchive![first.id];
  assert.ok(archived); assert.ok(Object.keys(game.slices.models.developmentPlans!).length <= 100);
  assert.equal(archived.modelId, first.modelId); assert.equal(archived.reportId, first.reportId);
  assert.deepEqual(game.slices.models.versions[first.modelId!], originalModel);
  assert.equal(game.slices.company.postedFacts[developmentArchiveProofId(archived)], true);
  const restored = reload(game); assert.deepEqual(restored, game);
  const changed = structuredClone(game); changed.slices.models.developmentPlanArchive![first.id].feeSpentCents++;
  assert.throws(() => assertDevelopmentPlansState(changed), /archiv/);
  const removed = structuredClone(game); delete removed.slices.models.developmentPlanArchive![first.id];
  assert.throws(() => assertDevelopmentPlansState(removed), /archiv/);
});

test('planning pins customer terms and exposes missing capacity and acceptance-window risk', () => {
  const game = initial(true), objective = pinDevelopmentGoal(game, { kind: 'renewable-brief', id: 'bounded-memory' });
  assert.equal(objective?.kind, 'renewable-brief'); if (objective?.kind !== 'renewable-brief') throw new Error('Expected pinned customer terms.');
  const future = structuredClone(game); future.week = objective.terms.acceptUntilWeek + 20;
  assert.deepEqual(pinDevelopmentGoal(future, objective), objective, 'A saved customer target must not follow later offers.');
  const chosen = { ...spec(game, 400 * U), objective, capacityShareBps: 5000 };
  const forecast = developmentFeasibility(game, chosen, CONTENT);
  assert.ok(forecast.nominalWeeks !== null && forecast.cautiousWeeks! >= forecast.nominalWeeks);
  assert.ok(forecast.issues.some(issue => /offer closes/.test(issue)));
  const noSupervision = structuredClone(game);
  delete noSupervision.slices.company.passiveWorkforce;
  noSupervision.slices.company.staff = {};
  noSupervision.slices.company.founderAssignments[game.playerCompanyId] = { ...emptyRoleAllocation(), research: U };
  assert.equal(developmentFeasibility(noSupervision, chosen, CONTENT).nominalWeeks, null, 'Spare GPUs cannot produce an ETA without training supervision.');
  game.slices.compute.fleets[game.playerCompanyId].allocation.development = 0;
  const unavailable = developmentFeasibility(game, chosen, CONTENT);
  assert.equal(unavailable.nominalWeeks, null); assert.equal(unavailable.operatingHighCents, null);
  assert.ok(unavailable.issues.some(issue => /no assigned staff or compute/.test(issue)));
});
