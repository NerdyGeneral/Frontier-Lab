const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = '/workspace/sites/frontier-lab/.sites-checkout';
const ts = require(root + '/node_modules/typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { CONTENT } = require(root + '/src/content/catalog.ts');
const { createInitialState, submitCommand, advanceWeek, validateState } = require(root + '/src/core/engine.ts');
const { serializeState, deserializeState } = require(root + '/src/core/snapshot.ts');
const { canonicalStateHash } = require(root + '/src/core/canonical.ts');
const { decisionCashGuard, DEFAULT_DECISION_CLOCK_POLICY } = require(root + '/src/core/decision-clock.ts');
const { getWeeklyBaseCost } = require(root + '/src/core/selectors.ts');
const queue = (state, payload, id) => {
  const result = submitCommand(state, payload, CONTENT, id);
  assert.ok(result.accepted, JSON.stringify(result.reason)); return result.state;
};
function opening(reserve) {
  let state = createInitialState(CONTENT, 'release');
  state = queue(state, { kind: 'start_development_plan', name: 'Independent reserve review', training: {
    kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id,
  }, suiteId: 'basic-conversation-1', feeBudgetCents: 100000, cashReserveCents: reserve, deadlineWeek: 30 }, 'independent-plan');
  const next = advanceWeek(state); assert.ok(next.accepted, JSON.stringify(next.reason));
  const plan = next.state.slices.models.developmentPlans['development-independent-plan'];
  assert.equal(plan.steps.length, 1); return { state: next.state, plan };
}
const results = [];
for (const scenario of ['exact-reserve-boundary', 'zero-fee-rename', 'explicit-manual-purchase', 'rejected-rent-reduction']) {
  let { state, plan } = opening(4500000);
  if (scenario === 'zero-fee-rename') state = queue(state, { kind: 'rename_company', name: 'Kept manual choice' }, 'independent-rename');
  if (scenario === 'explicit-manual-purchase') state = queue(state, { kind: 'buy_data', catalogId: 'specialist-coding-1' }, 'independent-purchase');
  if (scenario === 'rejected-rent-reduction') {
    state = queue(state, { kind: 'set_cloud_capacity', cu: 6000000000 }, 'independent-rent-increase');
    state = queue(state, { kind: 'allocate_compute', development: 4000000000, research: 0, serving: 0 }, 'independent-allocation');
    state = queue(state, { kind: 'set_cloud_capacity', cu: 2000000000 }, 'independent-rejected-cut');
  }
  assert.deepEqual(validateState(state), []);
  const originalHash = canonicalStateHash(state);
  const loaded = deserializeState(serializeState(state)); assert.ok(loaded.ok, loaded.error);
  const next = advanceWeek(state); assert.ok(next.accepted, JSON.stringify(next.reason));
  assert.deepEqual(advanceWeek(loaded.state), next, 'Queued work must replay identically after reload.');
  assert.equal(canonicalStateHash(state), originalHash, 'The source campaign remains unchanged.');
  const stage = next.state.commandReceipts[plan.steps[0].commandId];
  const cash = next.state.slices.company.companies[next.state.playerCompanyId].cashCents;
  if (scenario === 'exact-reserve-boundary' || scenario === 'zero-fee-rename') {
    assert.equal(stage.status, 'accepted'); assert.equal(cash, 4500000);
  } else {
    assert.equal(stage.status, 'rejected'); assert.equal(stage.reason.code, 'INSUFFICIENT_FUNDS');
    assert.equal(next.state.slices.data.preparationJobs['preparation-' + plan.steps[0].commandId], undefined);
  }
  if (scenario === 'explicit-manual-purchase') {
    assert.equal(next.state.commandReceipts['independent-purchase'].status, 'accepted');
    assert.equal(cash, 4000000, 'The reserve does not revoke an explicit manual purchase.');
  }
  if (scenario === 'rejected-rent-reduction') {
    assert.match(decisionCashGuard(state, { ...DEFAULT_DECISION_CLOCK_POLICY, cashReserveCents: plan.cashReserveCents })?.reason ?? '', /higher bills.*cash reserve.*Pending savings/);
    assert.equal(next.state.commandReceipts['independent-rent-increase'].status, 'accepted');
    assert.equal(next.state.commandReceipts['independent-allocation'].status, 'accepted');
    assert.equal(next.state.commandReceipts['independent-rejected-cut'].status, 'rejected');
    assert.equal(cash, 4560000);
  }
  results.push({ scenario, stage: stage.status, cashCents: cash, reserveCents: plan.cashReserveCents,
    weeklyCostCents: getWeeklyBaseCost(next.state), nextWeek: next.state.week,
    clockGuardBefore: decisionCashGuard(state, { ...DEFAULT_DECISION_CLOCK_POLICY, cashReserveCents: plan.cashReserveCents }),
    deterministicReload: true, sourceCampaignUnchanged: true });
}
{
  let state = createInitialState(CONTENT, 'release');
  state = queue(state, { kind: 'set_cloud_capacity', cu: 14000000000 }, 'reviewed-peak-rent');
  state = queue(state, { kind: 'set_cloud_capacity', cu: 6000000000 }, 'reviewed-valid-cut');
  const policy = { ...DEFAULT_DECISION_CLOCK_POLICY, cashReserveCents: 4520000 };
  const before = canonicalStateHash(state);
  assert.ok(decisionCashGuard(state, policy), 'Automatic advance must not spend against an uncommitted cut.');
  assert.equal(canonicalStateHash(state), before);
  const manual = advanceWeek(state); assert.ok(manual.accepted, JSON.stringify(manual.reason));
  assert.equal(manual.state.commandReceipts['reviewed-peak-rent'].status, 'accepted');
  assert.equal(manual.state.commandReceipts['reviewed-valid-cut'].status, 'accepted');
  assert.equal(manual.state.slices.company.companies[manual.state.playerCompanyId].cashCents, 4660000);
  assert.equal(decisionCashGuard(manual.state, policy), null, 'The same reserve can resume after the reviewed cut applies.');
  const resumed = advanceWeek(manual.state); assert.ok(resumed.accepted, JSON.stringify(resumed.reason));
  assert.equal(resumed.state.slices.company.companies[resumed.state.playerCompanyId].cashCents, 4520000);
  results.push({ scenario: 'reviewed-valid-cut-and-resume', beforeBlocked: true, manualCommandsAccepted: true,
    unchangedReserveResumes: true, cashCents: 4520000, reserveCents: 4520000, nextWeek: 2 });
}
console.log(JSON.stringify({ build: CONTENT.buildVersion, passed: results.length, results }, null, 2));
