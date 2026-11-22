import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from '../core/model-customization-version';
import { STRATEGY_CONTENT_VERSION } from '../core/strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { formatWorkPoints, getStaffPointProfile } from './workforce-points';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { isCapabilitySuite } from './evaluation-classification';
import { CONTENT } from '../content/catalog';
import { committedRackSlots } from './rack-relocation';
import { CHIP_FOUNDRIES, SILICON_CONTENT_VERSION, chipProductionTerms, isChipFoundry } from '../content/silicon-market';
import { SYNTHETIC_CONTENT_VERSION } from '../content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { GEN2_SILICON_RULES } from '../content/wave28-silicon';
import { availableFoundrySlots, hardwareRevenueFactId } from './hardware-sales';
import { CHIP_RULES, chipDesignValues, chipPrototypeValues, chipSpecificationKey, chipSpecificationValues } from '../content/wave4-hardware';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { CommandQuote, ComputeSlice, DomainResult, GameCommand, GameContent, GameState, LedgerFact, ModuleContext, Rejection, StaffRole, WorkRequest } from '../contracts/types';
import type { ChipFoundry, ChipDesign, ChipForecast, ChipSpecification, ChipStageGrantProof, ChipSuccessor, ChipSuccessorImprovement, ChipWorkMeters, ServingHistoryWeek, Wave4HardwareFields } from '../contracts/wave4-hardware';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, checkedInteger, formatMoney, formatUnits, mulDiv } from '../core/math';
import { getCompatibleComputePools, getComputePools, getPoolMultiplierBps, hasFastFabric, usesCrossRackTraining } from './compute-pools';
import { paidPolicyCapabilityBaseline, policyModelFingerprint } from './policy-holdouts';
import { getActiveFacilityRetrofitEffects } from './facility-retrofits';
import { syncInfrastructureFleets } from './infrastructure';

export const CHIP_COMMANDS = ['start_chip_design', 'start_chip_successor', 'start_chip_prototype', 'set_chip_project_paused', 'order_chip_batch', 'install_fast_fabric', 'set_fabric_paused'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const completed = (state: Readonly<GameState>, companyId: string, id: string) => (state.slices.research.completedByCompany[companyId]
  ?? (companyId === state.playerCompanyId ? state.slices.research.completed : [])).includes(id);
const designWorkId = (id: string) => `chip-design:${id}`;
const prototypeWorkId = (id: string) => `chip-prototype:${id}`;
const fabricWorkId = (id: string) => `fabric-work:${id}`;
const matchesQueued = (state: Readonly<GameState>, command: GameCommand, predicate: (item: GameCommand) => boolean) => state.queuedCommands.some(item => item.companyId === command.companyId && item.id !== command.id && predicate(item));
const records = <T>(value: Record<string, T> | undefined): T[] => Object.values(value ?? {});

export function emptyWave4HardwareFields(): Wave4HardwareFields {
  return { chipDesigns: {}, chipBatches: {}, fabricProjects: {}, servingHistory: {} };
}

export function chipDesignId(companyId: string, spec: ChipSpecification): string {
  return 'chip-' + canonicalStateHash({ companyId, spec });
}

export function chipSuccessorId(companyId: string, parentDesignId: string, improvement: ChipSuccessorImprovement): string {
  return 'chip-gen2-' + canonicalStateHash({ companyId, parentDesignId, improvement });
}

/** Display name and current UI status do not alter the frozen engineering lineage. */
export function chipParentFingerprint(parent: ChipDesign): string {
  return canonicalStateHash({ id: parent.id, companyId: parent.companyId, spec: parent.spec, qualifiedYieldBps: parent.qualifiedYieldBps,
    prototype: parent.prototypeRun ? { modelId: parent.prototypeRun.modelId, reportId: parent.prototypeRun.reportId,
      modelArchitecture: parent.prototypeRun.modelArchitecture, modelFamily: parent.prototypeRun.modelFamily,
      modelMemoryMU: parent.prototypeRun.modelMemoryMU, readyWeek: parent.prototypeRun.readyWeek, paymentId: parent.prototypeRun.paymentId } : null });
}

export function hasShippedChipBuyerOrder(state: Readonly<GameState>, companyId = state.playerCompanyId, atWeek = state.week): boolean {
  return Object.values(state.slices.compute.hardwareSales ?? {}).some(sale => sale.companyId === companyId
    && sale.shippedWeek !== null && sale.shippedWeek <= atWeek && state.slices.company.postedFacts[hardwareRevenueFactId(sale.buyerId)] === true);
}

const successorMetadata = (parent: ChipDesign, improvement: ChipSuccessorImprovement): ChipSuccessor => ({
  generation: 2, parentDesignId: parent.id, parentFingerprint: chipParentFingerprint(parent), improvement,
});
const emptyChipGrantProof = (): ChipStageGrantProof => ({ firstWeek: null, grantWeeks: 0, physicalWorkCUw: 0, workReceipts: {},
  hardwareGrantWeeks: 0, mlGrantWeeks: 0, latest: null });
export function chipGrantReceiptKey(receipt: Pick<ChipStageGrantProof['workReceipts'][string],
  'poolId' | 'hardwareId' | 'ownership' | 'crossRack' | 'specializationId' | 'baseMultiplierBps' | 'multiplierBps'>): string {
  return canonicalStateHash({ poolId: receipt.poolId, hardwareId: receipt.hardwareId, ownership: receipt.ownership,
    crossRack: receipt.crossRack, specializationId: receipt.specializationId, baseMultiplierBps: receipt.baseMultiplierBps, multiplierBps: receipt.multiplierBps });
}
const prototypeReport = (state: Readonly<GameState>, design: ChipDesign, modelId: string, companyId: string) => {
  const model = state.slices.models.versions[modelId];
  return Object.values(state.slices.models.reports).find(item => item.modelId === modelId && item.companyId === companyId && item.heldOut
    && isCapabilitySuite(item.suiteId) && (!design.successor || model && paidPolicyCapabilityBaseline(state, model, item.id, state.week)));
};

/** Specification and campaign seed determine the result; renaming/retrying cannot reroll it. */
export function qualifiedChipYieldBps(state: Pick<GameState, 'seed'>, companyId: string, spec: ChipSpecification): number {
  const roll = Number.parseInt(canonicalStateHash({ seed: state.seed, companyId, spec, purpose: 'qualified-chip-yield' }), 16) % 2;
  const useful = spec.architecture === 'sparse' || spec.memory === 'wide' ? 6 + roll : 7 + roll;
  return useful * 1250;
}

export function getServingHistoryWeeks(state: Readonly<GameState>, companyId = state.playerCompanyId): number {
  return state.slices.compute.servingHistory?.[companyId]?.length ?? 0;
}

function ownDesign(state: Readonly<GameState>, companyId: string, id: string): ChipDesign | undefined {
  const design = state.slices.compute.chipDesigns?.[id];
  return design?.companyId === companyId ? design : undefined;
}

function locationReason(state: Readonly<GameState>, companyId: string, location: string): Rejection | undefined {
  return location === 'colocation' || state.slices.compute.facilities[location]?.companyId === companyId ? undefined
    : reject('NOT_READY', 'Choose colocation or one of your own data-center sites.');
}

function rackCommitments(state: Readonly<GameState>, command: GameCommand, location?: string): number {
  if (location) return committedRackSlots(state, command.companyId, location, command.id);
  let count = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === command.companyId && (!location || rack.location === location)).length;
  for (const item of state.queuedCommands) {
    if (item.id === command.id || item.companyId !== command.companyId) continue;
    const p = item.payload;
    if (p.kind === 'order_rack' && (!location || p.location === location)) count++;
    if (p.kind === 'order_chip_batch' && (!location || p.location === location)) count += p.racks;
  }
  return count;
}

