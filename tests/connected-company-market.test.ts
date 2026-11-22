import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { MARKET_SEGMENTS } from '../src/content/wave2-market';
import { PRODUCT_WORKLOADS } from '../src/content/product-workloads';
import { createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createAISystemReceipt } from '../src/modules/ai-systems';
import { createProductWorkloadReceipt, getProductWorkloadMeasure, workloadErrorBps, workloadPrivatePrice } from '../src/modules/product-workloads';
import { productDemand, requestMeter } from '../src/modules/products';
import { getBusinessView } from '../src/modules/business';
import { getProductDemandAccess } from '../src/modules/markets';
import { createConnectedSystemsBriefTerms, getSystemsBriefOffers, getSystemsBriefOrders, isCanonicalSystemsBriefTerms, snapshotSystemsBriefOffer, systemsBriefOfferAvailability } from '../src/modules/systems-briefs';
import { getSystemsClientRelationships } from '../src/modules/systems-client-relationships';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

function published(prefix: string) {
  const decoded = deserializeState(readFileSync(join(__dirname, 'fixtures', 'connected-037-paid-published.json'), 'utf8'));
  assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
  assert.equal(decoded.state.contentVersion, '0.38.0');
  return new NaturalBusinessCampaign(decoded.state, prefix);
}
function modelByName(run: NaturalBusinessCampaign, name: string) {
  const model = run.models().find(model => model.name === name); assert.ok(model, name); return model;
}
function finite(run: NaturalBusinessCampaign) {
  const market = run.state.slices.markets;
  for (const segment of MARKET_SEGMENTS) {
    const count = market.cohorts.filter(row => (row.segmentId ?? 'regular') === segment.id).reduce((sum, row) => sum + row.count, 0)
      + market.trials.filter(row => (row.segmentId ?? 'regular') === segment.id).reduce((sum, row) => sum + row.count, 0)
      + (market.returnedNextWeek[segment.id] ?? 0);
    assert.ok(count <= segment.population, `The portfolio duplicated ${segment.id} customers.`);
  }
}

test('operating choices earn ordinary workload outcomes while retaining their memory and latency costs', () => {
  const run = published('workload-outcomes');
  const memory = modelByName(run, 'Case continuity model');
  const compact = structuredClone(memory), expanded = structuredClone(memory);
  compact.modelDesign!.system = createAISystemReceipt({ version: 1, kind: 'stateful', stateSlots: 16, memory: 'selective', repair: true });
  expanded.modelDesign!.system = createAISystemReceipt({ version: 1, kind: 'stateful', stateSlots: 256, memory: 'selective', repair: true });
  const promise = createProductWorkloadReceipt('continuity', run.week);
  const low = getProductWorkloadMeasure(compact, promise)!, high = getProductWorkloadMeasure(expanded, promise)!;
  assert.ok(high.retentionBps > low.retentionBps);
  assert.ok(workloadErrorBps(1400, high) < workloadErrorBps(1400, low));
  assert.ok(requestMeter(expanded, { memory: false, extendedContext: false, deepReasoning: false }).sessionMemory
    > requestMeter(compact, { memory: false, extendedContext: false, deepReasoning: false }).sessionMemory);
  const reasoning = modelByName(run, 'Verified reasoning model');
  const short = structuredClone(reasoning), checked = structuredClone(reasoning);
  short.modelDesign!.system = createAISystemReceipt({ version: 1, kind: 'adaptive', maxPasses: 2, search: 'branching', verifier: 'independent', stopping: 'confidence' });
  checked.modelDesign!.system = createAISystemReceipt({ version: 1, kind: 'adaptive', maxPasses: 4, search: 'branching', verifier: 'independent', stopping: 'confidence' });
  const verified = createProductWorkloadReceipt('verified', run.week), fast = createProductWorkloadReceipt('responsive', run.week);
  assert.ok(workloadErrorBps(1400, getProductWorkloadMeasure(checked, verified)) < workloadErrorBps(1400, getProductWorkloadMeasure(short, verified)));
  assert.ok(getProductWorkloadMeasure(checked, fast)!.fitBps < getProductWorkloadMeasure(short, fast)!.fitBps, 'More checking cannot be a free interactive-latency upgrade.');
  const offer = run.offers().find(offer => offer.kind === 'basic-chat')!;
  const before = productDemand(run.state, offer, CONTENT, run.week);
  const withPromise = productDemand(run.state, { ...offer, workload: promise }, CONTENT, run.week);
  assert.ok(withPromise.segments.some((row, index) => row.errorBps !== before.segments[index].errorBps), 'Ordinary product outcomes must actually read the customer promise.');
});

