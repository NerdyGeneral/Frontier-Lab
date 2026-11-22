import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getComputeCostView } from '../src/modules/compute-costs';
import { getCapacityForecast } from '../src/modules/capacity-forecast';
import { assuranceQualificationMatches, getAssuranceView } from '../src/modules/assured-api';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { releaseModelFingerprint } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W13-N01: an earned company serves two different audit-qualified buyers, pays tenant costs, restores qualification and finishes fixed terms', () => {
  const imported = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave12-snapshot.json'), 'utf8'));
  assert.ok(imported.ok);
  const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave12-expected.json'), 'utf8')) as {
    sourceCommit: string; commands: { week: number; id: string; payload: CommandPayload }[];
  };
  let earned: GameState = imported.state;
  while (earned.week < 449) {
    for (const command of previous.commands.filter(item => item.week === earned.week)) {
      const queued = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(queued.accepted, queued.reason?.message); earned = queued.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: '0.13.0', buildVersion: '0.13.0' }), 'd2bbbbe0');
  assert.equal(earned.slices.products.assuranceContracts, undefined);
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave13-natural');
  const productId = 'product:natural-business-command-67', originalProduct = earned.slices.products.offers[productId];
  const modelId = earned.slices.products.deployments[originalProduct.deploymentId].modelId;
  const modelFingerprint = releaseModelFingerprint(earned.slices.models.versions[modelId]);
  const feedbackFingerprint = canonicalStateHash(earned.slices.data.feedbackStudies);
  const snapshots: Record<string, string> = { start: serializeState(earned) };
  const service: object[] = [], costs: ReturnType<typeof getComputeCostView>['reports'] = [];
  const step = () => {
    const carry = run.state.slices.products.contracts[originalProduct.contractId].tokenBillRemainder ?? 0;
    run.step();
    assert.equal(run.state.slices.products.offers[productId].deploymentId, originalProduct.deploymentId);
    assert.equal(releaseModelFingerprint(run.state.slices.models.versions[modelId]), modelFingerprint);
    assert.equal(canonicalStateHash(run.state.slices.data.feedbackStudies), feedbackFingerprint);
    const usage = run.state.slices.products.lastUsage[productId];
    assert.equal(usage.tokens!.billCarryIn, carry);
    const publicInvoices = run.state.slices.products.invoices.filter(invoice => invoice.productId === productId && invoice.week === run.week);
    assert.equal(publicInvoices.length, 1); assert.equal(publicInvoices[0].amountCents, usage.billedCents);
    const report = getComputeCostView(run.state).latest!;
    assert.equal(report.totals.totalComputeCents + report.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(report.totals.attributedComputeCents + report.totals.sharedComputeCents, report.totals.totalComputeCents);
    assert.equal(report.totals.companyRevenueCents, run.company.lastWeek.revenueCents);
    for (const invoice of (run.state.slices.products.assuranceInvoices ?? []).filter(item => item.week === run.week)) {
      assert.equal(report.ledgerFacts.filter(fact => fact.id === invoice.id).length, 1);
      assert.equal(report.targets.filter(target => target.kind === 'assured-api' && target.sourceId === invoice.contractId).length, 1);
      assert.equal(invoice.amountCents + invoice.creditsCents, invoice.grossCents);
      assert.ok(!publicInvoices.some(item => item.id === invoice.id));
    }
    costs.push(report);
    service.push({ week: run.week, publicApi: { paidAccounts: usage.paidAccounts, fulfillmentBps: usage.fulfillmentBps,
      billedCents: usage.billedCents, inputTokens: usage.tokens!.inputTokens, outputTokens: usage.tokens!.outputTokens,
      internalTokens: usage.tokens!.internalTokens, billCarryIn: usage.tokens!.billCarryIn, billCarryOut: usage.tokens!.billCarryOut },
      assurance: Object.values(run.state.slices.products.assuranceContracts ?? {}).filter(contract => contract.lastUsage?.week === run.week)
        .map(contract => ({ contractId: contract.id, buyerId: contract.buyerId, ...contract.lastUsage })) });
  };
  const untilWeek = (week: number) => { while (run.week < week) step(); assert.equal(run.week, week); };
  const contract = (id: string) => run.state.slices.products.assuranceContracts![id];

  assert.deepEqual(getAssuranceView(run.state).products.find(item => item.id === productId)!.qualifyingBuyers, ['sentinel-services']);
  const strictContractId = 'assurance:' + run.queue({ kind: 'sign_assurance_contract', buyerId: 'sentinel-services', productId });
  step(); assert.equal(contract(strictContractId).status, 'ready');
  assert.equal(contract(strictContractId).completedOnboardingStaff, U);
  assert.equal(contract(strictContractId).setupFeeCents, 75_000);
  assert.equal((run.state.slices.products.assuranceInvoices ?? []).length, 0);
  step(); assert.equal(run.week, 451); assert.equal(contract(strictContractId).status, 'active');
  assert.equal(contract(strictContractId).termStartedWeek, 451); assert.equal(contract(strictContractId).termEndsWeek, 459);
  assert.equal(contract(strictContractId).lastUsage!.billedCents, 220_000);
  assert.equal(contract(strictContractId).lastUsage!.servedRequests, 8000);
  assert.ok(contract(strictContractId).lastUsage!.physicalWorkCUw > 0);
  const firstQualification = canonicalStateHash(contract(strictContractId).qualifications[0]);
  const firstInvoice = canonicalStateHash(run.state.slices.products.assuranceInvoices![0]);
  snapshots['strict-active'] = serializeState(run.state);
  run.mark('Sentinel accepts the exact strict audit; paid onboarding precedes real tenant service and its first retainer');

  run.queue({ kind: 'set_runtime_guardrail_enabled', productId, enabled: false }); step();
  assert.equal(contract(strictContractId).lastUsage!.qualificationBps, 0);
  assert.equal(contract(strictContractId).lastUsage!.executedWorkCUw, 0);
  assert.equal(contract(strictContractId).lastUsage!.creditsCents, 220_000);
  assert.equal(contract(strictContractId).lastUsage!.supportStaffGranted, U / 2);
  const forecast = getCapacityForecast(run.state);
  assert.ok(forecast.scenarios.find(scenario => scenario.id === 'base')!.rows[0].requests.some(request => request.requestId === 'assurance-serve:' + strictContractId), 'Suspension must not conceal the promised workload.');
  snapshots['checker-disabled'] = serializeState(run.state);
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId, enabled: true }); step();
  assert.equal(contract(strictContractId).lastUsage!.billedCents, 220_000);
  assert.equal(contract(strictContractId).qualifications.length, 1);
  run.mark('Disabling the accepted checker gives full contract credit; restoring that same installation restores service');

  run.queue({ kind: 'set_product_features', productId, features: { ...run.state.slices.products.offers[productId].features!, memory: false } }); step();
  assert.equal(activeRuntimeGuardrail(run.state, productId), null);
  assert.equal(contract(strictContractId).lastUsage!.billedCents, 0);
  snapshots['features-changed'] = serializeState(run.state);
  const replacementId = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId, profile: 'strict' });
  untilWeek(457);
  assert.equal(activeRuntimeGuardrail(run.state, productId)?.id, replacementId);
  assert.equal(assuranceQualificationMatches(run.state, contract(strictContractId)), false);
  assert.equal(contract(strictContractId).lastUsage!.billedCents, 0, 'A paid new audit still needs explicit acceptance for this commitment.');
  run.queue({ kind: 'requalify_assurance_contract', contractId: strictContractId }); step();
  assert.equal(contract(strictContractId).qualifications.length, 2);
  assert.equal(contract(strictContractId).termEndsWeek, 459);
  assert.equal(contract(strictContractId).lastUsage!.billedCents, 220_000);
  assert.equal(canonicalStateHash(contract(strictContractId).qualifications[0]), firstQualification);
  assert.equal(canonicalStateHash(run.state.slices.products.assuranceInvoices![0]), firstInvoice);
  snapshots.requalified = serializeState(run.state);
  step(); assert.equal(run.week, 459); assert.equal(contract(strictContractId).status, 'expired');
  assert.equal(contract(strictContractId).termWeeksServed, 8);
  assert.equal(contract(strictContractId).lifetimeBilledCents, 660_000);
  assert.equal(contract(strictContractId).lifetimeCreditsCents, 1_100_000);
  assert.equal(run.state.slices.products.assuranceInvoices!.filter(invoice => invoice.contractId === strictContractId).length, 8);
  snapshots['strict-complete'] = serializeState(run.state);
  run.mark('Explicit acceptance restores the tenant on its last original term week; eight invoices settle and no automatic renewal follows');

  const balancedId = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId, profile: 'balanced' });
  untilWeek(462);
  assert.equal(activeRuntimeGuardrail(run.state, productId)?.id, balancedId);
  assert.deepEqual(getAssuranceView(run.state).products.find(item => item.id === productId)!.qualifyingBuyers, ['continuity-systems']);
  snapshots.balanced = serializeState(run.state);
  const continuityId = 'assurance:' + run.queue({ kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId });
  untilWeek(464);
  assert.equal(contract(continuityId).lastUsage!.billedCents, 120_000);
  assert.equal(contract(continuityId).lastUsage!.servedRequests, 4000);
  run.queue({ kind: 'allocate_compute', serving: 0, development: 6 * U, research: 6 * U }); step();
  assert.equal(contract(continuityId).lastUsage!.qualified, true);
  assert.equal(contract(continuityId).lastUsage!.supportBps, 10000);
  assert.equal(contract(continuityId).lastUsage!.physicalWorkCUw, 0);
  assert.equal(contract(continuityId).lastUsage!.creditsCents, 120_000);
  snapshots['capacity-shortfall'] = serializeState(run.state);
  run.queue({ kind: 'allocate_compute', serving: 132 * U, development: 6 * U, research: 6 * U }); step();
  assert.equal(contract(continuityId).lastUsage!.billedCents, 120_000);
  assert.equal(run.state.slices.products.lastUsage[productId].fulfillmentBps, 10000);
  untilWeek(472);
  assert.equal(contract(continuityId).status, 'expired');
  assert.equal(contract(continuityId).termWeeksServed, 8);
  assert.equal(contract(continuityId).lifetimeBilledCents, 840_000);
  assert.equal(contract(continuityId).lifetimeCreditsCents, 120_000);
  assert.equal(run.state.slices.products.assuranceInvoices!.length, 16);
  assert.equal(getAssuranceView(run.state).committedOrganizations, 0);
  run.mark('Balanced checking wins the usefulness-focused buyer; one GPU-starved week earns a full credit, then service resumes and the fixed term completes');

  assert.deepEqual(validateState(run.state), []);
  const final = serializeState(run.state), reopened = deserializeState(final);
  assert.ok(reopened.ok, reopened.ok ? '' : reopened.error); assert.equal(serializeState(reopened.state), final);
  snapshots.complete = final;
  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 449, sourceHash: 'd2bbbbe0',
    finalWeek: run.week, finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(final),
    cashCents: run.cash, minimumCashCents: run.minimumCashCents, productId, modelId, strictContractId, continuityId,
    commands: run.commands, milestones: run.milestones, contracts: run.state.slices.products.assuranceContracts,
    invoices: run.state.slices.products.assuranceInvoices, service, costs,
    assertions: ['Authentic published Wave12 company continues through ordinary paid commands without direct resource grants',
      'The strict and balanced finite audits qualify different fictional buyers',
      'Real commercial onboarding completes before the next-boundary eight-week term',
      'Dedicated tenant GPU work, memory and recurring support are separate from public token invoices and consented feedback',
      'Disabled or stale qualification suspends execution and credits the retainer while the original calendar continues',
      'Explicit acceptance of an already paid replacement audit preserves prior invoices and qualification history',
      'Capacity shortages produce proportional credits even with a valid audit and staffed support',
      'Both fixed terms end with eight exactly-once invoices and no implicit renewal',
      'Cost activities reconcile to the company ledger; the final save reloads byte-for-byte'] };
  if (process.env.FRONTIER_WAVE13_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE13_OUTPUT, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE13_OUTPUT, `frontier-lab-wave13-${name}.json`), snapshot);
    writeFileSync(join(process.env.FRONTIER_WAVE13_OUTPUT, 'wave13-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ finalWeek: run.week, finalHash: evidence.finalHash, commands: run.commands.length,
    snapshotBytes: evidence.snapshotBytes, strictBilledCents: contract(strictContractId).lifetimeBilledCents,
    continuityBilledCents: contract(continuityId).lifetimeBilledCents, finalCashCents: run.cash, minimumCashCents: run.minimumCashCents }));
});
