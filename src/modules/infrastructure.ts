import { formatWorkPoints } from './workforce-points';
import { CONTENT } from '../content/catalog';
import { CHIP_RULES } from '../content/wave4-hardware';
import { RESOURCE_SCALE } from '../contracts/types';
import type {
  CommandQuote, ComputeSlice, DomainResult, GameCommand, GameContent, GameState,
  HardwareRack, LedgerFact, ModuleContext, Rejection, WorkRequest,
} from '../contracts/types';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import {
  getComputePools, getInfrastructureBaseCost, getInfrastructureOperatingStaff, getInstalledOwnedCU,
  getRackCapacity, getRackHardware, getSiteEnvelope, hasFastFabric, infrastructureOperationsId, synchronizeFleetCapacity,
} from './compute-pools';
import { getWorkforce } from './workforce';
import { activeRackRelocation, committedRackSlots } from './rack-relocation';
import { getActiveFacilityRetrofitEffects } from './facility-retrofits';

export { getComputePools, getInfrastructureBaseCost } from './compute-pools';
export const INFRASTRUCTURE_COMMANDS = ['order_rack', 'install_rack', 'set_rack_parked', 'start_facility', 'fund_facility_stage', 'set_facility_paused'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const installed = (rack: HardwareRack) => rack.status === 'installed' || rack.status === 'parked';
const rackWorkId = (id: string) => `${id}:installation`;
const siteWorkId = (id: string) => `${id}:construction`;

function own<T>(records: Record<string, T>, id: unknown): T | undefined {
  return typeof id === 'string' && Object.hasOwn(records, id) ? records[id] : undefined;
}
function matchingQueued(state: Readonly<GameState>, command: GameCommand, predicate: (other: GameCommand) => boolean) {
  return state.queuedCommands.filter(other => other.id !== command.id && other.companyId === command.companyId && predicate(other));
}
function computeState(state: Readonly<GameState>, compute: ComputeSlice): Readonly<GameState> {
  return { ...state, slices: { ...state.slices, compute } };
}
export function syncInfrastructureFleets(state: Readonly<GameState>, compute: ComputeSlice, content: GameContent): void {
  const snapshot = computeState(state, compute);
  for (const fleet of Object.values(compute.fleets)) Object.assign(fleet, synchronizeFleetCapacity(snapshot, fleet.companyId, content));
}

export function validateInfrastructureCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload, c = content.infrastructure;
  if (p.kind === 'order_rack') {
    if (!['general', 'memory-rich', 'training'].includes(p.hardwareId) || !content.hardware.some(item => item.id === p.hardwareId)) {
      return reject('NOT_READY', 'Choose a general, memory-rich, or training rack. Order custom silicon through a qualified chip design.');
    }
    const site = own(state.slices.compute.facilities, p.location);
    if (p.location !== 'colocation' && (!site || site.companyId !== command.companyId)) return reject('NOT_READY', 'Choose colocation or one of your construction sites.');
    const racks = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === command.companyId);
    const queued = matchingQueued(state, command, other => other.payload.kind === 'order_rack' || other.payload.kind === 'order_chip_batch');
    const queuedCount = queued.reduce((sum, item) => sum + (item.payload.kind === 'order_chip_batch' ? item.payload.racks : 1), 0);
    if (racks.length + queuedCount >= c.maxRacksPerCompany) return reject('CAPACITY_EXCEEDED', 'This company has reached its rack order limit.');
    if (site) {
      const count = committedRackSlots(state, command.companyId, site.id, command.id);
      if ((count + 1) * c.rackCU > c.siteSlotsCU) return reject('CAPACITY_EXCEEDED', 'All accelerator slots at this site are already installed or committed to incoming racks.');
    }
    return;
  }
  if (p.kind === 'install_rack' || p.kind === 'set_rack_parked') {
    const rack = own(state.slices.compute.racks, p.rackId);
    if (!rack || rack.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your hardware racks.');
    if (p.kind === 'install_rack') {
      if (rack.status !== 'inventory') return reject('NOT_READY', 'Installation begins after the rack has arrived in inventory.');
      if (matchingQueued(state, command, other => other.payload.kind === 'install_rack' && other.payload.rackId === rack.id).length) return reject('ALREADY_ACTIVE', 'Installation is already queued for this rack.');
      return;
    }
    if (typeof p.parked !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether this installed rack should be parked.');
    if (activeRackRelocation(state, rack.id) || matchingQueued(state, command, other => other.payload.kind === 'start_rack_relocation' && other.payload.rackId === rack.id).length) return reject('NOT_READY', 'This rack is committed to a paid relocation. Finish commissioning before changing its operating state.');
    if (!installed(rack)) return reject('NOT_READY', 'Finish installation before parking or reactivating a rack.');
    if ((rack.status === 'parked') === p.parked) return reject('ALREADY_ACTIVE', p.parked ? 'This rack is already parked.' : 'This rack is already active.');
    return;
  }
  if (p.kind === 'start_facility') {
    const existing = Object.values(state.slices.compute.facilities).filter(site => site.companyId === command.companyId).length;
    if (existing + matchingQueued(state, command, other => other.payload.kind === 'start_facility').length >= c.maxFacilitiesPerCompany) return reject('CAPACITY_EXCEEDED', 'This company has reached the standard site limit.');
    return;
  }
  if (p.kind === 'fund_facility_stage' || p.kind === 'set_facility_paused') {
    const site = own(state.slices.compute.facilities, p.facilityId);
    if (!site || site.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your facility projects.');
    if (site.status !== 'building') return reject('NO_IMPROVEMENT', 'Construction is complete; the site is commissioning or already operational.');
    if (p.kind === 'set_facility_paused') {
      if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether construction should be paused.');
      if (site.paused === p.paused) return reject('ALREADY_ACTIVE', p.paused ? 'Construction is already paused.' : 'Construction is already running.');
      return;
    }
    if (site.stages[site.stageIndex]?.paidCents) return reject('ALREADY_ACTIVE', 'The current construction stage is already funded.');
    if (site.stageIndex > 0 && site.stages[site.stageIndex - 1]?.completedWeek === null) return reject('NOT_READY', 'The preceding construction stage must finish first.');
    if (matchingQueued(state, command, other => other.payload.kind === 'fund_facility_stage' && other.payload.facilityId === site.id).length) return reject('ALREADY_ACTIVE', 'This stage payment is already queued.');
    return;
  }
  return reject('INVALID_COMMAND', 'This is not an infrastructure command.');
}

export function quoteInfrastructureCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const p = command.payload, c = content.infrastructure;
  if (p.kind === 'order_rack') {
    const hardware = content.hardware.find(item => item.id === p.hardwareId)!;
    const purchase = mulDiv(c.rackCU, hardware.purchaseCentsPerCU, RESOURCE_SCALE);
    const memory = mulDiv(c.rackCU, hardware.memoryMUPerCU, RESOURCE_SCALE);
    return { upfrontCostCents: purchase, weeklyCostDeltaCents: 0,
      summary: `Order ${formatUnits(c.rackCU)} ${hardware.name.toLowerCase()} CU / ${formatUnits(memory)} MU for ${formatMoney(purchase)}. Delivery takes ${c.deliveryWeeks} weeks, followed by ${formatWorkPoints(c.installationStaffWeeks)} Operations points of installation. Inventory supplies no compute.` };
  }
  if (p.kind === 'install_rack') {
    const rack = state.slices.compute.racks[p.rackId];
    const fixed = rack.location === 'colocation' ? c.colocationCentsPerRackWeek : mulDiv(getRackCapacity(rack, content), c.ownedMaintenanceCentsPerCUWeek, RESOURCE_SCALE);
    return { upfrontCostCents: 0, weeklyCostDeltaCents: fixed,
      summary: `Install this rack using ${formatWorkPoints(c.installationStaffWeeks)} Operations points. Once installed, upkeep is ${formatMoney(fixed)}/week plus actual owned GPU usage; site commissioning and operating staff gate usable capacity.` };
  }
  if (p.kind === 'set_rack_parked') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: p.parked ? 'Park this rack next week. It stops supplying compute and releases power/cooling demand; installed upkeep continues.' : 'Reactivate this rack next week, subject to site power, cooling, and operating staff.' };
  if (p.kind === 'start_facility') {
    const total = c.stages.reduce((sum, stage) => sum + stage.costCents, 0);
    const weeks = c.stages.reduce((sum, stage) => sum + stage.elapsedWeeks, 0);
    const staff = c.stages.reduce((sum, stage) => sum + stage.staffWeeks, 0);
    return { upfrontCostCents: c.stages[0].costCents, weeklyCostDeltaCents: 0,
      summary: `Reserve a standard ${formatUnits(c.siteSlotsCU)}-slot site for ${formatMoney(c.stages[0].costCents)} now. Six separately funded stages total ${formatMoney(total)}, ${weeks} elapsed weeks and ${formatWorkPoints(staff)} Operations points. Commissioned site overhead is ${formatMoney(c.siteFixedCentsPerWeek)}/week; hardware is separate.` };
  }
  if (p.kind === 'fund_facility_stage') {
    const site = state.slices.compute.facilities[p.facilityId], stage = c.stages[site.stageIndex];
    return { upfrontCostCents: stage.costCents, weeklyCostDeltaCents: 0,
      summary: `Fund ${site.name}: ${stage.name} for ${formatMoney(stage.costCents)}. Completion needs ${stage.elapsedWeeks} elapsed weeks and ${formatWorkPoints(stage.staffWeeks)} Operations points. Both meters must finish.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: p.kind === 'set_facility_paused' && p.paused ? 'Pause construction next week. Elapsed and staff-work progress stop together.' : 'Resume construction next week, retaining all paid stages and completed work.' };
}

function capitalFact(command: GameCommand, state: Readonly<GameState>, sourceId: string, amountCents: number, label: string): LedgerFact {
  return { id: `capital:${command.id}`, companyId: command.companyId, week: state.week, sourceId, category: 'capital', amountCents, label, kind: 'expense' };
}

export function applyInfrastructureCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  const next = structuredClone(state.slices.compute), p = command.payload, c = content.infrastructure;
  const facts: LedgerFact[] = [], schedule: NonNullable<DomainResult['schedule']> = [];
  let message = '';
  if (p.kind === 'order_rack') {
    const hardware = content.hardware.find(item => item.id === p.hardwareId)!;
    const id = `rack-${command.id}`, purchaseCents = mulDiv(c.rackCU, hardware.purchaseCentsPerCU, RESOURCE_SCALE);
    next.racks[id] = { id, companyId: command.companyId, hardwareId: p.hardwareId, location: p.location, status: 'ordered',
      orderedWeek: state.week, arrivalWeek: state.week + c.deliveryWeeks, installationStartedWeek: null, completedInstallStaff: 0, readyWeek: null, installedWeek: null,
      purchaseCents, lastBottleneck: 'Delivery is pending; this hardware supplies no capacity.' };
    schedule.push({ id: `delivery:${command.id}`, companyId: command.companyId, dueWeek: state.week + c.deliveryWeeks, kind: 'equipment_delivery',
      targetId: id, quantityCU: c.rackCU, memoryMU: mulDiv(c.rackCU, hardware.memoryMUPerCU, RESOURCE_SCALE) });
    facts.push(capitalFact(command, state, id, purchaseCents, `${hardware.name}: eight-CU rack purchase`));
    message = `${hardware.name} rack ordered. Arrival is week ${state.week + c.deliveryWeeks}; installation is a separate project.`;
  } else if (p.kind === 'install_rack') {
    const rack = next.racks[p.rackId]; rack.status = 'installing'; rack.installationStartedWeek = state.week; rack.lastBottleneck = 'Waiting for infrastructure staff to install this rack.';
    delete next.fleets[command.companyId].inventory[rack.id];
    message = 'Rack installation started. Operating capacity begins after the installation boundary and any site commissioning.';
  } else if (p.kind === 'set_rack_parked') {
    const rack = next.racks[p.rackId]; rack.status = p.parked ? 'parked' : 'installed';
    rack.lastBottleneck = p.parked ? 'Parked; installed upkeep continues.' : '';
    message = p.parked ? 'Rack parked. Power and cooling demand were released; installed upkeep continues.' : 'Rack reactivated, subject to site and operating-staff limits.';
  } else if (p.kind === 'start_facility') {
    const id = `facility-${command.id}`;
    const count = Object.values(next.facilities).filter(site => site.companyId === command.companyId).length;
    next.facilities[id] = { id, companyId: command.companyId, name: `Site ${count + 1}`, status: 'building', paused: false, stageIndex: 0,
      stages: c.stages.map((stage, i) => ({ paidCents: i === 0 ? stage.costCents : 0, paymentId: i === 0 ? `capital:${command.id}` : null, startedWeek: i === 0 ? state.week : null, elapsedWeeks: 0, completedStaff: 0, completedWeek: null })),
      startedWeek: state.week, readyWeek: null, lastBottleneck: 'Site reservation is funded; elapsed time and infrastructure work are required.' };
    facts.push(capitalFact(command, state, id, c.stages[0].costCents, `${next.facilities[id].name}: ${c.stages[0].name}`));
    message = `${next.facilities[id].name} reserved. Later stages each require a separate payment after their predecessor completes.`;
  } else if (p.kind === 'fund_facility_stage') {
    const site = next.facilities[p.facilityId], stage = site.stages[site.stageIndex], definition = c.stages[site.stageIndex];
    stage.paidCents = definition.costCents; stage.paymentId = `capital:${command.id}`; stage.startedWeek = state.week;
    site.lastBottleneck = `${definition.name} is funded; waiting for elapsed time and infrastructure work.`;
    facts.push(capitalFact(command, state, site.id, definition.costCents, `${site.name}: ${definition.name}`));
    message = `${site.name}: ${definition.name} funded for ${formatMoney(definition.costCents)}.`;
  } else if (p.kind === 'set_facility_paused') {
    const site = next.facilities[p.facilityId]; site.paused = p.paused;
    site.lastBottleneck = p.paused ? 'Construction paused; paid work and elapsed progress are retained.' : 'Construction resumed.';
    message = `${site.name} construction ${p.paused ? 'paused' : 'resumed'}.`;
  }
  syncInfrastructureFleets(state, next, content);
  const fleet = next.fleets[command.companyId];
  fleet.occupiedMemoryMU = 0; fleet.lastReservedMemoryMU = 0; fleet.reservedCU = 0; fleet.lastGrants = []; fleet.lastBottleneck = '';
  return { updates: { compute: next }, facts, schedule, messages: [{ category: 'project', companyId: command.companyId, message }] };
}

export function infrastructureCommit(state: Readonly<GameState>, context: ModuleContext): DomainResult {
  const next = structuredClone(state.slices.compute), messages: NonNullable<DomainResult['messages']> = [];
  const due = state.scheduled.filter(item => item.kind === 'equipment_delivery' && item.dueWeek === context.week);
  for (const item of due) {
    const fleet = next.fleets[item.companyId];
    if (!fleet.deliveredEquipmentIds.includes(item.targetId)) {
      fleet.inventory[item.targetId] = { cu: item.quantityCU ?? 0, memoryMU: item.memoryMU ?? 0, arrivedWeek: context.week };
      fleet.deliveredEquipmentIds.push(item.targetId);
      const rack = next.racks[item.targetId];
      if (rack) { rack.status = 'inventory'; rack.lastBottleneck = 'Delivered; start installation to turn inventory into usable hardware.'; }
      messages.push({ category: 'delivery', companyId: item.companyId, message: `Equipment ${item.targetId} arrived in inventory. It needs installation before use.` });
    }
  }
  for (const rack of Object.values(next.racks)) {
    if (rack.status === 'installing' && rack.readyWeek !== null && rack.readyWeek <= context.week) {
      rack.status = 'installed'; rack.installedWeek = context.week; rack.lastBottleneck = '';
      messages.push({ category: 'delivery', companyId: rack.companyId, message: `${getRackHardware(state, rack, context.content).name} rack installation is complete. Site and operating-staff constraints now determine usable capacity.` });
    }
  }
  for (const site of Object.values(next.facilities)) {
    if (site.status === 'commissioning' && site.readyWeek !== null && site.readyWeek <= context.week) {
      site.status = 'active'; site.lastBottleneck = '';
      messages.push({ category: 'project', companyId: site.companyId, message: `${site.name} commissioned. Fixed site costs now begin; installed hardware is still required for compute.` });
    }
  }
  syncInfrastructureFleets(state, next, context.content);
  for (const fleet of Object.values(next.fleets)) {
    fleet.occupiedMemoryMU = 0; fleet.lastReservedMemoryMU = 0; fleet.reservedCU = 0; fleet.lastGrants = []; fleet.lastBottleneck = '';
  }
  return { updates: { compute: next }, fulfilledScheduleIds: due.map(item => item.id), messages };
}

export function infrastructureRequests(state: Readonly<GameState>, content: GameContent): WorkRequest[] {
  const requests: WorkRequest[] = [];
  const request = (id: string, companyId: string, taskId: string, staffWeeks: number, priority: number): WorkRequest => ({
    id, companyId, taskId, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, poolId: 'auto', priority,
    staffDemand: [{ role: 'infrastructure', staffWeeks }],
  });
  for (const companyId of Object.keys(state.slices.compute.fleets)) {
    const required = getInfrastructureOperatingStaff(state, companyId, content);
    if (required) requests.push(request(infrastructureOperationsId(companyId), companyId, 'infrastructure-operations', required, 0));
  }
  for (const rack of Object.values(state.slices.compute.racks)) {
    if (rack.status === 'installing' && rack.readyWeek === null) requests.push(request(rackWorkId(rack.id), rack.companyId, rack.id,
      Math.max(0, content.infrastructure.installationStaffWeeks - rack.completedInstallStaff), 10));
  }
  for (const site of Object.values(state.slices.compute.facilities)) {
    if (site.status !== 'building' || site.paused) continue;
    const stage = site.stages[site.stageIndex], definition = content.infrastructure.stages[site.stageIndex];
    if (stage.paidCents) requests.push(request(siteWorkId(site.id), site.companyId, site.id, Math.max(0, definition.staffWeeks - stage.completedStaff), 15));
  }
  return requests;
}

export function advanceInfrastructure(state: Readonly<GameState>, context: ModuleContext): ComputeSlice {
  const next = structuredClone(state.slices.compute), c = context.content.infrastructure;
  const staff = (id: string) => context.resources.staffGrants.find(grant => grant.requestId === id)?.grants.find(grant => grant.role === 'infrastructure')?.staffWeeks ?? 0;
  for (const rack of Object.values(next.racks)) {
    if (rack.status !== 'installing' || rack.readyWeek !== null) continue;
    const progress = Math.min(c.installationStaffWeeks - rack.completedInstallStaff, staff(rackWorkId(rack.id)));
    rack.completedInstallStaff = checkedAdd(rack.completedInstallStaff, progress);
    rack.lastBottleneck = progress ? '' : 'No infrastructure staff remain after operating coverage and earlier installations.';
  }
  for (const site of Object.values(next.facilities)) {
    if (site.status !== 'building' || site.paused) continue;
    const stage = site.stages[site.stageIndex], definition = c.stages[site.stageIndex];
    if (!stage.paidCents) { site.lastBottleneck = `Fund ${definition.name} to continue construction.`; continue; }
    stage.elapsedWeeks = Math.min(definition.elapsedWeeks, stage.elapsedWeeks + 1);
    stage.completedStaff = checkedAdd(stage.completedStaff, Math.min(definition.staffWeeks - stage.completedStaff, staff(siteWorkId(site.id))));
    site.lastBottleneck = stage.completedStaff < definition.staffWeeks ? 'Construction is waiting for infrastructure staff work.'
      : stage.elapsedWeeks < definition.elapsedWeeks ? 'Staff work is complete; the construction critical path still requires elapsed weeks.' : '';
  }
  return next;
}

export function resolveInfrastructure(state: Readonly<GameState>, context: ModuleContext): DomainResult {
  const next = structuredClone(state.slices.compute), c = context.content.infrastructure, messages: NonNullable<DomainResult['messages']> = [];
  for (const rack of Object.values(next.racks)) {
    if (rack.status === 'installing' && rack.readyWeek === null && rack.completedInstallStaff >= c.installationStaffWeeks) {
      rack.readyWeek = context.week + 1; rack.lastBottleneck = `Installation complete; hardware becomes installed at week ${rack.readyWeek}.`;
      messages.push({ category: 'project', companyId: rack.companyId, message: 'Rack installation work finished. The rack enters service at the next weekly boundary, subject to site commissioning and operating coverage.' });
    }
  }
  for (const site of Object.values(next.facilities)) {
    if (site.status !== 'building' || site.paused) continue;
    const stage = site.stages[site.stageIndex], definition = c.stages[site.stageIndex];
    if (stage.paidCents !== definition.costCents || stage.elapsedWeeks < definition.elapsedWeeks || stage.completedStaff < definition.staffWeeks) continue;
    stage.completedWeek = context.week; site.stageIndex++;
    if (site.stageIndex === c.stages.length) {
      site.status = 'commissioning'; site.readyWeek = context.week + 1; site.lastBottleneck = 'Acceptance complete; commissioning occurs at the next weekly boundary.';
    } else site.lastBottleneck = `Fund ${c.stages[site.stageIndex].name} to begin the next stage.`;
    messages.push({ category: 'project', companyId: site.companyId, message: `${site.name}: ${definition.name} complete. ${site.lastBottleneck}` });
  }
  return { updates: { compute: next }, messages };
}

/** Stable, presentation-ready infrastructure view; all price formulas stay in this module. */
export function getInfrastructureView(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT) {
  const c = content.infrastructure, pools = getComputePools(state, companyId, content);
  const racks = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === companyId).map(rack => {
    const hardware = getRackHardware(state, rack, content), rackCU = getRackCapacity(rack, content);
    return { ...rack, name: hardware.name, locationName: rack.location === 'colocation' ? 'Colocation' : state.slices.compute.facilities[rack.location]?.name ?? 'Unknown site',
      cu: rackCU, memoryMU: mulDiv(rackCU, hardware.memoryMUPerCU, RESOURCE_SCALE),
      installationProgressBps: mulDiv(rack.completedInstallStaff, 10_000, c.installationStaffWeeks),
      fixedCostCents: !installed(rack) ? 0 : rack.location === 'colocation' ? c.colocationCentsPerRackWeek : mulDiv(rackCU, c.ownedMaintenanceCentsPerCUWeek, RESOURCE_SCALE) };
  });
  const totalCost = c.stages.reduce((sum, stage) => sum + stage.costCents, 0);
  const facilities = Object.values(state.slices.compute.facilities).filter(site => site.companyId === companyId).map(site => {
    const definition = c.stages[site.stageIndex], paidCents = site.stages.reduce((sum, stage) => sum + stage.paidCents, 0);
    const siteRacks = racks.filter(rack => rack.location === site.id);
    const envelope = getSiteEnvelope(state, site.id, content);
    return { ...site, stageName: definition?.name ?? (site.status === 'active' ? 'Operational' : 'Commissioning'),
      stageCostCents: definition?.costCents ?? 0, stageWeeks: definition?.elapsedWeeks ?? 0, stageStaffWeeks: definition?.staffWeeks ?? 0,
      paidCents, remainingCostCents: totalCost - paidCents,
      elapsedWeeks: site.stages.reduce((sum, stage) => sum + stage.elapsedWeeks, 0), requiredWeeks: c.stages.reduce((sum, stage) => sum + stage.elapsedWeeks, 0),
      completedStaff: site.stages.reduce((sum, stage) => sum + stage.completedStaff, 0), requiredStaff: c.stages.reduce((sum, stage) => sum + stage.staffWeeks, 0),
      installedCU: siteRacks.filter(installed).reduce((sum, rack) => checkedAdd(sum, getRackCapacity(rack, content)), 0),
      activeCU: pools.filter(pool => pool.location === site.id).reduce((sum, pool) => sum + pool.capacityCU, 0),
      powerDemand: envelope.powerDemand, coolingDemand: envelope.coolingDemand, powerLimit: envelope.powerLimit, coolingLimit: envelope.coolingLimit,
      fixedCostCents: (site.status === 'active' ? c.siteFixedCentsPerWeek : 0) + siteRacks.reduce((sum, rack) => sum + rack.fixedCostCents, 0)
        + (hasFastFabric(state, companyId, site.id) ? CHIP_RULES.fabricFixedCentsPerWeek : 0)
        + getActiveFacilityRetrofitEffects(state, companyId, site.id).weeklyCents,
      canFund: site.status === 'building' && !site.stages[site.stageIndex].paidCents };
  });
  const operatingStaffRequired = getInfrastructureOperatingStaff(state, companyId, content);
  return { racks, facilities, pools, nominalOwnedCU: getInstalledOwnedCU(state, companyId, content),
    usableOwnedCU: pools.filter(pool => pool.ownership === 'owned').reduce((sum, pool) => sum + pool.capacityCU, 0),
    operatingStaffRequired, operatingStaffAvailable: Math.min(operatingStaffRequired, getWorkforce(state, companyId).capacity.infrastructure),
    weeklyFixedCents: getInfrastructureBaseCost(state, companyId, content),
    lastVariableCents: state.slices.company.ledger.filter(entry => entry.companyId === companyId && entry.week === state.week && entry.sourceId === 'owned-gpu-work').reduce((sum, entry) => sum + entry.amountCents, 0),
  };
}