export function validateChipCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload;
  if (p.kind === 'start_chip_successor') {
    if (![CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version)) return reject('INVALID_COMMAND', 'Second-generation silicon is unavailable in this content version.');
    if (Object.keys(p).sort().join() !== 'improvement,kind,name,parentDesignId' || !['memory', 'throughput'].includes(p.improvement)
      || typeof p.parentDesignId !== 'string' || !p.parentDesignId || p.parentDesignId.length > 160) return reject('INVALID_COMMAND', 'Choose an original chip design, then upgrade its memory or speed.');
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(p.name)) return reject('INVALID_NAME', 'Use a chip name between 1 and 48 characters.');
    if (!completed(state, command.companyId, GEN2_SILICON_RULES.requiredResearch)) return reject('NOT_READY', 'Complete S6 Second-generation silicon before funding a successor.');
    if (!hasShippedChipBuyerOrder(state, command.companyId)) return reject('NOT_READY', 'Deliver a chip order to a customer and receive payment before starting a Gen 2 design.');
    const parent = ownDesign(state, command.companyId, p.parentDesignId);
    if (!parent || parent.status !== 'validated' || parent.successor || parent.qualifiedYieldBps === null) return reject('NOT_READY', 'Choose one of your tested first-generation chips. Gen 2 chips cannot have another successor.');
    const successors = records(state.slices.compute.chipDesigns).filter(item => item.companyId === command.companyId && item.successor);
    const queued = state.queuedCommands.filter(item => item.id !== command.id && item.companyId === command.companyId && item.payload.kind === 'start_chip_successor');
    if (successors.some(item => item.successor!.parentDesignId === parent.id) || queued.some(item => item.payload.kind === 'start_chip_successor' && item.payload.parentDesignId === parent.id)) return reject('ALREADY_ACTIVE', 'This chip already has a successor project. Continue that project; each original design can have only one successor.');
    if (successors.length + queued.length >= GEN2_SILICON_RULES.maxSuccessorsPerCompany) return reject('CAPACITY_EXCEEDED', 'You have reached the limit of eight Gen 2 designs. First-generation designs have their own limit.');
    return;
  }
  if (p.kind === 'start_chip_design') {
    if (!completed(state, command.companyId, 'R16')) return reject('NOT_READY', 'Complete Chip feasibility before funding a custom design.');
    if (!p.spec || !['dense', 'sparse'].includes(p.spec.architecture) || !['inference', 'training'].includes(p.spec.target) || !['balanced', 'wide'].includes(p.spec.memory)) return reject('INVALID_COMMAND', 'Choose a supported architecture, workload, and memory configuration.');
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(p.name)) return reject('INVALID_NAME', 'Use a chip name between 1 and 48 characters.');
    if (p.spec.architecture === 'sparse' && !completed(state, command.companyId, 'R14')) return reject('NOT_READY', 'Research Sparse architecture before designing a compatible sparse chip.');
    const existing = records(state.slices.compute.chipDesigns).filter(item => item.companyId === command.companyId && !item.successor);
    if (existing.some(item => chipSpecificationKey(item.spec) === chipSpecificationKey(p.spec))
      || matchesQueued(state, command, item => item.payload.kind === 'start_chip_design' && chipSpecificationKey(item.payload.spec) === chipSpecificationKey(p.spec))) return reject('ALREADY_ACTIVE', 'You already have this chip design, or have queued it. Continue that project. Renaming it will not change its production yield.');
    const pending = state.queuedCommands.filter(item => item.companyId === command.companyId && item.id !== command.id && item.payload.kind === 'start_chip_design').length;
    if (existing.length + pending >= CHIP_RULES.maxDesignsPerCompany) return reject('CAPACITY_EXCEEDED', 'This company has a design for each supported chip specification.');
    return;
  }
  if (p.kind === 'start_chip_prototype' || p.kind === 'set_chip_project_paused' || p.kind === 'order_chip_batch') {
    const design = ownDesign(state, command.companyId, p.designId);
    if (!design) return reject('NOT_READY', 'Choose one of your own custom chip designs.');
    if (p.kind === 'set_chip_project_paused') {
      if (!['designing', 'prototyping'].includes(design.status)) return reject('NO_IMPROVEMENT', 'This design is waiting for its next action or is already qualified.');
      if ((design.status === 'designing' ? design.design : design.prototypeRun!)?.readyWeek !== null) return reject('NO_IMPROVEMENT', 'This stage is finished. Its result becomes available at the start of next week.');
      if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether this chip project is paused.');
      if (design.paused === p.paused) return reject('ALREADY_ACTIVE', p.paused ? 'The project is already paused.' : 'The project is already running.');
      return;
    }
    if (p.kind === 'start_chip_prototype') {
      if (design.status !== 'design-ready' || design.prototypeRun) return reject('NOT_READY', 'Finish the design, then wait until it becomes available the following week before testing a prototype.');
      if (matchesQueued(state, command, item => item.payload.kind === 'start_chip_prototype' && item.payload.designId === p.designId)) return reject('ALREADY_ACTIVE', 'A prototype is already queued for this specification.');
      const model = state.slices.models.versions[p.modelId];
      const report = prototypeReport(state, design, p.modelId, command.companyId);
      if (!model || model.companyId !== command.companyId || !report) return reject('NOT_READY', design.successor
        ? 'Run a paid capability test for the compatible model and runtime you want to use for this prototype first.' : 'Choose one of your tested models with a completed capability report for this prototype.');
      if (model.architecture !== design.spec.architecture) return reject('NOT_READY', 'The prototype model architecture must match the chip specification.');
      return;
    }
    if (design.status !== 'validated' || design.qualifiedYieldBps === null) return reject('NOT_READY', 'Validate a compatible prototype before ordering production.');
    if (![1, 2, 4].includes(p.racks)) return reject('INVALID_COMMAND', 'Order a batch of one, two, or four rack slots.');
    if (Object.hasOwn(p, 'foundry')) {
      if (![SILICON_CONTENT_VERSION, SYNTHETIC_CONTENT_VERSION, STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version) || !isChipFoundry(p.foundry)) return reject('INVALID_COMMAND', 'Choose a supported production foundry.');
      const available = availableFoundrySlots(state, p.foundry, command.id);
      if (available !== null && available < p.racks) return reject('CAPACITY_EXCEEDED', 'The foundry has too many other orders to fit this batch.');
    }
    const location = locationReason(state, command.companyId, p.location); if (location) return location;
    if (rackCommitments(state, command) + p.racks > content.infrastructure.maxRacksPerCompany) return reject('CAPACITY_EXCEEDED', 'This batch would exceed the company rack limit, including incoming orders.');
    if (p.location !== 'colocation' && (rackCommitments(state, command, p.location) + p.racks) * content.infrastructure.rackCU > content.infrastructure.siteSlotsCU) return reject('CAPACITY_EXCEEDED', 'This data center’s rack space is full or reserved for incoming orders. Lower chip yield reduces usable compute, but each rack still needs the same space.');
    const batches = records(state.slices.compute.chipBatches).filter(item => item.companyId === command.companyId).length;
    const queued = state.queuedCommands.filter(item => item.companyId === command.companyId && item.id !== command.id && item.payload.kind === 'order_chip_batch').length;
    if (batches + queued >= CHIP_RULES.maxBatchesPerCompany) return reject('CAPACITY_EXCEEDED', 'This company has reached its production-order limit.');
    return;
  }
  if (p.kind === 'install_fast_fabric') {
    if (!completed(state, command.companyId, 'R14')) return reject('NOT_READY', 'Research Sparse architecture before installing fast fabric.');
    const location = locationReason(state, command.companyId, p.location); if (location) return location;
    if (records(state.slices.compute.fabricProjects).some(item => item.companyId === command.companyId && item.location === p.location)
      || matchesQueued(state, command, item => item.payload.kind === 'install_fast_fabric' && item.payload.location === p.location)) return reject('ALREADY_ACTIVE', 'This location already has installed fabric or an installation project.');
    return;
  }
  if (p.kind === 'set_fabric_paused') {
    const project = state.slices.compute.fabricProjects?.[p.fabricId];
    if (!project || project.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your fabric installations.');
    if (project.status !== 'installing') return reject('NO_IMPROVEMENT', 'Fabric installation is complete.');
    if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether fabric installation is paused.');
    if (project.paused === p.paused) return reject('ALREADY_ACTIVE', p.paused ? 'Fabric installation is already paused.' : 'Fabric installation is already running.');
    return;
  }
  return reject('INVALID_COMMAND', 'This is not a chip or fabric command.');
}

