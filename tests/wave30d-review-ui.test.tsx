import { formatWorkPoints, WORK_POINT_LABELS } from '../src/modules/workforce-points';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { FACILITY_PROFILES } from '../src/content/wave28-facilities';
import { GEN2_SILICON_RULES } from '../src/content/wave28-silicon';
import { chipProductionTerms } from '../src/content/silicon-market';
import { PRIVATE_APPLIANCE_BUYER } from '../src/content/wave27-appliance';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { formatMoney, formatUnits } from '../src/core/math';
import { getAgentView } from '../src/modules/agents';
import { previewPrivateApplianceOrder } from '../src/modules/private-appliances';
import { previewSyntheticGeneration } from '../src/modules/synthetic-data';
import { getStudioManagementReview } from '../src/ui/studio-management-review';
import { StudioCommandReview } from '../src/ui/studio-command-review';
import { ROLE_LABELS } from '../src/ui/components';
import { resolveAgentOrderSelection } from '../src/ui/agent-panels';
import { advanceWeek } from '../src/core/engine';
import { getResearchView } from '../src/modules/research';

const cache = new Map<string, GameState>();
function fixture(name = 'wave27-canary-published'): GameState {
  if (!cache.has(name)) {
    const loaded = deserializeState(readFileSync(join(process.cwd(), 'tests', 'fixtures', name + '.json'), 'utf8'));
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
    cache.set(name, loaded.state);
  }
  return structuredClone(cache.get(name)!);
}
const noAction = () => assert.fail('Reading a commitment must never queue or change the lab');
function render(game: GameState, payload: CommandPayload, stale = false) {
  const before = serializeState(game);
  const html = renderToStaticMarkup(<StudioCommandReview game={game} payload={payload} label="Review this decision" stale={stale} canRefresh={true} onRefresh={noAction} busy={false} />);
  assert.equal(serializeState(game), before, 'Review must leave state, queue and retained evidence untouched');
  assert.doesNotMatch(html, /\[object Object\]|&quot;kind&quot;:/, 'No object dump in the review');
  assert.equal((html.match(/aria-label="Review your choice"/g) ?? []).length, 1);
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}
function fact(game: GameState, payload: CommandPayload, label: string) {
  const result = getStudioManagementReview(game, payload).facts.find(item => item.label === label);
  assert.ok(result, `Missing review fact: ${label}`);
  return result.value;
}

test('research review converts authored staff-weeks and agrees with authoritative requirements for every role', () => {
  const game = fixture();
  const exact: Record<string, string> = {
    R1: '2 CUw · 40 Research points',
    R2: '4 CUw · 60 Data points',
    R3: '2 CUw · 40 Design points',
    R12: '12 CUw · 120 Operations points',
    R16: '16 CUw · 160 Hardware points',
  };
  for (const [researchId, expected] of Object.entries(exact)) {
    const payload: CommandPayload = { kind: 'start_research', researchId };
    assert.equal(fact(game, payload, 'Research work'), expected, researchId);
  }
  const authoritative = getResearchView(game, game.playerCompanyId, CONTENT);
  for (const method of authoritative) {
    assert.equal(fact(game, { kind: 'start_research', researchId: method.id }, 'Research work'),
      `${formatUnits(method.requiredWork)} CUw · ${formatWorkPoints(method.requiredStaff)} ${WORK_POINT_LABELS[method.role]} points`, method.id);
  }
  const text = render(game, { kind: 'start_research', researchId: 'R1' });
  assert.match(text, /Research work 2 CUw · 40 Research points/);
  assert.doesNotMatch(text, /0 [Rr]esearch staff-week/);
});

test('public canary review binds exact prepared source and candidate, traffic, cohort floor and work allowance', () => {
  const game = fixture();
  const canary = Object.values(game.slices.products.canaryReleases!)[0];
  const release = game.slices.products.preparedReleases![canary.releaseId];
  const payload: CommandPayload = { kind: 'start_release_canary', releaseId: release.id, shareBps: 500, sampleFloor: 300, budgetCUw: 4 * U };
  const text = render(game, payload);
  for (const id of [release.id, release.sourceModelId, release.candidateModelId, release.productId, release.rehearsalId]) assert.ok(text.includes(id), id);
  assert.equal(fact(game, payload, 'Paid traffic sent to the new model'), '5%');
  assert.equal(fact(game, payload, 'Minimum sample per customer group'), '300 exchanges');
  assert.match(fact(game, payload, 'Live test compute limit'), /4 CUw; not a cash charge/);
  assert.match(text, /customers are charged once/); assert.match(text, /choose when to switch/);
});

