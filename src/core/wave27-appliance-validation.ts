import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from './model-customization-version';
import { STRATEGY_CONTENT_VERSION } from './strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { ChipFoundry } from '../contracts/wave4-hardware';
import { PRIVATE_APPLIANCE_BUYER as BUYER, PRIVATE_APPLIANCE_RULES as RULES } from '../content/wave27-appliance';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { COMMERCE_RULES } from '../content/wave3-commerce';
import { CHIP_FOUNDRIES, HARDWARE_BUYERS, isChipFoundry } from '../content/silicon-market';
import { privateApplianceBundleReceiptId, privateApplianceConfiguration, privateApplianceContractId, privateApplianceFabricationFactId, privateApplianceOrderId } from '../modules/private-appliances';
import { evaluatedReleaseIdentityReason } from '../modules/release-identity';
import { canonicalStateHash } from './canonical';
import { checkedInteger } from './math';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value), 'Private appliance identity is invalid.'); }
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);

export function assertWave27ApplianceCommand(payload: CommandPayload): void {
  if (payload.kind !== 'accept_private_appliance_order') return;
  check(Object.keys(payload).sort().join() === 'buyerId,designId,foundry,kind,modelId'
    && payload.buyerId === BUYER.id && isChipFoundry(payload.foundry), 'Choose only the supported appliance buyer, model, design and foundry.');
  id(payload.modelId); id(payload.designId);
}