export function quoteChipCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): CommandQuote {
  const p = command.payload;
  if (p.kind === 'start_chip_successor') {
    const parent = state.slices.compute.chipDesigns[p.parentDesignId], values = chipDesignValues({ spec: parent.spec, successor: successorMetadata(parent, p.improvement) });
    return { upfrontCostCents: values.designFeeCents, weeklyCostDeltaCents: 0,
      summary: `Fund ${p.name.trim()} for ${formatMoney(values.designFeeCents)}: ${formatWorkPoints(values.designHardwareStaff)} Hardware points and ${formatUnits(values.designWorkCUw)} research CUw. Build on ${parent.name} with ${p.improvement === 'memory' ? '+1 MU per useful CU' : '+10% speed on supported jobs'}. Starting locks in this upgrade. Pay for a new prototype before production. Production costs 10% more; rack space, yield, and delivery time stay the same.` };
  }
  if (p.kind === 'start_chip_design') {
    const v = chipSpecificationValues(p.spec);
    return { upfrontCostCents: v.designFeeCents, weeklyCostDeltaCents: 0,
      summary: `Fund ${p.name.trim()} for ${formatMoney(v.designFeeCents)}. Design needs ${formatWorkPoints(v.designHardwareStaff)} Hardware points and ${formatUnits(v.designWorkCUw)} research CUw. Prototype testing, production, and installation each cost extra.` };
  }
  if (p.kind === 'start_chip_prototype') {
    const design = state.slices.compute.chipDesigns[p.designId], values = chipPrototypeValues(design);
    return { upfrontCostCents: values.feeCents, weeklyCostDeltaCents: 0,
      summary: design.successor ? `Test this Gen 2 ${design.successor.improvement} upgrade with a new prototype: ${formatMoney(values.feeCents)}, ${formatWorkPoints(values.hardwareStaff)} Hardware points and ${formatWorkPoints(values.mlStaff)} Design points, and ${formatUnits(values.workCUw)} development CUw. The original prototype’s work does not count toward it. The new design keeps the original yield. Order and install racks separately.`
        : `Test your chosen model and compiler setup for ${formatMoney(CHIP_RULES.prototypeFeeCents)}: 40 Hardware points, 20 Design points, and 4 development CUw. Completing the test qualifies the design for production and reveals its yield. Order and install racks separately.` };
  }
  if (p.kind === 'order_chip_batch') {
    const design = state.slices.compute.chipDesigns[p.designId];
    const terms = chipProductionTerms(design, p.racks, content.infrastructure.rackCU, p.foundry);
    return { upfrontCostCents: terms.costCents, weeklyCostDeltaCents: 0,
      summary: `Produce ${p.racks} rack${p.racks === 1 ? '' : 's'} occupying ${formatUnits(terms.attemptedCU)} slots and yielding ${formatUnits(terms.usableCU)} useful CU. ${CHIP_FOUNDRIES[p.foundry ?? 'standard'].name} takes ${terms.leadWeeks} weeks. After delivery, each rack needs ${formatWorkPoints(content.infrastructure.installationStaffWeeks)} Operations points to install. Running it needs staff and compatible jobs.` };
  }
  if (p.kind === 'install_fast_fabric') return { upfrontCostCents: CHIP_RULES.fabricCostCents, weeklyCostDeltaCents: 0,
    summary: `Install fast fabric at this location for ${formatMoney(CHIP_RULES.fabricCostCents)}: at least 3 weeks, 40 Operations points, and 4 development CUw. It starts working the week after installation finishes, then needs ${formatMoney(CHIP_RULES.fabricFixedCentsPerWeek)}/week and 1 Operations point per week. Model and hardware memory requirements still apply.` };
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.kind === 'set_chip_project_paused'
    ? `${p.paused ? 'Pause' : 'Resume'} this design stage next week. Completed work is kept; fees already paid are not refunded.`
    : `${p.kind === 'set_fabric_paused' && p.paused ? 'Pause' : 'Resume'} fabric installation next week. Completed work is kept; fees already paid are not refunded.` };
}