test('stopping a canary shows its own consumed allowance and keeps archived evidence read only', () => {
  const game = fixture(), canary = Object.values(game.slices.products.canaryReleases!)[0];
  const payload: CommandPayload = { kind: 'stop_release_canary', canaryId: canary.id };
  assert.equal(fact(game, payload, 'Test compute used'), `${formatUnits(canary.consumedWorkCUw)} / ${formatUnits(canary.budgetCUw)} CUw`);
  const text = render(game, payload); assert.ok(text.includes(canary.candidateModelId)); assert.ok(text.includes(canary.id));
});

test('rollback review exposes the original retained source, exact deadline and separate preparation', () => {
  const game = fixture();
  const release = Object.values(game.slices.products.preparedReleases!).find(item => item.rollbackExpiresWeek !== null)!;
  assert.ok(release);
  const payload: CommandPayload = { kind: 'start_release_rollback', releaseId: release.id };
  const text = render(game, payload, true);
  assert.match(fact(game, payload, 'Rollback deadline'), new RegExp(`Week ${release.rollbackExpiresWeek}`));
  assert.ok(text.includes(release.sourceModelId)); assert.ok(text.includes(release.candidateModelId));
  assert.match(text, /Refresh review/); assert.match(text, /Pausing does not extend the rollback deadline/);
});

test('rollback pause and handover show rollback work and restore target instead of completed forward work', () => {
  const game = fixture();
  const release = Object.values(game.slices.products.preparedReleases!).find(item => item.rollback)!;
  // An existing real rollback receipt supplies the work contract. Re-open its
  // presentation state to distinguish rollback from forward meters in this UI test.
  release.rollback!.status = 'preparing'; release.rollback!.completedWork = U / 2;
  release.rollback!.completedStaff = U / 4; release.rollback!.availableWeek = null;
  const pause: CommandPayload = { kind: 'set_prepared_release_paused', releaseId: release.id, paused: true };
  assert.equal(fact(game, pause, 'Status'), 'Preparing');
  assert.equal(fact(game, pause, 'Work completed'), '0.5 / 1 CUw');
  assert.equal(fact(game, pause, 'Work points completed'), '5 / 20 points');
  assert.ok(fact(game, pause, 'Model after the switch').includes(release.sourceModelId));
  release.rollback!.status = 'ready';
  const promote: CommandPayload = { kind: 'promote_prepared_release', releaseId: release.id };
  assert.equal(fact(game, promote, 'Release direction'), 'Switch back to the original model');
  assert.equal(fact(game, promote, 'Status'), 'Ready');
});

test('missing and foreign selections never substitute a latest owned entity or expose a rival identity', () => {
  const game = fixture();
  const rival = Object.values(game.slices.products.offers).find(item => item.companyId !== game.playerCompanyId)!;
  const rivalModel = Object.values(game.slices.models.versions).find(item => item.companyId !== game.playerCompanyId)!;
  const missing: CommandPayload[] = [
    { kind: 'start_prepared_release', productId: 'missing-product', candidateModelId: 'missing-candidate' },
    { kind: 'promote_prepared_release', releaseId: 'missing-release' },
    { kind: 'start_chip_prototype', designId: 'missing-design', modelId: 'missing-model' },
    { kind: 'set_rack_parked', rackId: 'missing-rack', parked: true },
    { kind: 'set_synthetic_job_paused', jobId: 'missing-job', paused: true },
  ];
  for (const payload of missing) {
    const text = render(game, payload); assert.match(text, /Unavailable/);
    for (const [key, value] of Object.entries(payload)) if (key.endsWith('Id')) assert.ok(text.includes(value), `Keep captured ${key}`);
  }
  const review = getStudioManagementReview(game, { kind: 'upgrade_product', productId: rival.id, modelId: rivalModel.id });
  const text = review.facts.map(item => item.value).join(' ');
  assert.ok(text.includes(`Unavailable product (${rival.id})`)); assert.ok(text.includes(`Unavailable model (${rivalModel.id})`));
  assert.ok(!text.includes(rival.name)); assert.ok(!text.includes(rivalModel.name));
});

