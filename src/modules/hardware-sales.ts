import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from '../core/model-customization-version';
import { STRATEGY_CONTENT_VERSION } from '../core/strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import type { ChipFoundry, HardwareBuyerId } from '../contracts/wave4-hardware';
import type { CommandQuote, ComputeSlice, DomainResult, GameCommand, GameContent, GameState, LedgerFact, Rejection } from '../contracts/types';
import { CHIP_FOUNDRIES, HARDWARE_BUYERS, SILICON_CONTENT_VERSION, chipProductionTerms, hardwareBuyerFit, isChipFoundry } from '../content/silicon-market';
import { SYNTHETIC_CONTENT_VERSION } from '../content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { PRIVATE_APPLIANCE_BUYER } from '../content/wave27-appliance';
import { formatMoney, formatUnits } from '../core/math';

export function availableFoundrySlots(state: Readonly<GameState>, foundry: ChipFoundry, excludeCommandId?: string): number | null {
  const limit = CHIP_FOUNDRIES[foundry].rackSlots;
  if (limit === null) return null;
  const internal = Object.values(state.slices.compute.chipBatches).filter(batch => batch.foundry === foundry && batch.status === 'fabricating')
    .reduce((sum, batch) => sum + batch.racks, 0);
  const external = Object.values(state.slices.compute.hardwareSales ?? {}).filter(sale => sale.foundry === foundry && sale.shippedWeek === null)
    .reduce((sum, sale) => sum + HARDWARE_BUYERS[sale.buyerId].racks, 0);
  const appliances = Object.values(state.slices.products.privateApplianceOrders ?? {}).filter(order => order.configuration.foundry === foundry && order.shippedWeek === null)
    .reduce((sum, order) => sum + order.configuration.racks, 0);
  let queued = 0;
  for (const command of state.queuedCommands) {
    if (command.id === excludeCommandId) continue;
    const payload = command.payload;
    if (payload.kind === 'order_chip_batch' && payload.foundry === foundry) queued += payload.racks;
    if (payload.kind === 'accept_hardware_order' && payload.foundry === foundry) queued += HARDWARE_BUYERS[payload.buyerId].racks;
    if (payload.kind === 'accept_private_appliance_order' && payload.foundry === foundry) queued += PRIVATE_APPLIANCE_BUYER.racks;
  }
  return Math.max(0, limit - internal - external - appliances - queued);
}

export function validateHardwareSale(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const payload = command.payload;
  if (![SILICON_CONTENT_VERSION, SYNTHETIC_CONTENT_VERSION, STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version) || payload.kind !== 'accept_hardware_order' || !Object.hasOwn(HARDWARE_BUYERS, payload.buyerId) || !isChipFoundry(payload.foundry)) return { code: 'INVALID_COMMAND', message: 'Choose a listed hardware buyer and foundry.' };
  if (command.companyId !== state.playerCompanyId) return { code: 'NOT_READY', message: 'This order is offered to the player’s lab.' };
  const design = state.slices.compute.chipDesigns[payload.designId], buyer = HARDWARE_BUYERS[payload.buyerId];
  if (design?.companyId !== command.companyId || design.status !== 'validated') return { code: 'NOT_READY', message: 'Choose an owned, prototype-qualified chip design.' };
  if (state.slices.compute.hardwareSales?.[payload.buyerId] || state.queuedCommands.some(other => other.id !== command.id && other.payload.kind === 'accept_hardware_order' && other.payload.buyerId === payload.buyerId)) return { code: 'ALREADY_ACTIVE', message: 'This buyer’s one-time order is already committed or fulfilled.' };
  const terms = chipProductionTerms(design, buyer.racks, content.infrastructure.rackCU, payload.foundry);
  const reason = hardwareBuyerFit(design, payload.buyerId, terms);
  if (reason) return { code: 'NOT_READY', message: reason };
  const slots = availableFoundrySlots(state, payload.foundry, command.id);
  if (slots !== null && slots < buyer.racks) return { code: 'CAPACITY_EXCEEDED', message: 'The foundry cannot fit this batch alongside its other committed orders.' };
}

const orderId = (buyerId: HardwareBuyerId) => 'hardware-order:' + buyerId;
export const hardwareCostFactId = (buyerId: HardwareBuyerId) => orderId(buyerId) + ':cost';
export const hardwareRevenueFactId = (buyerId: HardwareBuyerId) => orderId(buyerId) + ':receipt';

export function quoteHardwareSale(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const payload = command.payload;
  if (payload.kind !== 'accept_hardware_order') throw new Error('Expected a hardware order.');
  const buyer = HARDWARE_BUYERS[payload.buyerId], design = state.slices.compute.chipDesigns[payload.designId];
  const terms = chipProductionTerms(design, buyer.racks, content.infrastructure.rackCU, payload.foundry);
  return { upfrontCostCents: terms.costCents, weeklyCostDeltaCents: 0,
    summary: `Pay ${formatMoney(terms.costCents)} to fabricate ${formatUnits(terms.usableCU)} useful CU. ${buyer.name} pays ${formatMoney(buyer.priceCents)} after ${terms.leadWeeks} weeks of fabrication. Batch contribution is ${formatMoney(buyer.priceCents - terms.costCents)} before design and company overhead.` };
}

export function applyHardwareSale(state: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  const payload = command.payload;
  if (payload.kind !== 'accept_hardware_order') throw new Error('Expected a hardware order.');
  const buyer = HARDWARE_BUYERS[payload.buyerId], design = state.slices.compute.chipDesigns[payload.designId], compute = structuredClone(state.slices.compute);
  const terms = chipProductionTerms(design, buyer.racks, content.infrastructure.rackCU, payload.foundry);
  const arrivalWeek = state.week + terms.leadWeeks;
  (compute.hardwareSales ??= {})[payload.buyerId] = { buyerId: payload.buyerId, companyId: command.companyId,
    designId: design.id, foundry: payload.foundry, orderedWeek: state.week, arrivalWeek, shippedWeek: null };
  return { updates: { compute },
    facts: [{ id: hardwareCostFactId(payload.buyerId), sourceId: orderId(payload.buyerId), companyId: command.companyId,
      kind: 'expense', category: 'operating', amountCents: terms.costCents, week: state.week, label: buyer.name + ' hardware fabrication' }],
    messages: [{ companyId: command.companyId, category: 'market', message: `${buyer.name} order accepted. The foundry ships directly to the buyer in Week ${arrivalWeek}.` }] };
}

export function commitHardwareSales(compute: ComputeSlice, week: number): { facts: LedgerFact[]; messages: NonNullable<DomainResult['messages']> } {
  const facts: LedgerFact[] = [], messages: NonNullable<DomainResult['messages']> = [];
  for (const sale of Object.values(compute.hardwareSales ?? {})) {
    if (sale.shippedWeek !== null || sale.arrivalWeek !== week) continue;
    const buyer = HARDWARE_BUYERS[sale.buyerId];
    sale.shippedWeek = week;
    facts.push({ id: hardwareRevenueFactId(sale.buyerId), sourceId: orderId(sale.buyerId), companyId: sale.companyId,
      kind: 'receipt', category: 'revenue', amountCents: buyer.priceCents, week, label: buyer.name + ' hardware shipment' });
    messages.push({ companyId: sale.companyId, category: 'market', message: `${buyer.name} received its accelerators and paid ${formatMoney(buyer.priceCents)}.` });
  }
  return { facts, messages };
}