function meter(startedWeek: number, requiredWorkCUw: number, requiredHardwareStaff: number, requiredMlStaff = 0): ChipWorkMeters {
  return { startedWeek, requiredWorkCUw, completedWorkCUw: 0, requiredHardwareStaff, completedHardwareStaff: 0,
    requiredMlStaff, completedMlStaff: 0, completedWeek: null, readyWeek: null, lastProgress: 0,
    lastBottleneck: 'Waiting for team output and the relevant compute allocation.' };
}

function fact(state: Readonly<GameState>, command: GameCommand, id: string, sourceId: string, amountCents: number, label: string, category: LedgerFact['category'] = 'capital'): LedgerFact {
  return { id, companyId: command.companyId, week: state.week, sourceId, amountCents, label, category, kind: 'expense' };
}

export function applyChipCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): DomainResult {
  const compute = structuredClone(state.slices.compute), p = command.payload;
  const facts: LedgerFact[] = [], schedule: NonNullable<DomainResult['schedule']> = [];
  let message = '';
  if (p.kind === 'start_chip_design') {
    const id = chipDesignId(command.companyId, p.spec), v = chipSpecificationValues(p.spec), payment = `chip-design-fee:${id}`;
    compute.chipDesigns[id] = { id, companyId: command.companyId, name: p.name.trim(), spec: structuredClone(p.spec),
      status: 'designing', paused: false, designFeeCents: v.designFeeCents, designPaymentId: payment,
      design: meter(state.week, v.designWorkCUw, v.designHardwareStaff), prototypeRun: null, qualifiedYieldBps: null };
    facts.push(fact(state, command, payment, id, v.designFeeCents, `${p.name.trim()}: nonrecurring chip design`, 'operating'));
    message = `${p.name.trim()} design funded. The specification is frozen; staff work, simulation, and prototype qualification are still required.`;
  } else if (p.kind === 'start_chip_successor') {
    const parent = compute.chipDesigns[p.parentDesignId], successor = successorMetadata(parent, p.improvement);
    const id = chipSuccessorId(command.companyId, parent.id, p.improvement), values = chipDesignValues({ spec: parent.spec, successor }), payment = `chip-design-fee:${id}`;
    compute.chipDesigns[id] = { id, companyId: command.companyId, name: p.name.trim(), spec: structuredClone(parent.spec), successor,
      status: 'designing', paused: false, designFeeCents: values.designFeeCents, designPaymentId: payment,
      design: { ...meter(state.week, values.designWorkCUw, values.designHardwareStaff), grantProof: emptyChipGrantProof() }, prototypeRun: null, qualifiedYieldBps: null };
    facts.push(fact(state, command, payment, id, values.designFeeCents, `${p.name.trim()}: second-generation chip redesign`, 'operating'));
    message = `${p.name.trim()} Gen2 redesign funded. The original parent, specification and ${p.improvement} target are frozen. Complete its own work and new paid prototype before fabrication.`;
  } else if (p.kind === 'start_chip_prototype') {
    const design = compute.chipDesigns[p.designId], model = state.slices.models.versions[p.modelId];
    const report = prototypeReport(state, design, model.id, command.companyId)!, values = chipPrototypeValues(design);
    const payment = `chip-prototype-fee:${design.id}`;
    design.prototypeRun = { ...meter(state.week, values.workCUw, values.hardwareStaff, values.mlStaff),
      ...(design.successor ? { grantProof: emptyChipGrantProof(), modelFingerprint: policyModelFingerprint(model) } : {}),
      modelId: model.id, reportId: report.id, modelArchitecture: model.architecture, modelFamily: model.family,
      modelMemoryMU: model.residentMU, feeCents: values.feeCents, paymentId: payment };
    design.status = 'prototyping'; design.paused = false;
    facts.push(fact(state, command, payment, design.id, values.feeCents, `${design.name}: prototype validation`, 'operating'));
    message = `${design.name} prototype validation started using ${model.name}. All validation meters must finish before production can be ordered.`;
  } else if (p.kind === 'set_chip_project_paused') {
    const design = compute.chipDesigns[p.designId]; design.paused = p.paused;
    const active = design.status === 'designing' ? design.design : design.prototypeRun!;
    active.lastBottleneck = p.paused ? 'Paused; fees and completed work are retained.' : 'Waiting for the next resource grant.';
    message = `${design.name} ${p.paused ? 'paused' : 'resumed'}.`;
  } else if (p.kind === 'order_chip_batch') {
    const design = compute.chipDesigns[p.designId], v = chipDesignValues(design);
    const terms = chipProductionTerms(design, p.racks, content.infrastructure.rackCU, p.foundry);
    const id = `chip-batch-${command.id}`, payment = `chip-production:${id}`, rackCU = terms.usableCU / p.racks;
    const purchaseCents = terms.costCents, arrivalWeek = state.week + terms.leadWeeks, rackIds: string[] = [];
    for (let index = 0; index < p.racks; index++) {
      const rackId = `rack-${command.id}-${index + 1}`; rackIds.push(rackId);
      compute.racks[rackId] = { id: rackId, companyId: command.companyId, hardwareId: design.id, location: p.location, status: 'ordered',
        orderedWeek: state.week, arrivalWeek, installationStartedWeek: null, completedInstallStaff: 0, readyWeek: null, installedWeek: null,
        purchaseCents: purchaseCents / p.racks, lastBottleneck: 'Custom production is pending; uninstalled hardware supplies no capacity.',
        chipDesignId: design.id, chipBatchId: id, usableCU: rackCU };
      schedule.push({ id: `chip-delivery:${command.id}:${index + 1}`, companyId: command.companyId, dueWeek: arrivalWeek,
        kind: 'equipment_delivery', targetId: rackId, quantityCU: rackCU, memoryMU: mulDiv(rackCU, v.memoryMUPerCU, U) });
    }
    compute.chipBatches[id] = { id, companyId: command.companyId, designId: design.id, location: p.location, racks: p.racks, rackIds,
      attemptedCU: terms.attemptedCU, usableCU: terms.usableCU, yieldBps: terms.yieldBps, ...(p.foundry ? { foundry: p.foundry } : {}),
      orderedWeek: state.week, arrivalWeek, deliveredWeek: null, status: 'fabricating', purchaseCents, paymentId: payment };
    facts.push(fact(state, command, payment, id, purchaseCents, `${design.name}: ${p.racks}-rack production batch`));
    message = `${design.name}: production paid for ${p.racks} racks. ${formatUnits(p.racks * rackCU)} useful CU arrive in week ${arrivalWeek}, then need installation and operations.`;
  } else if (p.kind === 'install_fast_fabric') {
    const id = `fabric-${command.id}`, payment = `fast-fabric:${id}`;
    compute.fabricProjects[id] = { id, companyId: command.companyId, location: p.location, status: 'installing', paused: false,
      startedWeek: state.week, requiredWeeks: CHIP_RULES.fabricElapsedWeeks, elapsedWeeks: 0, requiredStaff: CHIP_RULES.fabricStaff, completedStaff: 0,
      requiredWorkCUw: CHIP_RULES.fabricWorkCUw, completedWorkCUw: 0, completedWeek: null, readyWeek: null,
      purchaseCents: CHIP_RULES.fabricCostCents, paymentId: payment, lastBottleneck: 'Waiting for installation work and elapsed lead time.' };
    facts.push(fact(state, command, payment, id, CHIP_RULES.fabricCostCents, 'Fast fabric installation'));
    message = 'Fast fabric funded. It serves only the selected physical location after installation, validation, and the next availability boundary.';
  } else if (p.kind === 'set_fabric_paused') {
    const fabric = compute.fabricProjects[p.fabricId]; fabric.paused = p.paused;
    fabric.lastBottleneck = p.paused ? 'Installation paused; elapsed time and work are retained.' : 'Waiting for installation work and elapsed lead time.';
    message = `Fast fabric installation ${p.paused ? 'paused' : 'resumed'}.`;
  }
  syncInfrastructureFleets(state, compute, content);
  const fleet = compute.fleets[command.companyId];
  fleet.occupiedMemoryMU = 0; fleet.lastReservedMemoryMU = 0; fleet.reservedCU = 0; fleet.lastGrants = []; fleet.lastBottleneck = '';
  return { updates: { compute }, facts, schedule, messages: [{ companyId: command.companyId, category: 'project', message }] };
}

