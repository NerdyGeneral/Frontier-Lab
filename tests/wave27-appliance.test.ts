import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { PRIVATE_APPLIANCE_BUYER as BUYER } from '../src/content/wave27-appliance';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { availableFoundrySlots } from '../src/modules/hardware-sales';
import { businessRequests } from '../src/modules/business';
import { getPrivateApplianceView, previewPrivateApplianceOrder, privateApplianceBundleReceiptId, privateApplianceContractId, privateApplianceFabricationFactId } from '../src/modules/private-appliances';
import { getPrivateApplianceFixture, getPrivateApplianceReadyFixture } from './fixtures/wave27-appliance';

const order = (state: GameState) => state.slices.products.privateApplianceOrders![BUYER.id]!;
const contract = (state: GameState) => state.slices.products.commercialContracts[privateApplianceContractId()];
const queue = (state: GameState, payload: CommandPayload) => { const result = submitCommand(state, payload); assert.equal(result.accepted, true, result.reason?.message); return result.state; };
const step = (state: GameState) => { const result = advanceWeek(state); assert.equal(result.accepted, true, result.reason?.message); return result.state; };

test('the paid natural appliance path ships, installs, accepts and settles one bundle with separate ordinary service', () => {
  const f = getPrivateApplianceFixture(), p = previewPrivateApplianceOrder(f.beforeOrder, f.payload);
  assert.ok(p.eligible); assert.deepEqual(validateState(f.served), []);
  assert.equal(f.originalWeek, 537); assert.ok(f.minimumCashCents > 0);
  assert.equal(order(f.ordered).configuration.racks, 2);
  assert.equal(order(f.ordered).arrivalWeek, f.ordered.week + p.configuration!.leadWeeks);
  assert.equal(order(f.ordered).shippedWeek, null); assert.equal(contract(f.ordered).completedDeliveryStaff, 0);
  assert.equal(contract(f.ordered).lastUsage, null); assert.equal(contract(f.ordered).lifetimeBilledCents, 0);
  assert.equal(businessRequests(f.ordered, f.ordered.week + 1).some(request => request.taskId === contract(f.ordered).id), false);
  assert.equal(order(f.shipped).shippedWeek, f.shipped.week);
  assert.equal(contract(f.shipped).completedDeliveryStaff, U);
  assert.equal(order(f.ready).acceptedWeek, null); assert.equal(contract(f.ready).completedDeliveryStaff, 2 * U);
  assert.equal(order(f.accepted).acceptedWeek, f.accepted.week); assert.equal(order(f.accepted).settledWeek, f.accepted.week);
  assert.deepEqual(order(f.accepted).artifact!.configuration, order(f.ordered).configuration);
  const ledger = f.accepted.slices.company.ledger, upfrontLedger = f.ordered.slices.company.ledger;
  assert.equal(upfrontLedger.filter(entry => entry.id === privateApplianceFabricationFactId()).length, 1);
  assert.equal(upfrontLedger.find(entry => entry.id === privateApplianceFabricationFactId())!.amountCents, p.fabricationCostCents);
  assert.equal(upfrontLedger.filter(entry => entry.id === 'business-setup:' + f.commandId).length, 1);
  // The bounded ledger may drop the eight-week-old expense; permanent posted-fact IDs retain payment and replay protection.
  assert.equal(f.accepted.slices.company.postedFacts[privateApplianceFabricationFactId()], true);
  assert.equal(f.accepted.slices.company.postedFacts['business-setup:' + f.commandId], true);
  assert.equal(ledger.filter(entry => entry.id === privateApplianceBundleReceiptId()).length, 1);
  assert.equal(ledger.find(entry => entry.id === privateApplianceBundleReceiptId())!.amountCents, BUYER.bundlePriceCents);
  const invoices = f.served.slices.products.commercialInvoices.filter(invoice => invoice.contractId === contract(f.served).id);
  assert.equal(invoices.length, 2); assert.equal(invoices[0].week, f.accepted.week);
  assert.ok(invoices.every(invoice => invoice.grossCents === BUYER.licenseWeeklyCents));
  assert.equal(contract(f.served).termEndsWeek, f.accepted.week + BUYER.termWeeks);
  assert.equal(Object.keys(f.served.slices.compute.racks).length, Object.keys(f.beforeOrder.slices.compute.racks).length);
  assert.equal(contract(f.served).lastUsage!.physicalWorkCUw, 0);
  assert.equal(contract(f.served).lastUsage!.inputTokens + contract(f.served).lastUsage!.outputTokens, 0);
  assert.equal(getPrivateApplianceView(f.served).orders[0].phase, 'accepted');
});