test('Campus review shows selected site, authored benefits and physical resource tradeoffs', () => {
  const game = fixture('wave27-appliance-published');
  const site = Object.values(game.slices.compute.facilities).find(item => item.companyId === game.playerCompanyId)!;
  const payload: CommandPayload = { kind: 'start_facility_specialization', facilityId: site.id, profile: 'serving' };
  const text = render(game, payload), profile = FACILITY_PROFILES.find(item => item.profile === 'serving')!;
  assert.ok(text.includes(site.name)); assert.ok(text.includes(site.id));
  assert.ok(text.includes(profile.benefit)); assert.ok(text.includes(profile.tradeoff));
  assert.match(text, /3 weeks · 60 Operations points · 6 CUw · 2 MU/);
  assert.match(text, /current site setup stays active during the upgrade/);
});

test('rack parking and relocation distinguish installed assets from immediately usable capacity', () => {
  const game = fixture(), rack = Object.values(game.slices.compute.racks).find(item => item.companyId === game.playerCompanyId && item.status === 'installed')!;
  const text = render(game, { kind: 'set_rack_parked', rackId: rack.id, parked: true });
  assert.ok(text.includes(rack.id)); assert.match(text, /Installed in Week/); assert.match(text, /Wages and fixed upkeep can continue/);
  const move = render(game, { kind: 'start_rack_relocation', rackId: rack.id, destination: 'colocation' });
  assert.match(move, /rack is offline while it moves/); assert.match(move, /Destination Colocation/);
});

test('infrastructure reviews use the same player role label for rack, fabric and retrofit effort', () => {
  const game = fixture(), rack = Object.values(game.slices.compute.racks).find(item => item.companyId === game.playerCompanyId)!;
  const site = Object.values(game.slices.compute.facilities).find(item => item.companyId === game.playerCompanyId)!;
  assert.equal(fact(game, { kind: 'install_rack', rackId: rack.id }, 'Installation effort'), '20 Operations points');
  assert.equal(fact(game, { kind: 'order_rack', hardwareId: 'general', location: 'colocation' }, 'Delivery and installation'),
    '6 delivery weeks · 20 Operations points to install');
  assert.equal(fact(game, { kind: 'install_fast_fabric', location: site.id }, 'Installation effort'),
    '3 weeks · 40 Operations points · 4 CUw');
  const retrofit: CommandPayload = { kind: 'start_facility_retrofit', facilityId: site.id, retrofitKind: 'power-feed' };
  assert.equal(fact(game, retrofit, 'Construction effort'), '4 weeks · 40 Operations points');
  assert.match(fact(game, retrofit, 'Extension operation'), /1 Operations points \/ week/);
  for (const payload of [{ kind: 'install_rack', rackId: rack.id }, { kind: 'install_fast_fabric', location: site.id }, retrofit] as CommandPayload[]) {
    const review = getStudioManagementReview(game, payload);
    assert.doesNotMatch(review.facts.map(item => item.value).join(' '), /compute staff|compute FTE|\bml staff/);
  }
});