export function chipCommit(state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const design of records(compute.chipDesigns)) {
    if (design.status === 'designing' && design.design.readyWeek !== null && design.design.readyWeek <= context.week) {
      design.status = 'design-ready'; design.paused = false;
      messages.push({ companyId: design.companyId, category: 'project', message: `${design.name}: specification is ready. Fund a prototype with an evaluated compatible model.` });
    } else if (design.status === 'prototyping' && design.prototypeRun?.readyWeek !== null && design.prototypeRun!.readyWeek! <= context.week) {
      design.status = 'validated'; design.paused = false;
      design.qualifiedYieldBps = qualifiedChipYieldBps(state, design.companyId, design.spec);
      messages.push({ companyId: design.companyId, category: 'project', message: `${design.name}: prototype qualified for ${design.spec.architecture} ${design.spec.target}. Production yield is ${design.qualifiedYieldBps / 100}%; choose a paid batch and location.` });
    }
  }
  for (const batch of records(compute.chipBatches)) {
    if (batch.status === 'fabricating' && batch.arrivalWeek <= context.week && batch.rackIds.every(id => compute.fleets[batch.companyId].deliveredEquipmentIds.includes(id))) {
      batch.status = 'delivered'; batch.deliveredWeek = context.week;
    }
  }
  for (const fabric of records(compute.fabricProjects)) {
    if (fabric.status === 'ready' && fabric.readyWeek !== null && fabric.readyWeek <= context.week) {
      fabric.status = 'active'; fabric.lastBottleneck = '';
      messages.push({ companyId: fabric.companyId, category: 'project', message: 'Fast fabric is active at its selected location. Compatible sparse jobs may now use connected hardware there; fabric upkeep and operations staff begin.' });
    }
  }
  return messages;
}

export function chipRequests(state: Readonly<GameState>): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const design of records(state.slices.compute.chipDesigns)) {
    if (design.paused || !['designing', 'prototyping'].includes(design.status)) continue;
    const designStage = design.status === 'designing', active = designStage ? design.design : design.prototypeRun!;
    if (active.readyWeek !== null) continue;
    const work = active.requiredWorkCUw - active.completedWorkCUw;
    requests.push({ id: designStage ? designWorkId(design.id) : prototypeWorkId(design.id), companyId: design.companyId,
      taskId: design.id, category: designStage ? 'research' : 'development', normalizedWorkCUw: work,
      memoryMU: !designStage && work ? design.prototypeRun!.modelMemoryMU : 0, priority: 45, poolId: 'auto',
      staffDemand: [{ role: 'hardware', staffWeeks: active.requiredHardwareStaff - active.completedHardwareStaff },
        ...(active.requiredMlStaff ? [{ role: 'ml' as const, staffWeeks: active.requiredMlStaff - active.completedMlStaff }] : [])],
      workloadKind: designStage ? 'general' : design.spec.target,
      ...(!designStage ? { modelArchitecture: design.prototypeRun!.modelArchitecture, modelFamily: design.prototypeRun!.modelFamily,
        requiresFastFabric: design.spec.architecture === 'sparse' } : {}) });
  }
  for (const fabric of records(state.slices.compute.fabricProjects)) {
    if (fabric.status !== 'installing' || fabric.paused) continue;
    requests.push({ id: fabricWorkId(fabric.id), companyId: fabric.companyId, taskId: fabric.id, category: 'development',
      normalizedWorkCUw: fabric.requiredWorkCUw - fabric.completedWorkCUw, memoryMU: 0, priority: 12, poolId: 'auto', workloadKind: 'general',
      staffDemand: [{ role: 'infrastructure', staffWeeks: fabric.requiredStaff - fabric.completedStaff }] });
  }
  return requests;
}