/** Exact artifact, real delivery work, one bundle settlement and the ordinary customer-hosted term. */
export function assertWave27ApplianceState(state: GameState, content: GameContent): void {
  const { products, company, compute } = state.slices, orders = products.privateApplianceOrders;
  const cedarContract = products.commercialContracts[privateApplianceContractId()];
  if (Object.hasOwn(products, 'privateApplianceOrders')) {
    check([STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version), 'Private appliances are unavailable in this content version.');
    record(orders, 'Private appliance orders');
    check(Object.keys(orders!).every(key => key === BUYER.id), 'The finite private appliance buyer was expanded.');
  }
  if (!orders?.[BUYER.id]) {
    check(!cedarContract && !company.postedFacts[privateApplianceFabricationFactId()] && !company.postedFacts[privateApplianceBundleReceiptId()], 'Appliance contract or ledger facts require the corresponding order.');
  }
  const past = (week: number, label: string) => { checkedInteger(week, label); check(week <= state.week, label + ' is in the future.'); };
  const fact = (factId: string, sourceId: string, companyId: string, kind: 'expense' | 'receipt', amountCents: number, week: number) => {
    check(company.postedFacts[factId] === true, 'Private appliance payment or settlement has no posted proof.');
    const entry = company.ledger.find(item => item.id === factId);
    if (entry) check(entry.companyId === companyId && entry.sourceId === sourceId && entry.kind === kind && entry.category === (kind === 'expense' ? 'operating' : 'revenue')
      && entry.amountCents === amountCents && entry.week === week && entry.unpaidCents === 0, 'Private appliance ledger proof differs from its frozen terms.');
  };
  const bookings: Array<{ foundry: ChipFoundry; start: number; end: number; racks: number }> = [];
  for (const [key, order] of Object.entries(orders ?? {})) {
    record(order, 'Private appliance order');
    check(Object.keys(order).sort().join() === 'acceptedWeek,arrivalWeek,artifact,bundlePriceCents,bundleReceiptId,buyerId,commandId,companyId,configuration,contractId,delivery,fabricationFactId,id,modelId,orderedWeek,settledWeek,shippedWeek', 'Private appliance order has unknown or missing fields.');
    check(key === BUYER.id && order.buyerId === BUYER.id && order.id === privateApplianceOrderId() && order.companyId === state.playerCompanyId
      && order.contractId === privateApplianceContractId(), 'Private appliance order identity or buyer is invalid.');
    id(order.commandId); id(order.modelId); past(order.orderedWeek, 'Appliance order week'); checkedInteger(order.arrivalWeek);
    const command = state.commandReceipts[order.commandId];
    check(command?.status === 'accepted' && command.week === order.orderedWeek, 'Private appliance has no accepted order command.');
    check(Object.values(state.slices.research.projects).some(project => project.companyId === order.companyId && project.researchId === RULES.requiredResearch
      && project.status === 'complete' && typeof project.availableWeek === 'number' && project.availableWeek < order.orderedWeek), 'Private appliance was ordered before S4 became available.');
    const configuration = order.configuration; record(configuration, 'Private appliance configuration'); record(configuration.release, 'Private appliance release');
    check(configuration.release.modelId === order.modelId && !evaluatedReleaseIdentityReason(state, configuration.release, content, order.orderedWeek - 1), 'Private appliance lost its exact paid evaluation, policy, runtime or inherited release rights.');
    const model = state.slices.models.versions[order.modelId];
    check(model?.companyId === order.companyId && model.architecture === BUYER.architecture && (RULES.supportedFamilies as readonly string[]).includes(model.family)
      && model.capabilityBps.documents >= BUYER.minimumScoreBps && model.reliabilityBps >= BUYER.minimumReliabilityBps && configuration.release.rights.weights,
    'Private appliance model does not meet the buyer’s exact evaluated workload and distribution requirements.');
    const design = compute.chipDesigns[configuration.designId];
    check(design?.companyId === order.companyId && design.status === 'validated' && design.spec.architecture === BUYER.architecture
      && design.spec.target === BUYER.target && design.spec.memory === BUYER.memory && design.prototypeRun?.readyWeek !== null
      && design.prototypeRun!.readyWeek! < order.orderedWeek, 'Private appliance hardware was not qualified for this fixed configuration before the order.');
    check(isChipFoundry(configuration.foundry), 'Private appliance foundry is invalid.');
    const expected = privateApplianceConfiguration(state, { modelId: order.modelId, designId: design.id, foundry: configuration.foundry }, content, configuration.release);
    check(expected && same(configuration, expected), 'Private appliance changed its frozen runtime, design, production, capacity or cost.');
    check(configuration.usableCU >= BUYER.minimumUsefulCU && configuration.memoryMU >= Math.max(BUYER.minimumMemoryMU, configuration.requiredMemoryMU)
      && configuration.weeklyCapacityCUw >= configuration.weeklyWorkCUw && configuration.leadWeeks <= BUYER.maximumLeadWeeks,
    'The private appliance cannot execute the buyer’s workload or meet its capacity and shipment promise.');
    check(order.arrivalWeek === order.orderedWeek + configuration.leadWeeks && order.shippedWeek === (order.arrivalWeek <= state.week ? order.arrivalWeek : null), 'Private appliance shipment is missing, premature or repeated.');
    check(order.fabricationFactId === privateApplianceFabricationFactId() && order.bundleReceiptId === privateApplianceBundleReceiptId()
      && order.bundlePriceCents === BUYER.bundlePriceCents, 'Private appliance fabrication or bundle terms changed.');
    fact(order.fabricationFactId, order.id, order.companyId, 'expense', configuration.fabricationCostCents, order.orderedWeek);
    const contract = products.commercialContracts[order.contractId];
    check(contract && contract.customerId === BUYER.id && contract.companyId === order.companyId && contract.modelId === order.modelId
      && contract.contractKind === 'customer-hosted' && contract.generation === 1 && contract.signedWeek === order.orderedWeek
      && contract.setupFactId === 'business-setup:' + order.commandId, 'Private appliance lost its single linked fixed-weight delivery and support contract.');
    check(contract.setupFeeCents === BUYER.licenseSetupCents && contract.weeklyPriceCents === BUYER.licenseWeeklyCents
      && contract.requiredDeliveryStaff === COMMERCE_RULES.licenseDeliveryStaff && contract.supportStaffPerWeek === COMMERCE_RULES.supportStaffPerOrganization,
    'Private appliance delivery and service must use the ordinary customer-hosted terms.');
    fact(contract.setupFactId, contract.id, order.companyId, 'expense', BUYER.licenseSetupCents, order.orderedWeek);
    const delivery = order.delivery; record(delivery, 'Private appliance delivery work');
    check(Object.keys(delivery).sort().join() === 'completedStaff,firstWeek,grantCount,latestGrant', 'Private appliance delivery meter changed.');
    checkedInteger(delivery.completedStaff); checkedInteger(delivery.grantCount);
    check(delivery.completedStaff === contract.completedDeliveryStaff && delivery.completedStaff <= COMMERCE_RULES.licenseDeliveryStaff, 'Private appliance delivery progress differs from its shared contract.');
    if (delivery.latestGrant === null) check(delivery.completedStaff === 0 && delivery.grantCount === 0 && delivery.firstWeek === null, 'Private appliance delivery has progress without an ML grant.');
    else {
      const latest = delivery.latestGrant; record(latest, 'Private appliance latest ML grant');
      check(Object.keys(latest).sort().join() === 'grantedStaff,remainingBefore,week', 'Private appliance ML grant fields changed.');
      for (const value of [latest.week, latest.remainingBefore, latest.grantedStaff, delivery.firstWeek]) checkedInteger(value!);
      check(order.shippedWeek !== null && delivery.firstWeek! >= order.shippedWeek && latest.week >= delivery.firstWeek! && latest.week <= state.week
        && delivery.grantCount > 0 && delivery.grantCount <= latest.week - delivery.firstWeek! + 1
        && delivery.completedStaff <= delivery.grantCount * U && latest.grantedStaff > 0 && latest.grantedStaff <= Math.min(U, latest.remainingBefore)
        && latest.remainingBefore <= COMMERCE_RULES.licenseDeliveryStaff
        && delivery.completedStaff === COMMERCE_RULES.licenseDeliveryStaff - latest.remainingBefore + latest.grantedStaff,
      'Private appliance ML delivery exceeds its granted staff or shipment boundary.');
      const report = compute.costReports?.[order.companyId]?.find(item => item.week === latest.week);
      if (report) {
        const requestId = 'business-delivery:' + contract.id, request = report.resources.requests.find(item => item.id === requestId);
        const granted = report.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
        check(request?.taskId === contract.id && request.normalizedWorkCUw === 0 && request.memoryMU === 0
          && request.staffDemand?.find(item => item.role === 'ml')?.staffWeeks === Math.min(U, latest.remainingBefore)
          && granted === latest.grantedStaff, 'Private appliance delivery differs from the shared allocator’s real staff receipt.');
      }
    }
    if (order.shippedWeek === null) check(contract.status === 'building' && contract.completedDeliveryStaff === 0 && contract.readyWeek === null, 'Private appliance installation began before hardware shipment.');
    if (contract.readyWeek !== null) check(order.shippedWeek !== null && delivery.latestGrant !== null
      && contract.readyWeek === delivery.latestGrant.week + 1 && contract.readyWeek >= order.shippedWeek + Math.ceil(COMMERCE_RULES.licenseDeliveryStaff / U),
    'Private appliance acceptance skipped actual installation or its availability boundary.');
    const accepted = contract.readyWeek !== null && contract.readyWeek <= state.week;
    check(order.acceptedWeek === (accepted ? contract.readyWeek : null) && order.settledWeek === order.acceptedWeek, 'Private appliance acceptance and its one bundle settlement disagree.');
    check((company.postedFacts[order.bundleReceiptId] === true) === accepted, 'Private appliance bundle must settle exactly once, at acceptance.');
    if (accepted) {
      past(order.acceptedWeek!, 'Private appliance acceptance');
      check(same(order.artifact, { id: order.id + ':installed', acceptedWeek: order.acceptedWeek, configuration }), 'Installed appliance artifact differs from the frozen sold configuration.');
      fact(order.bundleReceiptId, order.id, order.companyId, 'receipt', order.bundlePriceCents, order.acceptedWeek!);
    } else check(order.artifact === null && ['building', 'ready'].includes(contract.status) && contract.lastUsage === null, 'Unaccepted appliance created an installed artifact, service or billing.');
    check([contract.reservedWorkCUw, contract.reservedMemoryMU, contract.weeklyRequests, contract.workPerRequestCUw, contract.inputTokensPerRequest,
      contract.outputTokensPerRequest, contract.dataStaffPerWeek].every(value => value === 0), 'A private appliance created lab inference capacity, tokens or data upkeep.');
    bookings.push({ foundry: configuration.foundry, start: order.orderedWeek, end: order.arrivalWeek, racks: configuration.racks });
  }
  // Appliance fabrication uses the same historic foundry slots as owned batches and accelerator sales.
  for (const batch of Object.values(compute.chipBatches)) if (batch.foundry) bookings.push({ foundry: batch.foundry, start: batch.orderedWeek, end: batch.arrivalWeek, racks: batch.racks });
  for (const sale of Object.values(compute.hardwareSales ?? {})) bookings.push({ foundry: sale.foundry, start: sale.orderedWeek, end: sale.arrivalWeek, racks: HARDWARE_BUYERS[sale.buyerId].racks });
  for (const booking of bookings) {
    const capacity = CHIP_FOUNDRIES[booking.foundry].rackSlots;
    if (capacity === null) continue;
    const occupied = bookings.filter(other => other.foundry === booking.foundry && other.start <= booking.start && booking.start < other.end).reduce((sum, other) => sum + other.racks, 0);
    check(occupied <= capacity, 'Private appliance and other foundry bookings exceed the shared production line.');
  }
  const queued = state.queuedCommands.filter(command => command.payload.kind === 'accept_private_appliance_order');
  check(queued.length <= 1 && (!queued.length || [STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version) && !orders?.[BUYER.id]), 'Private appliance order is duplicated or unavailable in this build.');
  for (const command of queued) assertWave27ApplianceCommand(command.payload);
  for (const foundry of Object.keys(CHIP_FOUNDRIES) as ChipFoundry[]) {
    const capacity = CHIP_FOUNDRIES[foundry].rackSlots; if (capacity === null) continue;
    const active = bookings.filter(booking => booking.foundry === foundry && booking.end > state.week).reduce((sum, booking) => sum + booking.racks, 0);
    const pending = state.queuedCommands.reduce((sum, command) => {
      const p = command.payload;
      if (p.kind === 'accept_private_appliance_order' && p.foundry === foundry) return sum + BUYER.racks;
      if (p.kind === 'order_chip_batch' && p.foundry === foundry) return sum + p.racks;
      if (p.kind === 'accept_hardware_order' && p.foundry === foundry) return sum + HARDWARE_BUYERS[p.buyerId].racks;
      return sum;
    }, 0);
    check(active + pending <= capacity, 'Queued private appliance and hardware orders exceed the shared foundry capacity.');
  }
}