test('a second public offer deploys, shares finite markets, observes queued limits and can retire without deleting history', () => {
  const run = published('portfolio-paid');
  const model = modelByName(run, 'Expert service network');
  const id = 'product:' + run.queue({ kind: 'deploy_product', productKind: 'basic-chat', name: 'Fast help', workload: 'responsive', modelId: model.id, priceCents: 1200, allowance: 100 });
  const fifth = submitCommand(run.state, { kind: 'deploy_product', productKind: 'developer-api', name: 'Another API', workload: 'general', modelId: model.id, priceCents: 6000, allowance: 600 });
  assert.equal(fifth.accepted, false); assert.match(fifth.reason?.message ?? '', /four public offers/);
  run.until(state => state.slices.products.offers[id]?.status === 'active', 16, 'second chat offer');
  assert.equal(run.offers().filter(offer => offer.kind === 'basic-chat').length, 2);
  assert.equal(run.state.slices.products.offers[id].workload?.id, 'responsive');
  run.step(3); finite(run);
  const original = run.offers().find(offer => offer.kind === 'basic-chat' && offer.id !== id)!;
  assert.notEqual(run.state.slices.products.offers[id].contractId, original.contractId);
  assert.ok(run.state.slices.products.lastUsage[id].workload);
  const changed = structuredClone(run.state); changed.slices.products.lastUsage[id].workload!.retentionBps++;
  assert.ok(validateState(changed).length, 'The saved weekly workload outcome must not be editable.');
  run.queue({ kind: 'set_product_paused', productId: id, paused: true }); run.step();
  assert.equal(previewCommand(run.state, { kind: 'deploy_product', productKind: 'developer-api', modelId: model.id, priceCents: 6000, allowance: 600 }).accepted, false, 'Pausing cannot bypass the portfolio limit.');
  // The engine must preserve the customer's natural exit; do not erase cohorts to free a slot.
  assert.equal(previewCommand(run.state, { kind: 'retire_product', productId: id }).accepted,
    !run.state.slices.markets.cohorts.some(cohort => cohort.productId === id) && !run.state.slices.markets.trials.some(trial => trial.productId === id));
  const empty = published('portfolio-retirement');
  const emptyId = 'product:' + empty.queue({ kind: 'deploy_product', productKind: 'basic-chat', name: 'Pilot offer', workload: 'verified', modelId: modelByName(empty, 'Verified reasoning model').id, priceCents: 10000, allowance: 25 });
  empty.until(state => state.slices.products.offers[emptyId]?.status === 'active', 16, 'pilot offer deployment');
  empty.queue({ kind: 'set_product_paused', productId: emptyId, paused: true }); empty.step(3);
  empty.until(state => !state.slices.markets.cohorts.some(row => row.productId === emptyId) && !state.slices.markets.trials.some(row => row.productId === emptyId), 100, 'empty offer closure');
  const invoiceIds = empty.state.slices.products.invoices.filter(invoice => invoice.productId === emptyId).map(invoice => invoice.id);
  empty.queue({ kind: 'retire_product', productId: emptyId }); empty.step();
  assert.equal(empty.state.slices.products.offers[emptyId].retiredWeek, empty.week);
  assert.ok(invoiceIds.every(id => empty.state.slices.products.invoices.some(invoice => invoice.id === id)));
  assert.equal(previewCommand(empty.state, { kind: 'set_product_paused', productId: emptyId, paused: false }).accepted, false);
  assert.deepEqual(validateState(empty.state), []);
});