export function advanceChips(state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): void {
  const work = (id: string) => context.resources.computeGrants.find(grant => grant.requestId === id)?.hardwareEffectiveCUw ?? 0;
  const staff = (id: string, role: StaffRole) => context.resources.staffGrants.find(grant => grant.requestId === id)?.grants.find(grant => grant.role === role)?.staffWeeks ?? 0;
  for (const design of records(compute.chipDesigns)) {
    if (design.paused || !['designing', 'prototyping'].includes(design.status)) continue;
    const isDesign = design.status === 'designing', active = isDesign ? design.design : design.prototypeRun!;
    if (active.readyWeek !== null) continue;
    const id = isDesign ? designWorkId(design.id) : prototypeWorkId(design.id), grantedWork = work(id);
    if (design.successor) {
      const hardwareStaff = staff(id, 'hardware'), mlStaff = staff(id, 'ml'), proof = active.grantProof!;
      const grant = context.resources.computeGrants.find(item => item.requestId === id);
      if (grantedWork || hardwareStaff || mlStaff) {
        let receiptKey: string | null = null;
        if (grantedWork) {
          const category = isDesign ? 'research' : 'development', workloadKind = isDesign ? 'general' : design.spec.target;
          const pool = getComputePools(state, design.companyId, context.content, context.resources.staffGrants).find(item => item.id === grant?.poolId);
          if (!pool || !grant?.physicalCUw) throw new Error('Gen2 work lost its actual connected compute grant.');
          const crossRack = usesCrossRackTraining(pool, category, grant.physicalCUw, grant.memoryMU);
          const baseMultiplierBps = getPoolMultiplierBps(pool, category, crossRack, context.content, workloadKind === 'training' ? 'general' : workloadKind);
          const multiplierBps = getPoolMultiplierBps(pool, category, crossRack, context.content, workloadKind);
          const identity = { poolId: pool.id, hardwareId: pool.hardwareId, ownership: pool.ownership, crossRack,
            specializationId: pool.specialization?.id ?? null, baseMultiplierBps, multiplierBps };
          receiptKey = chipGrantReceiptKey(identity);
          const receipt = proof.workReceipts[receiptKey] ??= { ...identity, effectiveCUw: 0, physicalCUw: 0, conversionRemainder: 0,
            grants: 0, firstWeek: context.week, lastWeek: context.week };
          receipt.effectiveCUw = checkedAdd(receipt.effectiveCUw, grantedWork);
          receipt.physicalCUw = checkedAdd(receipt.physicalCUw, grant.physicalCUw);
          receipt.conversionRemainder = checkedAdd(receipt.conversionRemainder,
            checkedInteger(Number(BigInt(grant.physicalCUw) * BigInt(multiplierBps) - BigInt(grantedWork) * BigInt(10000))));
          receipt.grants++; receipt.lastWeek = context.week;
          proof.physicalWorkCUw = checkedAdd(proof.physicalWorkCUw, grant.physicalCUw);
        }
        proof.firstWeek ??= context.week; proof.grantWeeks++;
        if (hardwareStaff) proof.hardwareGrantWeeks++;
        if (mlStaff) proof.mlGrantWeeks++;
        proof.latest = { week: context.week, remainingWorkCUw: active.requiredWorkCUw - active.completedWorkCUw,
          remainingHardwareStaff: active.requiredHardwareStaff - active.completedHardwareStaff,
          remainingMlStaff: active.requiredMlStaff - active.completedMlStaff, hardwareStaff, mlStaff, effectiveCUw: grantedWork,
          physicalCUw: grant?.physicalCUw ?? 0, memoryMU: grant?.memoryMU ?? 0, poolId: grantedWork ? grant!.poolId : null, receiptKey };
      }
    }
    active.completedWorkCUw = checkedAdd(active.completedWorkCUw, grantedWork);
    active.completedHardwareStaff = checkedAdd(active.completedHardwareStaff, staff(id, 'hardware'));
    active.completedMlStaff = checkedAdd(active.completedMlStaff, staff(id, 'ml')); active.lastProgress = grantedWork;
    const reasons: string[] = [];
    if (active.completedHardwareStaff < active.requiredHardwareStaff && !staff(id, 'hardware')) reasons.push('A ready hardware specialist supplies Hardware points.');
    if (active.completedMlStaff < active.requiredMlStaff && !staff(id, 'ml')) reasons.push('Prototype validation needs Design points.');
    if (active.completedWorkCUw < active.requiredWorkCUw && !grantedWork) reasons.push(compute.fleets[design.companyId].lastGrants.find(grant => grant.requestId === id)?.reason || `Allocate ${isDesign ? 'research' : 'development'} compute.`);
    active.lastBottleneck = reasons.join(' ');
  }
  for (const fabric of records(compute.fabricProjects)) {
    if (fabric.status !== 'installing' || fabric.paused) continue;
    const id = fabricWorkId(fabric.id);
    fabric.elapsedWeeks = Math.min(fabric.requiredWeeks, fabric.elapsedWeeks + 1);
    fabric.completedWorkCUw = checkedAdd(fabric.completedWorkCUw, work(id));
    fabric.completedStaff = checkedAdd(fabric.completedStaff, staff(id, 'infrastructure'));
    fabric.lastBottleneck = fabric.completedStaff < fabric.requiredStaff && !staff(id, 'infrastructure') ? 'Fabric installation uses Operations points after operating coverage.'
      : fabric.completedWorkCUw < fabric.requiredWorkCUw && !work(id) ? 'Allocate development compute for network validation.'
        : fabric.elapsedWeeks < fabric.requiredWeeks ? 'Work is progressing; the network lead time must also finish.' : '';
  }
}

