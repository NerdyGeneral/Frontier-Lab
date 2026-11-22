import type { CommandQuote, ComputeSlice, DomainResult, GameCommand, GameContent, GameState, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import type { RackRelocation } from '../contracts/wave8-relocation';
import { CONTENT } from '../content/catalog';
import { RACK_RELOCATION_RULES as RULES } from '../content/wave8-relocation';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { getRackCapacity, synchronizeFleetCapacity } from './compute-pools';
import { facilityRetrofitResearchReady } from './facility-retrofits';

export const RACK_RELOCATION_COMMANDS = ['start_rack_relocation', 'set_rack_relocation_paused'] as const;
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const workId = (id: string) => 'rack-relocation-work:' + id;
const own = <T>(records: Record<string, T>, id: string): T | undefined => Object.hasOwn(records, id) ? records[id] : undefined;

export function activeRackRelocation(state: Readonly<GameState>, rackId: string): RackRelocation | undefined {
  return Object.values(state.slices.compute.rackRelocations ?? {}).find(project => project.rackId === rackId && project.status !== 'complete');
}

/** Source footprint is retained until commissioning; destination is reserved at admission. */
export function inboundRackRelocations(state: Readonly<GameState>, companyId: string, location: string): number {
  return Object.values(state.slices.compute.rackRelocations ?? {}).filter(project => project.companyId === companyId
    && project.destination === location && project.status !== 'complete').length;
}

export function committedRackSlots(state: Readonly<GameState>, companyId: string, location: string, excludeCommandId?: string): number {
  let count = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === companyId && rack.location === location).length
    + inboundRackRelocations(state, companyId, location);
  for (const command of state.queuedCommands) {
    if (command.companyId !== companyId || command.id === excludeCommandId) continue;
    const p = command.payload;
    if (p.kind === 'order_rack' && p.location === location) count++;
    if (p.kind === 'order_chip_batch' && p.location === location) count += p.racks;
    if (p.kind === 'start_rack_relocation' && p.destination === location) count++;
  }
  return count;
}

export function validateRackRelocationCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload;
  if (p.kind === 'start_rack_relocation') {
    if (!facilityRetrofitResearchReady(state, command.companyId)) return reject('Research Enterprise operations (R12) before moving installed hardware.');
    const rack = own(state.slices.compute.racks, p.rackId);
    if (!rack || rack.companyId !== command.companyId || !['installed', 'parked'].includes(rack.status)) return reject('Choose one of your installed or parked racks.');
    if (activeRackRelocation(state, rack.id)) return reject('Finish this rack’s current relocation before starting another.', 'ALREADY_ACTIVE');
    if (state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId
      && ((other.payload.kind === 'start_rack_relocation' || other.payload.kind === 'set_rack_parked') && other.payload.rackId === rack.id))) return reject('This rack already has a queued movement or operating-state change.', 'ALREADY_ACTIVE');
    if (Object.values(state.slices.compute.rackRelocations ?? {}).filter(project => project.rackId === rack.id).length >= RULES.maximumMovesPerRack) return reject(`A rack can retain at most ${RULES.maximumMovesPerRack} paid relocations.`, 'CAPACITY_EXCEEDED');
    if (p.destination === rack.location) return reject('Choose a different destination.', 'NO_IMPROVEMENT');
    if (p.destination !== 'colocation') {
      const site = own(state.slices.compute.facilities, p.destination);
      if (!site || site.companyId !== command.companyId || site.status !== 'active') return reject('Choose colocation or one of your operational data centers.');
      if ((committedRackSlots(state, command.companyId, p.destination, command.id) + 1) * content.infrastructure.rackCU > content.infrastructure.siteSlotsCU) return reject('The destination has no uncommitted rack slot. Existing orders and other incoming relocations reserve their full footprint.', 'CAPACITY_EXCEEDED');
    }
    return;
  }
  if (p.kind === 'set_rack_relocation_paused') {
    const project = own(state.slices.compute.rackRelocations ?? {}, p.relocationId);
    if (!project || project.companyId !== command.companyId || project.status !== 'moving') return reject('Choose one of your ongoing rack relocations.');
    if (typeof p.paused !== 'boolean') return reject('Choose whether the relocation is paused.', 'INVALID_COMMAND');
    if (p.paused === project.paused) return reject(p.paused ? 'This relocation is already paused.' : 'This relocation is already running.', 'ALREADY_ACTIVE');
    return;
  }
  return reject('Choose a supported rack relocation command.', 'INVALID_COMMAND');
}