test('chip batch and successor reviews use exact parent identity and actual production terms', () => {
  const game = fixture('wave27-appliance-published');
  const design = Object.values(game.slices.compute.chipDesigns).find(item => item.companyId === game.playerCompanyId)!;
  const batch: CommandPayload = { kind: 'order_chip_batch', designId: design.id, racks: 2, location: 'colocation', foundry: 'high-yield' };
  const terms = chipProductionTerms(design, 2, CONTENT.infrastructure.rackCU, 'high-yield');
  const text = render(game, batch);
  assert.ok(text.includes(design.name)); assert.ok(text.includes(design.id));
  assert.match(text, new RegExp(`${formatUnits(terms.usableCU)} useful CU`));
  assert.equal(fact(game, batch, 'Fabrication lead time'), `${terms.leadWeeks} weeks`);
  assert.doesNotMatch(text, /You earn money for completed requests|Deadlines keep counting down|chosen hardware and compute limit/);
  assert.match(fact(game, { ...batch, racks: 1 }, 'Fabrication'), /^1 rack · /);
  assert.match(fact(game, batch, 'Fabrication'), /^2 racks · /);
  assert.doesNotMatch(getStudioManagementReview(game, { kind: 'set_batch_capacity', cloudCU: U, servingCU: U }).notes.join(' '),
    /You earn money for completed requests|Deadlines keep counting down/);
  const successor: CommandPayload = { kind: 'start_chip_successor', parentDesignId: design.id, name: 'Cedar II', improvement: 'memory' };
  const next = render(game, successor);
  assert.ok(next.includes(`${formatUnits(GEN2_SILICON_RULES.designWorkCUw)} CUw`));
  assert.match(next, /Design and test a new prototype for this chip before ordering production/);
  assert.match(next, /Measured parent yield/); assert.doesNotMatch(next, /yield are not inherited/); assert.ok(next.includes('Cedar II'));
});

test('private appliance review separates fabrication cost, customer receipt, support and lab capacity', () => {
  const game = fixture('wave27-appliance-published');
  const design = Object.values(game.slices.compute.chipDesigns)[0];
  const contract = Object.values(game.slices.products.commercialContracts).find(item => item.customerId === PRIVATE_APPLIANCE_BUYER.id)!;
  const payload: CommandPayload = { kind: 'accept_private_appliance_order', buyerId: PRIVATE_APPLIANCE_BUYER.id, modelId: contract.modelId, designId: design.id, foundry: 'standard' };
  const terms = previewPrivateApplianceOrder(game, payload), text = render(game, payload);
  assert.ok(text.includes('Cedar Records')); assert.ok(text.includes(contract.modelId)); assert.ok(text.includes(design.id));
  assert.ok(text.includes(formatMoney(terms.fabricationCostCents))); assert.ok(text.includes(formatMoney(terms.bundlePriceCents)));
  assert.match(text, /after acceptance/); assert.match(text, /adds no compute to your lab/); assert.match(text, /12 weeks/);
});

test('synthetic review retains the exact teacher and source and shows later paid review and audit', () => {
  const game = fixture('wave26-published'), job = Object.values(game.slices.data.syntheticJobs!)[0];
  const payload: CommandPayload = { kind: 'start_synthetic_generation', teacherModelId: job.teacherModelId, sourcePacketId: job.sourcePacketId, domain: job.domain };
  const terms = previewSyntheticGeneration(game, payload), text = render(game, payload);
  assert.ok(text.includes(job.teacherModelId)); assert.ok(text.includes(job.sourcePacketId));
  assert.ok(text.includes(formatMoney(terms.reviewFeeCents))); assert.ok(text.includes(`${formatUnits(terms.requiredWork)} CUw`));
  assert.match(text, /Only data that passes can be used for training/);
  const review = render(game, { kind: 'start_synthetic_review', jobId: job.id });
  assert.ok(review.includes(job.id)); assert.ok(review.includes(job.sourcePacketId)); assert.match(review, /Review effort/);
});

test('agent review shows selected intake, allowed tools, action permissions and hard execution bounds', () => {
  const game = fixture(), board = getAgentView(game, game.playerCompanyId);
  const order = board.orders[0], model = board.models[0]; assert.ok(order && model);
  const payload: CommandPayload = { kind: 'start_agent_job', orderId: order.id, modelId: model.id, mode: 'approval', verification: 'independent', tools: ['read_ticket', 'search_docs', 'send_reply'], maxSteps: 12, maxRetries: 2, workBudget: 3 * U };
  const text = render(game, payload);
  assert.ok(text.includes(order.id)); assert.ok(text.includes(order.name)); assert.ok(text.includes(model.id));
  assert.match(text, /Allowed tools/); assert.match(text, /Maximum steps 12/); assert.match(text, /Maximum retries 2/); assert.match(text, /Total work allowance 3 CUw/);
  assert.match(text, /Mode Approval/); assert.match(text, /Verification Independent/); assert.match(text, /Taking the job earns no payment by itself/);
});