export function resolveChips(_state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const design of records(compute.chipDesigns)) {
    if (design.paused || !['designing', 'prototyping'].includes(design.status)) continue;
    const active = design.status === 'designing' ? design.design : design.prototypeRun!;
    if (active.readyWeek !== null || active.completedWorkCUw < active.requiredWorkCUw || active.completedHardwareStaff < active.requiredHardwareStaff || active.completedMlStaff < active.requiredMlStaff) continue;
    active.completedWeek = context.week; active.readyWeek = context.week + 1;
    active.lastBottleneck = `Stage complete; the result becomes available in week ${active.readyWeek}.`;
    messages.push({ companyId: design.companyId, category: 'project', message: `${design.name}: ${design.status === 'designing' ? 'specification' : 'prototype'} meters complete. Availability begins at the next weekly boundary.` });
  }
  for (const fabric of records(compute.fabricProjects)) {
    if (fabric.status !== 'installing' || fabric.paused || fabric.completedStaff < fabric.requiredStaff || fabric.completedWorkCUw < fabric.requiredWorkCUw || fabric.elapsedWeeks < fabric.requiredWeeks) continue;
    fabric.status = 'ready'; fabric.completedWeek = context.week; fabric.readyWeek = context.week + 1;
    fabric.lastBottleneck = `Installation complete; fast fabric activates in week ${fabric.readyWeek}.`;
    messages.push({ companyId: fabric.companyId, category: 'project', message: fabric.lastBottleneck });
  }
  return messages;
}

/** Customer work only. Internal research assistance and idle capacity do not establish a serving record. */
export function recordCustomerServing(state: Readonly<GameState>, context: ModuleContext): DomainResult {
  const compute = structuredClone(state.slices.compute), requests = new Map(context.resources.requests.map(request => [request.id, request]));
  const observations = new Map<string, ServingHistoryWeek>();
  for (const grant of context.resources.computeGrants) {
    const request = requests.get(grant.requestId);
    if (!request || request.category !== 'serving' || !grant.physicalCUw) continue;
    const observation = observations.get(request.companyId) ?? { week: context.week, publicPhysicalCUw: 0, privatePhysicalCUw: 0, agentPhysicalCUw: 0 };
    const offer = state.slices.products.offers[request.taskId], contract = state.slices.products.commercialContracts?.[request.taskId], agent = state.slices.agents.jobs?.[request.taskId];
    if (offer?.companyId === request.companyId && request.id === `serve:${offer.id}`) observation.publicPhysicalCUw = checkedAdd(observation.publicPhysicalCUw, grant.physicalCUw);
    else if (contract?.companyId === request.companyId && contract.contractKind === 'private-hosted' && request.id === `business-serve:${contract.id}`) observation.privatePhysicalCUw = checkedAdd(observation.privatePhysicalCUw, grant.physicalCUw);
    else if (state.slices.products.batchJobs?.[request.taskId]?.companyId === request.companyId && request.id === `batch-serve:${request.taskId}`) observation.privatePhysicalCUw = checkedAdd(observation.privatePhysicalCUw, grant.physicalCUw);
    else if (state.slices.products.assuranceContracts?.[request.taskId]?.companyId === request.companyId && request.id === `assurance-serve:${request.taskId}`) observation.privatePhysicalCUw = checkedAdd(observation.privatePhysicalCUw, grant.physicalCUw);
    else if (agent?.companyId === request.companyId && request.id === `${agent.id}:work`) observation.agentPhysicalCUw = checkedAdd(observation.agentPhysicalCUw, grant.physicalCUw);
    else continue;
    observations.set(request.companyId, observation);
  }
  for (const [companyId, observation] of observations) {
    const previous = compute.servingHistory[companyId] ?? [];
    compute.servingHistory[companyId] = [...previous.filter(item => item.week !== context.week), observation].sort((a, b) => a.week - b.week).slice(-CHIP_RULES.servingHistoryWeeks);
  }
  return observations.size ? { updates: { compute } } : {};
}