export function quoteRackRelocationCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const p = command.payload;
  if (p.kind === 'start_rack_relocation') {
    const rack = state.slices.compute.racks[p.rackId];
    const capacity = getRackCapacity(rack, content);
    const fixed = (location: string) => location === 'colocation' ? content.infrastructure.colocationCentsPerRackWeek
      : mulDiv(capacity, content.infrastructure.ownedMaintenanceCentsPerCUWeek, 1_000_000_000);
    return { upfrontCostCents: RULES.feeCents, weeklyCostDeltaCents: fixed(p.destination) - fixed(rack.location),
      summary: `${formatMoney(RULES.feeCents)} to move this rack: four elapsed weeks minimum and 20 Operations points. It supplies no compute or memory during the move. Source upkeep and staff coverage continue until arrival; source and destination slots stay reserved. Destination rack upkeep becomes ${formatMoney(fixed(p.destination))}/week. Fabric stays at its location. The rack returns ${rack.status === 'parked' ? 'parked' : 'active'} after commissioning.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: p.kind === 'set_rack_relocation_paused' && p.paused
      ? 'Pause elapsed and staff progress; retain the paid move, both slot reservations, and source upkeep.'
      : 'Resume the saved relocation. Previously completed transport and staff work are retained.' };
}

export function applyRackRelocationCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  const p = command.payload, compute = structuredClone(state.slices.compute);
  if (p.kind === 'set_rack_relocation_paused') {
    const project = compute.rackRelocations![p.relocationId]; project.paused = p.paused;
    project.lastBottleneck = p.paused ? 'Relocation paused; source upkeep and both slot reservations continue.' : 'Relocation resumed.';
    return { updates: { compute }, messages: [{ category: 'project', companyId: command.companyId, message: project.lastBottleneck }] };
  }
  if (p.kind !== 'start_rack_relocation') return {};
  const rack = compute.racks[p.rackId], id = 'rack-relocation:' + command.id;
  rack.purchaseLocation ??= rack.location;
  const project: RackRelocation = {
    id, companyId: command.companyId, rackId: rack.id, sourceLocation: rack.location, destination: p.destination,
    restoreStatus: rack.status as 'installed' | 'parked', status: 'moving', paused: false,
    startedWeek: state.week, readyWeek: null, completedWeek: null, stageIndex: 0,
    stages: RULES.stages.map((_, index) => ({ startedWeek: index === 0 ? state.week : null, elapsedWeeks: 0, completedStaff: 0, completedWeek: null })),
    paidCents: RULES.feeCents, paymentId: 'rack-relocation-capital:' + id,
    hardwareId: rack.hardwareId, usableCU: getRackCapacity(rack, content), purchaseCents: rack.purchaseCents,
    originalInstalledWeek: rack.installedWeek!, lastBottleneck: 'Waiting for disconnect and packing work; the rack is offline.',
  };
  compute.rackRelocations ??= {}; compute.rackRelocations[id] = project;
  rack.status = 'parked'; rack.lastBottleneck = 'Relocating; source upkeep continues and destination space is reserved.';
  const snapshot = { ...state, slices: { ...state.slices, compute } };
  Object.assign(compute.fleets[command.companyId], synchronizeFleetCapacity(snapshot, command.companyId, content));
  const fleet = compute.fleets[command.companyId];
  fleet.occupiedMemoryMU = 0; fleet.lastReservedMemoryMU = 0; fleet.reservedCU = 0; fleet.lastGrants = []; fleet.lastBottleneck = '';
  return { updates: { compute }, facts: [{ id: project.paymentId, companyId: command.companyId, week: state.week,
    sourceId: id, category: 'capital', amountCents: RULES.feeCents, label: 'Rack disconnect, transport and reinstallation', kind: 'expense' }],
  messages: [{ category: 'project', companyId: command.companyId, message: 'Rack relocation funded. The paid equipment is offline until its transport, staff work, and commissioning finish.' }] };
}

export function rackRelocationCommit(state: Readonly<GameState>, ctx: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of Object.values(compute.rackRelocations ?? {})) {
    if (project.status !== 'ready' || project.readyWeek! > ctx.week) continue;
    const rack = compute.racks[project.rackId];
    rack.location = project.destination; rack.status = project.restoreStatus;
    rack.lastBottleneck = rack.status === 'parked' ? 'Parked after relocation; destination upkeep applies.' : '';
    project.status = 'complete'; project.completedWeek = ctx.week; project.lastBottleneck = '';
    messages.push({ category: 'delivery', companyId: project.companyId, message: `Rack relocation commissioned. Original purchase, yield and installation evidence are preserved; ${project.restoreStatus === 'parked' ? 'the rack remains parked' : 'destination staff, power, cooling and fabric now determine usable capacity'}.` });
  }
  return messages;
}

export function rackRelocationRequests(state: Readonly<GameState>): WorkRequest[] {
  return Object.values(state.slices.compute.rackRelocations ?? {}).filter(project => project.status === 'moving' && !project.paused)
    .map(project => ({ id: workId(project.id), companyId: project.companyId, taskId: project.id,
      category: 'development' as const, normalizedWorkCUw: 0, memoryMU: 0, poolId: 'auto', priority: 13,
      staffDemand: [{ role: 'infrastructure' as const, staffWeeks: Math.max(0, RULES.stages[project.stageIndex].staffWeeks - project.stages[project.stageIndex].completedStaff) }],
    }));
}

export function advanceRackRelocations(state: Readonly<GameState>, ctx: ModuleContext, compute: ComputeSlice): void {
  for (const project of Object.values(compute.rackRelocations ?? {})) {
    if (project.status !== 'moving' || project.paused || state.slices.company.companies[project.companyId].arrearsCents > 0) continue;
    const stage = project.stages[project.stageIndex], definition = RULES.stages[project.stageIndex];
    if (stage.startedWeek === null) stage.startedWeek = ctx.week;
    stage.elapsedWeeks = Math.min(definition.elapsedWeeks, stage.elapsedWeeks + 1);
    const staff = ctx.resources.staffGrants.find(grant => grant.requestId === workId(project.id))?.grants.find(grant => grant.role === 'infrastructure')?.staffWeeks ?? 0;
    stage.completedStaff = Math.min(definition.staffWeeks, checkedAdd(stage.completedStaff, staff));
    project.lastBottleneck = stage.completedStaff < definition.staffWeeks && !staff
      ? `${definition.name} needs Operations points after live operating commitments.`
      : stage.elapsedWeeks < definition.elapsedWeeks ? `${definition.name}: elapsed time is still required.` : '';
  }
}

export function resolveRackRelocations(_state: Readonly<GameState>, ctx: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of Object.values(compute.rackRelocations ?? {})) {
    if (project.status !== 'moving' || project.paused) continue;
    const stage = project.stages[project.stageIndex], definition = RULES.stages[project.stageIndex];
    if (stage.elapsedWeeks !== definition.elapsedWeeks || stage.completedStaff !== definition.staffWeeks) continue;
    stage.completedWeek = ctx.week; project.stageIndex++;
    if (project.stageIndex === RULES.stages.length) {
      project.status = 'ready'; project.readyWeek = ctx.week + 1;
      project.lastBottleneck = 'Relocation work finished; destination operation starts next week.';
      messages.push({ category: 'project', companyId: project.companyId, message: 'Rack transport and reinstallation are complete. Commissioning is next week.' });
    } else project.lastBottleneck = `${RULES.stages[project.stageIndex].name} begins next week.`;
  }
  return messages;
}

export function getRackRelocationView(state: Readonly<GameState>, rackId: string, content: GameContent = CONTENT) {
  const rack = state.slices.compute.racks[rackId];
  const projects = Object.values(state.slices.compute.rackRelocations ?? {}).filter(project => project.rackId === rackId)
    .sort((a, b) => a.startedWeek - b.startedWeek || a.id.localeCompare(b.id));
  const active = projects.find(project => project.status !== 'complete') ?? null;
  const locationName = (id: string) => id === 'colocation' ? 'Colocation' : state.slices.compute.facilities[id]?.name ?? id;
  return { researched: (state.slices.research.completedByCompany[rack.companyId] ?? []).includes(RULES.research),
    active, projects, locationName,
    destinations: [{ id: 'colocation', name: 'Colocation' }, ...Object.values(state.slices.compute.facilities).filter(site => site.companyId === rack.companyId && site.status === 'active')
      .map(site => ({ id: site.id, name: `${site.name} · ${formatUnits(committedRackSlots(state, rack.companyId, site.id) * content.infrastructure.rackCU)} / ${formatUnits(content.infrastructure.siteSlotsCU)} CU of rack space committed` }))]
      .filter(location => location.id !== rack.location),
  };
}