test('quote, queue, import and commit preserve the same complete appliance payload and paid terms', () => {
  const f = getPrivateApplianceReadyFixture(), hash = canonicalStateHash(f.state);
  const quote = previewCommand(f.state, f.payload), own = previewPrivateApplianceOrder(f.state, f.payload);
  assert.equal(quote.accepted, true, quote.reason?.message); assert.equal(quote.upfrontCostCents, own.upfrontCostCents);
  const submitted = submitCommand(f.state, f.payload); assert.equal(submitted.accepted, true, submitted.reason?.message);
  assert.equal(canonicalStateHash(f.state), hash);
  assert.deepEqual(submitted.state.queuedCommands.find(command => command.id === submitted.commandId)!.payload, f.payload);
  assert.equal(submitted.state.queuedCommands.find(command => command.id === submitted.commandId)!.reservedCents, own.upfrontCostCents);
  const restored = deserializeState(serializeState(submitted.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.deepEqual(restored.state, submitted.state);
  assert.equal(canonicalStateHash(step(restored.state)), canonicalStateHash(step(submitted.state)));
  const duplicate = submitCommand(submitted.state, f.payload); assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason?.code, 'ALREADY_ACTIVE');
  assert.equal(duplicate.state, submitted.state);
});

test('appliance qualification rejects unresearched, unevaluated, malformed and standalone-license paths', () => {
  const f = getPrivateApplianceReadyFixture();
  assert.match(previewCommand(createInitialState(), f.payload).summary, /S4/);
  const noEvaluation = previewCommand(f.state, { ...f.payload, modelId: CONTENT.seedModel.id }); assert.equal(noEvaluation.accepted, false);
  for (const payload of [
    { ...f.payload, buyerId: 'unknown-buyer' }, { ...f.payload, foundry: 'instant' }, { ...f.payload, modelId: 'missing' },
    { ...f.payload, designId: 'missing' }, { ...f.payload, grantReady: true }, { ...f.payload, modelId: '__proto__' },
  ]) {
    const result = previewCommand(f.state, payload as CommandPayload); assert.equal(result.accepted, false);
  }
  const standalone = submitCommand(f.state, { kind: 'sign_business_contract', customerId: BUYER.id, modelId: f.modelId, contractKind: 'customer-hosted' });
  assert.equal(standalone.accepted, false); assert.match(standalone.reason!.message, /appliance/);
  assert.ok(getPrivateApplianceView(f.state).models.some(model => !model.eligible && model.reasons.length > 0));
});

test('owned batches, hardware sales and appliances reserve the same queued foundry line', () => {
  const f = getPrivateApplianceReadyFixture(), foundry = 'high-yield' as const;
  const internal = queue(f.state, { kind: 'order_chip_batch', designId: f.designId, racks: 4, location: 'colocation', foundry });
  assert.equal(availableFoundrySlots(internal, foundry), 0);
  const blocked = submitCommand(internal, { ...f.payload, foundry });
  assert.equal(blocked.accepted, false); assert.equal(blocked.reason?.code, 'CAPACITY_EXCEEDED'); assert.match(blocked.reason!.message, /foundry/);
  const external = queue(f.state, { kind: 'accept_hardware_order', buyerId: 'vesper-systems', designId: f.designId, foundry });
  const both = queue(external, { ...f.payload, foundry }); assert.equal(availableFoundrySlots(both, foundry), 0);
  const extra = submitCommand(both, { kind: 'order_chip_batch', designId: f.designId, racks: 1, location: 'colocation', foundry });
  assert.equal(extra.accepted, false); assert.equal(extra.reason?.code, 'CAPACITY_EXCEEDED');
  const committed = step(both); assert.equal(availableFoundrySlots(committed, foundry), 0); assert.deepEqual(validateState(committed), []);
});

test('snapshot validation rejects detached artifacts, unearned installation and duplicate or premature appliance settlement', () => {
  const f = getPrivateApplianceFixture();
  const corruptions: Array<(state: GameState) => void> = [
    state => { order(state).configuration.release.capabilityReportId = 'unpaid-report'; },
    state => { order(state).configuration.release.runtimeFingerprint = '00000000'; },
    state => { order(state).configuration.release.rights.weights = false; },
    state => { order(state).configuration.usableCU += U; },
    state => { order(state).artifact!.configuration.release.modelId = 'invented'; },
    state => { order(state).delivery.latestGrant!.grantedStaff += 1; },
    state => { order(state).shippedWeek = null; },
    state => { order(state).settledWeek = null; },
    state => { delete state.slices.company.postedFacts[privateApplianceBundleReceiptId()]; },
    state => { delete state.slices.products.privateApplianceOrders; },
    state => { delete state.slices.products.commercialContracts[privateApplianceContractId()]; },
  ];
  for (const corrupt of corruptions) {
    const bad = structuredClone(f.accepted); corrupt(bad); assert.ok(validateState(bad).length > 0);
  }
  const premature = structuredClone(f.ordered); order(premature).acceptedWeek = premature.week; order(premature).settledWeek = premature.week;
  assert.ok(validateState(premature).length > 0);
  const ordinary = structuredClone(f.accepted); ordinary.contentVersion = '0.26.0'; ordinary.buildVersion = '0.26.0';
  const imported = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: ordinary.schemaVersion, contentVersion: '0.26.0', checksum: canonicalStateHash(ordinary), state: ordinary }));
  assert.equal(imported.ok, false);
});

test('support shortfalls use existing service credits and termination without another appliance payment', () => {
  const f = getPrivateApplianceFixture(); let state = f.accepted;
  for (const employee of Object.values(state.slices.company.staff).filter(staff => staff.companyId === state.playerCompanyId && staff.role === 'commercial')) {
    state = queue(state, { kind: 'set_staff_allocation', staffId: employee.id, fte: 0 });
  }
  state = step(state);
  assert.equal(contract(state).lastUsage!.supportStaffGranted, 0);
  assert.equal(contract(state).lastUsage!.creditsCents, BUYER.licenseWeeklyCents);
  assert.equal(contract(state).lastUsage!.billedCents, 0);
  state = step(state); assert.equal(contract(state).status, 'terminated');
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === privateApplianceBundleReceiptId()).length, 1);
  assert.equal(order(state).acceptedWeek, f.accepted.week);
  assert.equal(submitCommand(state, f.payload).accepted, false);
  assert.equal(submitCommand(state, { kind: 'sign_business_contract', customerId: BUYER.id, modelId: f.modelId, contractKind: 'customer-hosted' }).accepted, false);
});