/** Simple, explicit comparison against an equivalent reserved general-cloud workload. */
export function chipPaybackForecast(state: Readonly<GameState>, design: ChipDesign, racks: 1 | 2 | 4 = 1,
  location = 'colocation', utilizationBps = 7500, content: GameContent = CONTENT, foundry: ChipFoundry = 'standard'): ChipForecast {
  const u = Math.max(0, Math.min(10_000, Math.floor(utilizationBps))), v = chipDesignValues(design), prototype = chipPrototypeValues(design), c = content.infrastructure;
  const production = chipProductionTerms({ ...design, qualifiedYieldBps: design.qualifiedYieldBps ?? 7500 }, racks, c.rackCU, foundry);
  const { yieldBps, usableCU: usefulCU } = production;
  const physical = mulDiv(usefulCU, u, 10_000);
  const multiplier = design.spec.target === 'inference' ? v.servingBps : v.trainingBps;
  const effective = mulDiv(physical, multiplier, 10_000);
  const infraWage = content.staff.find(role => role.id === 'infrastructure')!.weeklyCents;
  const primaryOutput = (role: StaffRole) => [WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(state.contentVersion) ? getStaffPointProfile(role)[role] : U;
  const extensions = location === 'colocation' ? null : getActiveFacilityRetrofitEffects(state, design.companyId, location);
  const operatingStaff = location === 'colocation' ? racks * c.colocationStaffPerRack : c.siteBaseStaff + mulDiv(usefulCU, c.siteStaffPer16CU, 16 * U) + extensions!.operatingStaff;
  const fixed = location === 'colocation' ? racks * c.colocationCentsPerRackWeek : c.siteFixedCentsPerWeek + mulDiv(usefulCU, c.ownedMaintenanceCentsPerCUWeek, U) + extensions!.weeklyCents;
  const fabric = hasFastFabric(state, design.companyId, location) || design.spec.architecture === 'sparse';
  const weeklyFixedAndStaff = fixed + mulDiv(operatingStaff, infraWage, primaryOutput('infrastructure'))
    + (fabric ? CHIP_RULES.fabricFixedCentsPerWeek + mulDiv(CHIP_RULES.fabricOperatingStaff, infraWage, primaryOutput('infrastructure')) : 0);
  const cloud = mulDiv(effective, content.opening.rentCentsPerCUWeek, U, 'ceil'), variable = mulDiv(physical, v.variableCentsPerCUw, U, 'ceil');
  const engineering = mulDiv(v.designHardwareStaff + prototype.hardwareStaff, content.staff.find(role => role.id === 'hardware')!.weeklyCents, primaryOutput('hardware'))
    + mulDiv(prototype.mlStaff, content.staff.find(role => role.id === 'ml')!.weeklyCents, primaryOutput('ml'));
  const entry = v.designFeeCents + prototype.feeCents + engineering + production.costCents
    + (design.spec.architecture === 'sparse' && !hasFastFabric(state, design.companyId, location) ? CHIP_RULES.fabricCostCents : 0);
  const savings = cloud - variable - weeklyFixedAndStaff;
  return { utilizationBps: u, usefulCU, weeklyEffectiveWorkCUw: effective, entryAndProductionCents: entry,
    equivalentCloudCentsPerWeek: cloud, ownedVariableCentsPerWeek: variable, ownedFixedAndStaffCentsPerWeek: weeklyFixedAndStaff,
    weeklySavingsCents: savings, simplePaybackWeeks: savings > 0 ? Math.ceil(entry / savings) : null,
    assumptions: [
      `${u / 100}% average use for compatible ${design.spec.architecture} ${design.spec.target} jobs that fit the available memory.`,
      design.qualifiedYieldBps === null ? 'Before prototype testing, this estimate assumes 75% yield. The prototype reveals the design’s fixed production yield.' : `Uses ${CHIP_FOUNDRIES[foundry].name} at ${yieldBps / 100}% batch yield.`,
      'Includes design and prototype fees, minimum engineering pay, this production batch, and the staff and upkeep needed to run it.',
      ...([WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(state.contentVersion) ? ['Staff costs estimate the share of specialist pay needed for the required points at 30 specialty points per week. Actual employees receive their full weekly salary; secondary points are not credited in this estimate.'] : []),
      location === 'colocation' ? 'Uses rented rack-space costs. Excludes onboarding, research fees, cloud rent for simulations, installation pay, and costs while waiting for delivery.' : 'Includes the site’s full weekly overhead. Excludes site construction, onboarding, research fees, cloud rent for simulations, installation pay, and costs while waiting for delivery.',
      ...(extensions?.weeklyCents ? ['Includes upkeep and staff for existing power and cooling upgrades. Their purchase costs were already paid and are excluded from this chip investment.'] : []),
      ...(Object.values(state.slices.compute.facilitySpecializations ?? {}).some(profile => profile.facilityId === location && profile.status === 'active')
        ? ['This comparison leaves out site-profile effects on capacity, training across racks, and serving costs. See Campus for the profile’s benefits and drawbacks.'] : []),
      'Savings are compared with renting general cloud GPUs. Actual savings depend on demand, spare serving capacity, job quality, memory limits, and training efficiency across racks.',
    ] };
}

export function getChipView(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT) {
  const designs = records(state.slices.compute.chipDesigns).filter(design => design.companyId === companyId).map(design => {
    const active = design.status === 'designing' || design.status === 'design-ready' ? design.design : design.prototypeRun!;
    return { ...design, values: chipDesignValues(design), prototypeValues: chipPrototypeValues(design), currentMeters: active,
      progressBps: Math.min(10_000, Math.floor((active.completedWorkCUw / active.requiredWorkCUw
        + active.completedHardwareStaff / active.requiredHardwareStaff + (active.requiredMlStaff ? active.completedMlStaff / active.requiredMlStaff : 0)) / (active.requiredMlStaff ? 3 : 2) * 10_000)),
      forecast: chipPaybackForecast(state, design, 1, 'colocation', 7500, content),
      compatibleModels: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId && model.architecture === design.spec.architecture
        && prototypeReport(state, design, model.id, companyId)),
      compatiblePools: getCompatibleComputePools(state, companyId, { modelArchitecture: design.spec.architecture, workloadKind: design.spec.target,
        category: design.spec.target === 'inference' ? 'serving' : 'development' }, content).map(pool => ({ id: pool.id, name: pool.name, capacityCU: pool.capacityCU, memoryMU: pool.memoryMU })),
    };
  });
  const queuedSuccessors = state.queuedCommands.filter(command => command.companyId === companyId && command.payload.kind === 'start_chip_successor');
  const successors = designs.filter(design => design.successor);
  const remaining = Math.max(0, GEN2_SILICON_RULES.maxSuccessorsPerCompany - successors.length - queuedSuccessors.length);
  const reason = ![CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version) ? 'Second-generation silicon is unavailable in this build.'
    : !completed(state, companyId, GEN2_SILICON_RULES.requiredResearch) ? 'Complete S6 Second-generation silicon.'
      : !hasShippedChipBuyerOrder(state, companyId) ? 'Deliver a chip order to a customer and receive payment.' : null;
  const successor = { unlocked: reason === null, reason, remaining, parents: designs.filter(design => !design.successor).map(parent => {
    const existingSuccessorId = successors.find(design => design.successor!.parentDesignId === parent.id)?.id ?? null;
    const reasons = [...(reason ? [reason] : []), ...(parent.status !== 'validated' ? ['Finish testing this original design’s prototype.'] : []),
      ...(existingSuccessorId ? ['This original design already has its one successor.'] : []),
      ...(queuedSuccessors.some(command => command.payload.kind === 'start_chip_successor' && command.payload.parentDesignId === parent.id) ? ['A successor is already queued for this parent.'] : []),
      ...(!remaining ? ['All eight Gen 2 design slots are already used or queued.'] : [])];
    return { id: parent.id, name: parent.name, eligible: reasons.length === 0, reasons, existingSuccessorId, values: parent.values,
      choices: { memory: chipDesignValues({ spec: parent.spec, successor: successorMetadata(parent, 'memory') }),
        throughput: chipDesignValues({ spec: parent.spec, successor: successorMetadata(parent, 'throughput') }) } };
  }) };
  return { designs, successor, batches: records(state.slices.compute.chipBatches).filter(batch => batch.companyId === companyId),
    fabricProjects: records(state.slices.compute.fabricProjects).filter(project => project.companyId === companyId),
    servingHistoryWeeks: getServingHistoryWeeks(state, companyId), requiredServingWeeks: CHIP_RULES.servingHistoryWeeks,
    canDesign: completed(state, companyId, 'R16'), canInstallFabric: completed(state, companyId, 'R14'),
    locations: [{ id: 'colocation', name: 'Colocation' }, ...Object.values(state.slices.compute.facilities).filter(site => site.companyId === companyId).map(site => ({ id: site.id, name: site.name }))],
    pools: getComputePools(state, companyId, content),
  };
}