test('retained agent choices stay unavailable across a real intake change until explicitly selected again', () => {
  let game = fixture();
  const original = getAgentView(game, game.playerCompanyId), order = original.orders[0], model = original.models[0];
  assert.ok(order && model);
  assert.equal(resolveAgentOrderSelection(original, order.id, model.id).problem, undefined);
  for (let count = 0; count < 4; count++) {
    const next = advanceWeek(game, CONTENT); assert.equal(next.accepted, true, next.reason?.message); game = next.state;
  }
  const next = getAgentView(game, game.playerCompanyId);
  assert.ok(next.orders.every(item => item.id !== order.id), 'Intake IDs changed naturally');
  const stale = resolveAgentOrderSelection(next, order.id, model.id);
  assert.equal(stale.order, undefined); assert.equal(stale.model?.id, model.id);
  assert.match(stale.problem!, /Choose a new order/);
  const chosen = next.orders[0];
  const changedModelAvailability = { ...next, models: next.models.filter(item => item.id !== model.id) };
  assert.ok(changedModelAvailability.models.length, 'A different available model must not substitute the captured model');
  const unavailable = resolveAgentOrderSelection(changedModelAvailability, chosen.id, model.id);
  assert.equal(unavailable.order?.id, chosen.id); assert.equal(unavailable.model, undefined);
  assert.match(unavailable.problem!, /Choose another tested model/);
  const recovered = resolveAgentOrderSelection(changedModelAvailability, chosen.id, changedModelAvailability.models[0].id);
  assert.equal(recovered.problem, undefined); assert.equal(recovered.model?.id, changedModelAvailability.models[0].id);
});

test('batch and commercial commitments preserve captured models and real deadlines', () => {
  const game = fixture(), job = Object.values(game.slices.products.batchJobs!)[0];
  const text = render(game, { kind: 'set_batch_job_paused', jobId: job.id, paused: true });
  assert.ok(text.includes(job.id)); assert.ok(text.includes(job.model.modelId)); assert.ok(text.includes(`Week ${job.deadlineWeek}`));
  assert.match(text, /Deadlines keep counting down during pauses/);
  const contract = Object.values(game.slices.products.commercialContracts)[0];
  const renewal = render(game, { kind: 'set_business_renewal', contractId: contract.id, renew: false });
  assert.ok(renewal.includes(contract.id)); assert.ok(renewal.includes(contract.modelId)); assert.ok(renewal.includes(formatMoney(contract.weeklyPriceCents)));
  assert.match(renewal, /Renew No/);
});

test('API terms and launch show reference token billing rather than subscription pricing', () => {
  const game = fixture(), offer = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId && item.kind === 'developer-api')!;
  const text = render(game, { kind: 'set_product_terms', productId: offer.id, priceCents: 1250, allowance: 900 });
  assert.match(text, /New sample bill \/ 600 requests \$12.50/);
  assert.match(text, /New weekly request limit \/ account 900/);
  assert.match(text, /Customers pay for tokens you process/);
  assert.doesNotMatch(text, /New price \/ account \/ week/);
  const modelId = game.slices.products.deployments[offer.deploymentId].modelId;
  const launch = render(game, { kind: 'deploy_product', productKind: 'developer-api', modelId, priceCents: 1250, allowance: 900, features: { memory: false, extendedContext: true, deepReasoning: false } });
  assert.match(launch, /Reference bill \/ 600 requests/); assert.match(launch, /Extended context on/); assert.doesNotMatch(launch, /Price \/ account \/ week/);
});

test('direct product replacement review explains deployment interruption separately from prepared handover', () => {
  const game = fixture();
  const product = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId && item.kind === 'basic-chat')!;
  const current = game.slices.products.deployments[product.deploymentId];
  const candidate = Object.values(game.slices.models.versions).find(item => item.companyId === game.playerCompanyId && item.id !== current.modelId)!;
  const text = render(game, { kind: 'upgrade_product', productId: product.id, modelId: candidate.id });
  assert.match(text, /Replacing the model directly pauses service during setup/);
  assert.match(text, /credits subscribers for missed service/);
  assert.doesNotMatch(text, /current model keeps serving customers during rehearsal/);
  assert.ok(text.includes(product.id)); assert.ok(text.includes(current.modelId)); assert.ok(text.includes(candidate.id));
});