test('qualified private workloads earn a frozen premium through real delivery and cannot reprice old invoices', () => {
  const run = published('private-workload-paid'), model = modelByName(run, 'Case continuity model');
  const business = getBusinessView(run.state, CONTENT), customer = business.board.find(customer => customer.id === 'northline-operations')!;
  assert.ok(customer.available, customer.unavailableReason);
  const packet = business.packets.find(packet => packet.documentCoverageBps >= 5000) ?? business.packets[0]; assert.ok(packet);
  const oldContract = run.state.slices.products.commercialContracts['business:aster-services'];
  const before = { modelId: oldContract.modelId, weeklyPriceCents: oldContract.weeklyPriceCents, rights: oldContract.rights };
  run.queue({ kind: 'sign_business_contract', customerId: customer.id, contractKind: 'private-hosted', modelId: model.id, packetId: packet.id, workload: 'continuity' });
  run.until(state => state.slices.products.commercialContracts['business:' + customer.id]?.status === 'active', 18, 'premium private delivery');
  const contract = run.state.slices.products.commercialContracts['business:' + customer.id];
  assert.equal(contract.weeklyPriceCents, workloadPrivatePrice(customer.hostedWeeklyCents, contract.workload));
  assert.equal(PRODUCT_WORKLOADS.continuity.privatePriceBps, 12500);
  assert.equal(contract.lastUsage?.workload?.id, 'continuity');
  assert.ok(contract.lastUsage!.billedCents > 0);
  assert.equal(run.state.slices.products.commercialContracts['business:aster-services'].workload, undefined, 'A pre-upgrade paid contract cannot silently acquire a new promise.');
  const oldAfter = run.state.slices.products.commercialContracts['business:aster-services'];
  assert.deepEqual({ modelId: oldAfter.modelId, weeklyPriceCents: oldAfter.weeklyPriceCents, rights: oldAfter.rights }, before);
  const invoice = run.state.slices.products.commercialInvoices.find(invoice => invoice.contractId === contract.id)!;
  assert.deepEqual(invoice.workload, contract.workload);
  const modified = structuredClone(run.state), tampered = modified.slices.products.commercialContracts[contract.id];
  tampered.workload!.id = 'general'; tampered.weeklyPriceCents = customer.hostedWeeklyCents;
  assert.ok(validateState(modified).some(reason => /workload|premium|proof/i.test(reason.message)));
  const decoded = deserializeState(serializeState(run.state)); assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
  assert.deepEqual(decoded.state, run.state);
});

test('paid pilot history creates repeat and partner commitments with pinned terms and durable market access', () => {
  const run = published('client-relationships-paid');
  const oldOrders = canonicalStateHash(run.state.slices.campaign.systemsBriefs);
  const ownerOffer = run.offers().find(offer => offer.kind === 'developer-api')!;
  run.queue({ kind: 'configure_product_offer', productId: ownerOffer.id, name: ownerOffer.name, workload: 'responsive' }); run.step();
  const before = getSystemsClientRelationships(run.state).find(item => item.briefId === 'efficient-experts')!;
  assert.equal(before.tier, 'repeat'); assert.equal(before.completedCount, 1);
  assert.equal(getProductDemandAccess(run.state, run.state.slices.products.offers[ownerOffer.id]).relationshipBps, 11200);
  run.until(state => getSystemsBriefOffers(state).some(offer => offer.briefId === 'efficient-experts' && offer.available), 20, 'repeat commission');
  const offer = getSystemsBriefOffers(run.state).find(offer => offer.briefId === 'efficient-experts')!;
  assert.equal(offer.terms.version, 2); assert.equal(offer.relationship?.tier, 'repeat'); assert.equal(offer.qualifyingWeeks, 3);
  const pinned = snapshotSystemsBriefOffer(run.state, offer.id)!;
  assert.ok(isCanonicalSystemsBriefTerms(run.state, pinned));
  const forged = { ...structuredClone(pinned), feeCents: pinned.feeCents + 1 };
  assert.equal(submitCommand(run.state, { kind: 'accept_systems_brief', offerId: offer.id, modelId: offer.candidateModelId!, terms: forged }).accepted, false);
  const oldIds = getSystemsBriefOrders(run.state).map(order => order.id);
  run.queue({ kind: 'accept_systems_brief', offerId: pinned.id, modelId: offer.candidateModelId!, terms: pinned });
  run.until(state => state.slices.campaign.systemsBriefs?.[offer.id]?.status === 'completed', 10, 'repeat delivery');
  const relationship = getSystemsClientRelationships(run.state).find(item => item.briefId === 'efficient-experts')!;
  assert.equal(relationship.tier, 'partner'); assert.equal(relationship.client, offer.client); assert.equal(relationship.completedCount, 2);
  assert.equal(getProductDemandAccess(run.state, run.state.slices.products.offers[ownerOffer.id]).relationshipBps, 12500);
  const historical = Object.fromEntries(Object.entries(run.state.slices.campaign.systemsBriefs!).filter(([id]) => oldIds.includes(id)));
  assert.equal(canonicalStateHash(historical), oldOrders, 'New client relationships cannot rewrite paid version-one terms or proofs.');
  const next = createConnectedSystemsBriefTerms(run.state, 'efficient-experts', offer.windowIndex + 1);
  assert.equal(next.relationship?.tier, 'partner'); assert.equal(next.qualifyingWeeks, 4); assert.ok(next.requestsPerWeek > pinned.requestsPerWeek);
  assert.match(systemsBriefOfferAvailability(run.state, pinned, undefined, pinned.acceptUntilWeek + 1) ?? '', /closed/);
  assert.deepEqual(validateState(run.state), []);
  const fresh = createInitialState(); assert.equal(createConnectedSystemsBriefTerms(fresh, 'efficient-experts', 0).relationship?.tier, 'pilot');
});
