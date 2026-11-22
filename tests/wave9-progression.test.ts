import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { getQualifiedReleaseRehearsal, releaseRehearsalWorkId } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W9-N01: an earned company compares a paid candidate, serves through its handover, and funds a bounded rollback', () => {
  const raw = readFileSync(join(__dirname, 'fixtures/wave8-snapshot.json'), 'utf8'), imported = deserializeState(raw);
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const run = new NaturalBusinessCampaign(imported.state, 'wave9-natural'), owner = run.state.playerCompanyId;
  const product = run.offers().find(item => item.kind === 'developer-api')!, productId = product.id;
  const sourceModelId = run.state.slices.products.deployments[product.deploymentId].modelId;
  const originalContractId = product.contractId, originalSource = canonicalStateHash(run.state.slices.models.versions[sourceModelId]);
  const originalContracts = Object.keys(run.state.slices.products.commercialContracts).sort();
  run.mark('Published Wave 8 company with earned hardware and paid contracts');
  run.discover('R7');
  const variantCommand = run.queue({ kind: 'create_model_variant', modelId: sourceModelId, variant: 'compression' });
  const candidateModelId = 'variant:' + variantCommand;
  run.until(state => !!state.slices.models.versions[candidateModelId], 12, 'paid compressed model');
  run.evaluate(candidateModelId);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated');
  run.queue({ kind: 'set_product_terms', productId, priceCents: 6001, allowance: 599 }); run.step();
  const fixedContract = { ...run.state.slices.products.contracts[originalContractId], tokenBillRemainder: 0 };
  const beforeRehearsal = serializeState(run.state);
  run.mark('Compression applied and exact candidate evaluated; live API unchanged');

  const service: { week: number; modelId: string; paidAccounts: number; fulfillmentBps: number; billedCents: number; carryIn: number; carryOut: number }[] = [];
  const step = () => {
    const beforeCarry = run.state.slices.products.contracts[originalContractId].tokenBillRemainder ?? 0;
    run.step();
    const current = run.state.slices.products.offers[productId], usage = run.state.slices.products.lastUsage[productId];
    assert.equal(current.status, 'active'); assert.equal(current.contractId, originalContractId);
    assert.equal(usage.fulfillmentBps, 10000, 'Release work must leave this funded company’s API fully served.');
    assert.equal(usage.tokens!.billCarryIn, beforeCarry, 'No release boundary may reset the token bill remainder.');
    assert.deepEqual({ ...run.state.slices.products.contracts[originalContractId], tokenBillRemainder: 0 }, fixedContract);
    const invoices = run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week);
    assert.equal(invoices.length, 1, 'One public product produces exactly one weekly invoice.');
    assert.equal(invoices[0].contractId, originalContractId); assert.equal(invoices[0].amountCents, usage.billedCents);
    const costs = getComputeCostView(run.state).latest!;
    assert.equal(costs.totals.totalComputeCents + costs.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(costs.totals.attributedComputeCents + costs.totals.sharedComputeCents, costs.totals.totalComputeCents);
    service.push({ week: run.week, modelId: current.publicModelId!, paidAccounts: usage.paidAccounts, fulfillmentBps: usage.fulfillmentBps,
      billedCents: usage.billedCents, carryIn: usage.tokens!.billCarryIn!, carryOut: usage.tokens!.billCarryOut! });
  };
  const until = (condition: () => boolean, limit: number, label: string) => {
    const start = run.week; while (!condition() && run.week - start < limit) step();
    assert.ok(condition(), label + ' did not finish through ordinary weekly work.');
  };
  const rehearsalId = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId });
  until(() => !!getQualifiedReleaseRehearsal(run.state, productId, candidateModelId), 12, 'model rehearsal');
  const rehearsal = run.state.slices.products.releaseRehearsals![rehearsalId];
  assert.ok(rehearsal); assert.equal(rehearsal.status, 'complete'); assert.equal(rehearsal.completedStaff, U);
  assert.equal(rehearsal.arms.source.requiredWork, 5 * U); assert.equal(rehearsal.arms.candidate.requiredWork, 4 * U);
  assert.ok(rehearsal.arms.source.physicalWork > 0 && rehearsal.arms.candidate.physicalWork > 0);
  assert.equal(rehearsal.arms.source.outcomes!.cases, 100); assert.equal(rehearsal.arms.candidate.outcomes!.cases, 100);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated', 'A rehearsal must not publish the candidate.');
  const rehearsalCosts = getComputeCostView(run.state).reports.flatMap(report => report.workloads.filter(workload =>
    [releaseRehearsalWorkId(rehearsalId, 'source'), releaseRehearsalWorkId(rehearsalId, 'candidate')].includes(workload.requestId)));
  assert.equal(rehearsalCosts.reduce((total, item) => total + item.physicalWorkCUw, 0), rehearsal.arms.source.physicalWork + rehearsal.arms.candidate.physicalWork);
  assert.ok(rehearsalCosts.every(item => item.category === 'development'));
  run.mark('Paid paired evidence completed without changing live API or model weights');
  const afterRehearsal = serializeState(run.state);

  const releaseId = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId });
  until(() => run.state.slices.products.preparedReleases?.[releaseId]?.status === 'ready'
    && run.state.slices.products.preparedReleases[releaseId].availableWeek! <= run.week, 10, 'forward preparation');
  let release = run.state.slices.products.preparedReleases![releaseId];
  assert.equal(release.completedWork, 2 * U); assert.equal(release.completedStaff, 2 * U);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated', 'Preparation must not publish the candidate.');
  assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  const beforePromotion = serializeState(run.state);
  run.queue({ kind: 'promote_prepared_release', releaseId }); step();
  assert.equal(run.state.slices.products.preparedReleases![releaseId].status, 'scheduled');
  assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated');
  step(); release = run.state.slices.products.preparedReleases![releaseId];
  assert.equal(release.status, 'released'); assert.equal(release.releasedWeek, run.week);
  assert.equal(run.state.slices.products.offers[productId].publicModelId, candidateModelId);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'released');
  run.mark('Candidate handed over at explicit boundary; same contract and uninterrupted service');
  const afterPromotion = serializeState(run.state);

  run.queue({ kind: 'start_release_rollback', releaseId });
  until(() => run.state.slices.products.preparedReleases![releaseId].rollback?.status === 'ready'
    && run.state.slices.products.preparedReleases![releaseId].rollback!.availableWeek! <= run.week, 3, 'paid rollback preparation');
  run.queue({ kind: 'promote_prepared_release', releaseId }); step();
  assert.equal(run.state.slices.products.offers[productId].publicModelId, candidateModelId);
  step(); release = run.state.slices.products.preparedReleases![releaseId];
  assert.equal(release.rollback!.status, 'complete'); assert.equal(release.rollback!.completedWork, U); assert.equal(release.rollback!.completedStaff, U);
  assert.ok(run.week <= release.rollbackExpiresWeek!); assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  assert.equal(canonicalStateHash(run.state.slices.models.versions[sourceModelId]), originalSource);
  assert.deepEqual(Object.keys(run.state.slices.products.commercialContracts).sort(), originalContracts);
  assert.ok(service.some(row => row.carryIn !== 0 || row.carryOut !== 0), 'Use a genuine fractional-token bill in the natural path.');
  run.mark('Retained source restored through separately paid work and explicit handover');
  assert.deepEqual(validateState(run.state, CONTENT), []);
  const snapshot = serializeState(run.state), loaded = deserializeState(snapshot); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(run.state)); assert.ok(Buffer.byteLength(snapshot) < 2_000_000);

  const evidence = { sourceCommit: 'd55f5e167eb20ad635d2be3663f7fac5c96b1b64', originalWeek: imported.state.week,
    originalChecksum: JSON.parse(raw).checksum, finalWeek: run.week, finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(snapshot),
    cashCents: run.cash, minimumCashCents: run.minimumCashCents, productId, sourceModelId, candidateModelId, rehearsalId, releaseId,
    commands: run.commands, milestones: run.milestones, rehearsal, rehearsalCosts, release, service,
    finalCosts: getComputeCostView(run.state).latest!, assertions: [
      'Every asset, research, application and operation acquired through ordinary commands; no grants or arrears',
      'Both standard rehearsal arms consumed real development grants and separate resident memory',
      'Preparation and rehearsal never released the candidate, changed model weights, or generated customer invoices',
      'Current API remained fully served through both explicit handover boundaries',
      'Product and contract identity, one invoice per week and nonzero token billing carry survived cutovers',
      'One rollback paid real work and staff within the original six-week deadline',
      'Settled company costs reconciled each observed week; exact save round trip remained below two megabytes',
    ] };
  if (process.env.FRONTIER_WAVE9_OUTPUT) {
    const dir = process.env.FRONTIER_WAVE9_OUTPUT; mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries({ 'before-rehearsal': beforeRehearsal, 'after-rehearsal': afterRehearsal,
      'before-promotion': beforePromotion, 'after-promotion': afterPromotion, complete: snapshot }))
      writeFileSync(join(dir, 'frontier-lab-wave9-' + name + '.json'), text + '\n');
    writeFileSync(join(dir, 'wave9-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
});
