import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand } from '../src/core/engine';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { adapterSharingSpec, getAdapterBankView } from '../src/modules/adapter-bank';
import { getAgentView, isAgentTerminal } from '../src/modules/agents';

/** Integration starts with the exact published company and earns every new option. */
test('W7-N01: ordinary funded progression links adapters, trained planners, independent evidence and once-only recovery', () => {
  const raw = readFileSync(join(__dirname, 'fixtures/wave6-snapshot.json'), 'utf8'), loaded = deserializeState(raw);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  const run = new NaturalBusinessCampaign(loaded.state, 'wave7-natural');
  const originalWeek = run.week, originalChecksum = JSON.parse(raw).checksum;
  run.mark('Published Wave 6 company');
  // Existing capacity/staff remain paid and service stays live while discoveries finish.
  for (const researchId of ['R4', 'R4B', 'R9A', 'R10A', 'R11', 'R11A']) run.discover(researchId);
  for (const method of ['adapter-bank', 'action-receipts'] as const) run.queue({ kind: 'start_system_rollout', method });
  run.until(state => ['adapter-bank', 'action-receipts'].every(method => Object.values(state.slices.research.systemRollouts).some(rollout => rollout.companyId === state.playerCompanyId && rollout.method === method && rollout.status === 'active')), 10, 'both system installations');
  run.mark('Four remaining research branches implemented');

  const plannerBaseId = 'model-natural-business-command-4', codingPacketId = 'curated-natural-business-command-54';
  const plannerModelId = run.train({ baseModelId: plannerBaseId, packetId: codingPacketId, recipeId: 'planner-curriculum' });
  run.evaluate(plannerModelId).evaluate(plannerBaseId, 'independent-holdouts-1').evaluate(plannerModelId, 'independent-holdouts-1');
  const reportFor = (modelId: string) => Object.values(run.state.slices.models.reports).find(report => report.modelId === modelId && report.suiteId === 'independent-holdouts-1')!;
  const baseline = reportFor(plannerBaseId).holdout!, improved = reportFor(plannerModelId).holdout!;
  assert.equal(baseline.evidenceKey, improved.evidenceKey);
  assert.equal(improved.totals.actualSuccesses, baseline.totals.actualSuccesses);
  assert.equal(improved.totals.basicFalseAccepts, baseline.totals.basicFalseAccepts);
  assert.equal(improved.totals.independentFalseAccepts, baseline.totals.independentFalseAccepts);
  assert.equal(improved.totals.necessaryLookups, baseline.totals.necessaryLookups);
  assert.equal(improved.totals.outOfScopeProposals, baseline.totals.outOfScopeProposals);
  assert.ok(improved.totals.repeatedLookups < baseline.totals.repeatedLookups);
  assert.deepEqual(run.state.slices.models.versions[plannerModelId].planner, { baselineRepeatBps: 10000, currentRepeatBps: 8100 });
  run.mark('Planner trained and independent cases compared');

  const adapterChatId = run.train({ baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id,
    packetIds: [CONTENT.starterData.id, codingPacketId], recipeId: CONTENT.firstTraining.id, asAdapter: true });
  const adapterApiId = run.train({ baseModelId: CONTENT.seedModel.id, packetId: codingPacketId, recipeId: 'coding-tools-adaptation', asAdapter: true });
  run.evaluate(adapterChatId).evaluate(adapterApiId);
  const chat = run.offers().find(offer => offer.kind === 'basic-chat')!, api = run.offers().find(offer => offer.kind === 'developer-api')!;
  run.queue({ kind: 'upgrade_product', productId: chat.id, modelId: adapterChatId });
  run.queue({ kind: 'upgrade_product', productId: api.id, modelId: adapterApiId });
  run.until(state => !!adapterSharingSpec(state, chat.id) && !!adapterSharingSpec(state, api.id), 10, 'two evaluated live adapters');
  run.step();
  const bank = getAdapterBankView(run.state).groups.find(group => group.baseModelId === CONTENT.seedModel.id)!;
  assert.equal(bank.independentMemoryMU, 4.5 * U); assert.equal(bank.sharedMemoryMU, 2.5 * U); assert.equal(bank.activeProducts, 2);
  run.mark('Two compatible adapters serving paid products');

  const view = getAgentView(run.state, run.state.playerCompanyId), order = view.orders.find(order => order.templateId === 'support-replies' && !order.claimed)!;
  assert.ok(order);
  const acceptedBefore = view.totals.accepted;
  run.queue({ kind: 'start_agent_job', orderId: order.id, modelId: 'model-natural-business-command-159', mode: 'approval', verification: 'independent',
    tools: [...order.readTools, order.actionTool], maxSteps: 24, maxRetries: 2, workBudget: 32 * U });
  run.step();
  const rootJobId = Object.values(run.state.slices.agents.jobs).find(job => job.companyId === run.state.playerCompanyId && job.orderId === order.id)!.id;
  let root = () => run.state.slices.agents.jobs[rootJobId];
  for (let i = 0; i < 24 && !root().actionApplied && !isAgentTerminal(root()); i++) {
    if (root().status === 'awaiting-approval') run.queue({ kind: 'review_agent_job', jobId: rootJobId, decision: 'approve' });
    run.step();
  }
  assert.equal(root().stage, 'audit'); assert.equal(root().status, 'running'); assert.equal(root().actionApplied, true); assert.equal(root().invoiceId, null);
  run.queue({ kind: 'set_agent_job_paused', jobId: rootJobId, paused: true });
  // Public demand has grown while the lab was working. Buy compatible headroom
  // for the saved-model recovery, then release the completed lab allocations.
  // The original customer action and its outcome key remain frozen throughout.
  run.queue({ kind: 'set_cloud_capacity', cu: run.fleet.cloudCU + 16 * U }); run.step();
  run.queue({ kind: 'allocate_compute', serving: run.fleet.cloudCU + run.fleet.ownedCU, development: 0, research: 0 });
  const beforeRecovery = serializeState(run.state), originalReceipt = structuredClone(run.state.slices.agents.actionReceipts[root().receiptId!]), priorWork = root().spentWork;
  assert.equal(previewCommand(run.state, { kind: 'recover_agent_job', jobId: rootJobId, maxSteps: 24, workBudget: 32 * U }).accepted, true);
  run.mark('Interrupted action awaiting paid recovery and audit');
  run.queue({ kind: 'recover_agent_job', jobId: rootJobId, maxSteps: 24, workBudget: 32 * U });
  const childId = rootJobId + ':recovery:1';
  try {
    run.until(state => !!state.slices.agents.jobs[childId] && isAgentTerminal(state.slices.agents.jobs[childId]), 12, 'recovered customer outcome');
  } catch (error) {
    const pending = run.state.slices.agents.jobs[childId];
    assert.fail(`${String(error)} ${JSON.stringify({ week: run.week, status: pending?.status, stage: pending?.stage,
      bottleneck: pending?.lastBottleneck, stageWork: pending?.stageWork, spentWork: pending?.spentWork,
      cloud: run.fleet.cloudCU, allocation: run.fleet.allocation })}`);
  }
  const child = run.state.slices.agents.jobs[childId];
  assert.equal(child.status, 'complete'); assert.equal(child.verifiedOutcome, true);
  assert.equal(root().status, 'handed-off'); assert.equal(child.evidenceKey, root().evidenceKey);
  assert.ok(child.spentWork > priorWork); assert.equal(child.history.filter(stage => stage.stage === 'action').length, 1);
  assert.equal(child.history.filter(stage => stage.stage === 'recover').length, 1);
  assert.deepEqual(run.state.slices.agents.actionReceipts[originalReceipt.id], originalReceipt);
  assert.equal(Object.values(run.state.slices.agents.actionReceipts).filter(receipt => receipt.companyId === run.state.playerCompanyId && receipt.orderId === order.id).length, 1);
  assert.equal(run.state.slices.agents.invoices.filter(invoice => invoice.jobId === childId || invoice.jobId === rootJobId).length, 1);
  assert.equal(run.state.slices.agents.totalsByCompany[run.state.playerCompanyId].accepted, acceptedBefore + 1);
  assert.equal(run.state.slices.company.postedFacts[childId + ':setup'], undefined);
  assert.deepEqual(validateState(run.state, CONTENT), []); run.mark('Paid continuation completed one outcome and invoice');

  const evidence = { sourceCommit: '870fd3792f162542740c53d7df154d52f8917c5f', originalWeek, originalChecksum,
    finalWeek: run.week, finalHash: canonicalStateHash(run.state), cashCents: run.cash, minimumCashCents: run.minimumCashCents,
    commandCount: run.commands.length, commands: run.commands, milestones: run.milestones,
    models: { plannerBaseId, plannerModelId, adapterChatId, adapterApiId },
    holdouts: { baseline, improved }, bank,
    recovery: { rootJobId, childId, originalReceipt, priorWorkCUw: priorWork / U, finalWorkCUw: child.spentWork / U,
      history: child.history, billedCents: child.billedCents, invoiceId: child.invoiceId },
    assertions: ['No granted cash, research, staff, data, models, or resources', 'No arrears throughout', 'All player commands admitted and committed',
      'Same reserved cases compare planner behavior', 'Two adapters share one exact base', 'Paid continuation preserves one customer action and invoice'] };
  if (process.env.FRONTIER_WAVE7_OUTPUT) {
    const directory = process.env.FRONTIER_WAVE7_OUTPUT; mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'frontier-lab-wave7-before-recovery.json'), beforeRecovery + '\n');
    writeFileSync(join(directory, 'frontier-lab-wave7-complete.json'), serializeState(run.state) + '\n');
    writeFileSync(join(directory, 'wave7-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
});
