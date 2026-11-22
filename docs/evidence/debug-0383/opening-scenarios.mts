import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { CONTENT } from '/workspace/sites/frontier-lab/.sites-checkout/src/content/catalog.ts';
import { RESOURCE_SCALE as U } from '/workspace/sites/frontier-lab/.sites-checkout/src/contracts/types.ts';
import { advanceWeek, createInitialState, validateState } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/engine.ts';
import { canonicalStateHash } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/canonical.ts';
import { deserializeState, serializeState } from '/workspace/sites/frontier-lab/.sites-checkout/src/core/snapshot.ts';
import { companyChapterEarnedWeek } from '/workspace/sites/frontier-lab/.sites-checkout/src/modules/progression-state.ts';
import { NaturalBusinessCampaign } from '/workspace/sites/frontier-lab/.sites-checkout/tests/fixtures/wave5-business.ts';

const results = [];
for (const origin of ['garage', 'university', 'consultancy'] as const) {
  const lab = new NaturalBusinessCampaign(createInitialState(CONTENT, 'release', origin), 'debug-gameplay-' + origin);
  const opening = { seed: lab.state.seed, week: lab.week, cashCents: lab.cash, origin };
  const reloads = [];
  const reload = (label: string) => {
    const original = lab.state, decoded = deserializeState(serializeState(original));
    assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
    assert.equal(canonicalStateHash(decoded.state), canonicalStateHash(original));
    const a = advanceWeek(original), b = advanceWeek(decoded.state);
    assert.ok(a.accepted, a.reason?.message); assert.ok(b.accepted, b.reason?.message);
    assert.equal(canonicalStateHash(a.state), canonicalStateHash(b.state));
    reloads.push({ label, week: lab.week, queuedCommands: original.queuedCommands.length,
      activeTraining: Object.values(original.slices.models.trainingRuns).filter(run => run.status === 'running').length,
      checksum: canonicalStateHash(original), nextWeekChecksum: canonicalStateHash(a.state) });
    lab.state = decoded.state;
  };
  lab.queue({ kind: 'prepare_data', packetId: CONTENT.starterData.id });
  lab.queue({ kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  lab.step(2);
  assert.equal(lab.state.slices.data.packets[CONTENT.starterData.id].prepared, true);
  lab.founder('ml');
  const training = lab.queue({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id });
  lab.step();
  assert.equal(lab.state.slices.models.trainingRuns['training-' + training].status, 'running');
  reload('paid training in progress');
  lab.step(2);
  const trained = lab.state.slices.models.trainingRuns['training-' + training];
  assert.equal(trained.status, 'complete');
  const modelId = trained.outputModelId;
  lab.founder('research'); lab.queue({ kind: 'evaluate_model', modelId });
  reload('paid evaluation queued');
  lab.step();
  const report = Object.values(lab.state.slices.models.reports).find(report => report.modelId === modelId)!;
  assert.ok(report?.heldOut);
  lab.founder('ml'); lab.queue({ kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 });
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, development: 0, research: 0 }); lab.step();
  lab.founder('commercial'); lab.queue({ kind: 'set_cloud_capacity', cu: 2 * U }); lab.step();
  lab.autoCapacity = true;
  assert.ok(lab.offers().some(offer => offer.status === 'active'));
  lab.until(() => lab.company.earnedRevenueCents > 0, 20, origin + ' first revenue');
  const firstRevenueWeek = lab.week;
  lab.until(state => companyChapterEarnedWeek(state, 'first-product') !== null, 20, origin + ' first paying-service chapter');
  reload('first paying service');
  assert.deepEqual(validateState(lab.state), []);
  const deployment = Object.values(lab.state.slices.products.deployments).find(d => d.modelId === modelId)!;
  const ownFacts = lab.state.slices.company.ledger.filter(fact => fact.companyId === lab.state.playerCompanyId);
  assert.ok(ownFacts.some(fact => fact.kind === 'expense' && fact.amountCents > 0));
  assert.equal(lab.company.arrearsCents, 0);
  const result = { opening, finalWeek: lab.week, preparationWeek: Object.values(lab.state.slices.data.preparationJobs).find(job => job.packetId === CONTENT.starterData.id)?.completedWeek,
    trainingStartedWeek: trained.startedWeek, trainingCompletedWeek: trained.completedWeek, paidTrainingCUw: trained.physicalWork / U,
    evaluationWeek: report.week, deploymentReadyWeek: deployment.readyWeek, firstRevenueWeek,
    chapterWeek: companyChapterEarnedWeek(lab.state, 'first-product'), earnedRevenueCents: lab.company.earnedRevenueCents,
    cashCents: lab.cash, minimumCashCents: lab.minimumCashCents, arrearsCents: lab.company.arrearsCents,
    paidExpenseCents: ownFacts.filter(fact => fact.kind === 'expense').reduce((sum, fact) => sum + fact.amountCents, 0),
    pilot: lab.state.slices.campaign.customerBriefs?.['consultancy-pilot'] ?? null,
    commands: lab.commands.length, commandKinds: [...new Set(lab.commands.map(command => command.payload.kind))], reloads };
  results.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync('/tmp/frontier-gameplay-opening.json', JSON.stringify({ build: CONTENT.buildVersion, content: CONTENT.version, directStateMutation: false, cases: results }, null, 2) + '\n');
