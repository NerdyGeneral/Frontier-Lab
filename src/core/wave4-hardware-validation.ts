import { CONNECTED_COMPANY_CONTENT_VERSION } from './connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from './model-customization-version';
import { STRATEGY_CONTENT_VERSION } from './strategy-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import type { ChipDesign, ChipSpecification, ChipStageGrantProof, ChipWorkMeters } from '../contracts/wave4-hardware';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import type { ChipFoundry, HardwareBuyerId } from '../contracts/wave4-hardware';
import { CHIP_FOUNDRIES, HARDWARE_BUYERS, SILICON_CONTENT_VERSION, chipProductionTerms, hardwareBuyerFit, isChipFoundry } from '../content/silicon-market';
import { hardwareCostFactId, hardwareRevenueFactId } from '../modules/hardware-sales';
import { CHIP_RULES, chipDesignValues, chipPrototypeValues, chipSpecificationKey } from '../content/wave4-hardware';
import { SYNTHETIC_CONTENT_VERSION } from '../content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { GEN2_SILICON_RULES } from '../content/wave28-silicon';
import { chipDesignId, chipGrantReceiptKey, chipParentFingerprint, chipSuccessorId, hasShippedChipBuyerOrder, qualifiedChipYieldBps } from '../modules/chips';
import { GENERAL_CLOUD_POOL, getHistoricalPoolTrainingMultiplier, getRackHardware } from '../modules/compute-pools';
import { getFacilitySpecializationAtWeek } from '../modules/facility-specialization';
import { paidPolicyCapabilityBaseline, policyModelFingerprint } from '../modules/policy-holdouts';
import { checkedAdd, checkedInteger, mulDiv } from './math';
import { canonicalStateHash } from './canonical';

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`); }
function id(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function name(value: unknown): void { check(typeof value === 'string' && value.trim().length > 0 && value.length <= 48 && !/[\u0000-\u001f\u007f]/.test(value), 'Chip name is invalid.'); }
function spec(value: ChipSpecification): void {
  record(value, 'Chip specification');
  check(Object.keys(value).sort().join() === 'architecture,memory,target', 'A chip specification has unknown or missing fields.');
  check(['dense', 'sparse'].includes(value.architecture) && ['inference', 'training'].includes(value.target)
    && ['balanced', 'wide'].includes(value.memory), 'Chip compatibility choices are invalid.');
}

export function assertWave4HardwareCommand(payload: CommandPayload): void {
  switch (payload.kind) {
    case 'start_chip_design': name(payload.name); spec(payload.spec); break;
    case 'start_chip_successor':
      check(Object.keys(payload).sort().join() === 'improvement,kind,name,parentDesignId', 'A successor command has unknown or missing fields.');
      name(payload.name); id(payload.parentDesignId, 'Parent chip design');
      check(['memory', 'throughput'].includes(payload.improvement), 'Choose a memory or throughput successor target.'); break;
    case 'start_chip_prototype': id(payload.designId, 'Chip design'); id(payload.modelId, 'Prototype model'); break;
    case 'set_chip_project_paused': id(payload.designId, 'Chip design'); check(typeof payload.paused === 'boolean', 'Chip pause choice is invalid.'); break;
    case 'order_chip_batch': id(payload.designId, 'Chip design'); id(payload.location, 'Production location'); check([1, 2, 4].includes(payload.racks), 'Production batch must have one, two, or four racks.'); break;
    case 'install_fast_fabric': id(payload.location, 'Fabric location'); break;
    case 'set_fabric_paused': id(payload.fabricId, 'Fabric installation'); check(typeof payload.paused === 'boolean', 'Fabric pause choice is invalid.'); break;
  }
}

/** New engineering retains its own allocator evidence, never the parent's meters. */
function assertSuccessorGrants(state: GameState, content: GameContent, design: ChipDesign, value: ChipWorkMeters, designStage: boolean): void {
  const proof = value.grantProof as ChipStageGrantProof;
  record(proof, 'Successor grant proof'); record(proof.workReceipts, 'Successor compute receipts');
  check(Object.keys(proof).sort().join() === 'firstWeek,grantWeeks,hardwareGrantWeeks,latest,mlGrantWeeks,physicalWorkCUw,workReceipts', 'Successor grant proof has unknown or missing fields.');
  for (const quantity of [proof.grantWeeks, proof.hardwareGrantWeeks, proof.mlGrantWeeks, proof.physicalWorkCUw]) checkedInteger(quantity, 'Successor grant quantity');
  const receipts = Object.entries(proof.workReceipts);
  check(receipts.length <= GEN2_SILICON_RULES.maximumReceiptBuckets, 'Successor compute history is unbounded.');
  const category = designStage ? 'research' : 'development', workloadKind = designStage ? 'general' : design.spec.target;
  const requestId = `${designStage ? 'chip-design' : 'chip-prototype'}:${design.id}`;
  let totalWork = 0, totalPhysical = 0, computeGrantWeeks = 0;
  for (const [key, receipt] of receipts) {
    record(receipt, 'Successor compute receipt'); id(receipt.poolId, 'Successor pool'); id(receipt.hardwareId, 'Successor hardware');
    check(Object.keys(receipt).sort().join() === 'baseMultiplierBps,conversionRemainder,crossRack,effectiveCUw,firstWeek,grants,hardwareId,lastWeek,multiplierBps,ownership,physicalCUw,poolId,specializationId'
      && key === chipGrantReceiptKey(receipt) && ['cloud', 'owned'].includes(receipt.ownership) && typeof receipt.crossRack === 'boolean', 'Successor compute receipt identity changed.');
    for (const quantity of [receipt.baseMultiplierBps, receipt.multiplierBps, receipt.effectiveCUw, receipt.physicalCUw, receipt.conversionRemainder,
      receipt.grants, receipt.firstWeek, receipt.lastWeek]) checkedInteger(quantity, 'Successor compute quantity');
    check(receipt.baseMultiplierBps > 0 && receipt.multiplierBps > 0 && receipt.physicalCUw > 0 && receipt.effectiveCUw > 0 && receipt.grants > 0
      && receipt.firstWeek >= value.startedWeek && receipt.lastWeek >= receipt.firstWeek && receipt.lastWeek <= state.week
      && receipt.grants <= receipt.lastWeek - receipt.firstWeek + 1, 'Successor compute progress violates its elapsed work history.');
    if (receipt.ownership === 'cloud') check(receipt.poolId === GENERAL_CLOUD_POOL && receipt.hardwareId === 'general' && !receipt.crossRack
      && receipt.specializationId === null && receipt.baseMultiplierBps === 10000 && receipt.multiplierBps === 10000, 'Successor cloud work changed its real conversion.');
    else {
      const prefix = 'owned:', suffix = ':' + receipt.hardwareId;
      check(receipt.poolId.startsWith(prefix) && receipt.poolId.endsWith(suffix), 'Successor work has an invalid owned pool.');
      const location = receipt.poolId.slice(prefix.length, -suffix.length);
      check(location === 'colocation' || state.slices.compute.facilities[location]?.companyId === design.companyId, 'Successor work has a foreign site.');
      const rack = Object.values(state.slices.compute.racks).find(item => item.companyId === design.companyId && item.hardwareId === receipt.hardwareId);
      const hardware = content.hardware.find(item => item.id === receipt.hardwareId) ?? (rack ? getRackHardware(state, rack, content) : undefined);
      check(rack && hardware, 'Successor work has no owned authored or qualified hardware.');
      const chip = state.slices.compute.chipDesigns[receipt.hardwareId];
      check(!chip || (chip.status === 'validated' && !designStage && chip.spec.architecture === design.spec.architecture && chip.spec.target === design.spec.target),
        'Successor work used incompatible custom hardware.');
      const raw = Math.round((chip && workloadKind === 'inference' ? hardware!.servingMultiplier : hardware!.trainingMultiplier) * 10000);
      const fabricAt = (week: number) => Object.values(state.slices.compute.fabricProjects).some(fabric => fabric.companyId === design.companyId && fabric.location === location
        && fabric.readyWeek !== null && fabric.readyWeek <= week);
      const expectedBase = (week: number) => receipt.crossRack && !(chip && workloadKind === 'inference')
        ? mulDiv(raw, fabricAt(week) ? CHIP_RULES.fabricCrossRackBps : content.infrastructure.crossRackTrainingBps, 10000) : raw;
      for (const week of [receipt.firstWeek, receipt.lastWeek]) {
        const profile = location === 'colocation' ? null : getFacilitySpecializationAtWeek(state, location, week);
        check((profile?.id ?? null) === receipt.specializationId && receipt.baseMultiplierBps === expectedBase(week)
          && receipt.multiplierBps === getHistoricalPoolTrainingMultiplier(state, receipt.poolId, receipt.hardwareId, week,
            receipt.baseMultiplierBps, receipt.crossRack, { category, workloadKind }), 'Successor conversion differs from its frozen hardware, fabric or facility profile interval.');
      }
      if (receipt.specializationId !== null) id(receipt.specializationId, 'Successor facility profile');
    }
    check(BigInt(receipt.physicalCUw) * BigInt(receipt.multiplierBps) === BigInt(receipt.effectiveCUw) * BigInt(10000) + BigInt(receipt.conversionRemainder)
      && BigInt(receipt.conversionRemainder) < BigInt(Math.max(receipt.multiplierBps, 10000)) * BigInt(receipt.grants), 'Successor useful work does not reconcile with its physical grants.');
    totalWork = checkedAdd(totalWork, receipt.effectiveCUw); totalPhysical = checkedAdd(totalPhysical, receipt.physicalCUw); computeGrantWeeks += receipt.grants;
  }
  check(totalWork === value.completedWorkCUw && totalPhysical === proof.physicalWorkCUw && computeGrantWeeks <= proof.grantWeeks
    && proof.hardwareGrantWeeks <= proof.grantWeeks && proof.mlGrantWeeks <= proof.grantWeeks, 'Successor progress has no matching compute or staff receipts.');
  if (proof.latest === null) {
    check(proof.firstWeek === null && proof.grantWeeks === 0 && proof.hardwareGrantWeeks === 0 && proof.mlGrantWeeks === 0
      && !value.completedWorkCUw && !value.completedHardwareStaff && !value.completedMlStaff && receipts.length === 0, 'Successor progress has no actual grant.');
    return;
  }
  const latest = proof.latest; record(latest, 'Latest successor grant');
  check(Object.keys(latest).sort().join() === 'effectiveCUw,hardwareStaff,memoryMU,mlStaff,physicalCUw,poolId,receiptKey,remainingHardwareStaff,remainingMlStaff,remainingWorkCUw,week', 'Latest successor grant has unknown or missing fields.');
  for (const quantity of [proof.firstWeek, latest.week, latest.remainingWorkCUw, latest.remainingHardwareStaff, latest.remainingMlStaff,
    latest.hardwareStaff, latest.mlStaff, latest.effectiveCUw, latest.physicalCUw, latest.memoryMU]) checkedInteger(quantity!, 'Successor grant quantity');
  check(proof.firstWeek! >= value.startedWeek && latest.week >= proof.firstWeek! && latest.week <= state.week
    && proof.grantWeeks > 0 && proof.grantWeeks <= latest.week - proof.firstWeek! + 1
    && latest.effectiveCUw + latest.hardwareStaff + latest.mlStaff > 0, 'Successor grant timing or count is invalid.');
  for (const [required, completed, remaining, granted, count] of [
    [value.requiredWorkCUw, value.completedWorkCUw, latest.remainingWorkCUw, latest.effectiveCUw, computeGrantWeeks],
    [value.requiredHardwareStaff, value.completedHardwareStaff, latest.remainingHardwareStaff, latest.hardwareStaff, proof.hardwareGrantWeeks],
    [value.requiredMlStaff, value.completedMlStaff, latest.remainingMlStaff, latest.mlStaff, proof.mlGrantWeeks],
  ]) check(remaining <= required && granted <= remaining && completed === required - remaining + granted && completed >= count
    && ((completed > 0) === (count > 0)), 'Successor latest grant changed its independent budget or accumulated work.');
  if (value.completedWeek !== null) check(value.completedWeek === latest.week, 'Successor completion is not its final actual work boundary.');
  if (latest.effectiveCUw > 0) {
    const receipt = latest.receiptKey === null ? undefined : proof.workReceipts[latest.receiptKey];
    check(receipt && latest.poolId === receipt.poolId && latest.week === receipt.lastWeek && latest.physicalCUw > 0
      && latest.physicalCUw <= receipt.physicalCUw && latest.effectiveCUw <= receipt.effectiveCUw
      && latest.memoryMU === (designStage ? 0 : design.prototypeRun!.modelMemoryMU)
      && latest.effectiveCUw === Math.min(latest.remainingWorkCUw, mulDiv(latest.physicalCUw, receipt.multiplierBps, 10000)), 'Successor grant changed its connected memory or work conversion.');
  } else check(latest.poolId === null && latest.receiptKey === null && latest.physicalCUw === 0, 'Successor has compute evidence without useful work.');
  const report = state.slices.compute.costReports?.[design.companyId]?.find(row => row.week === latest.week);
  if (report) {
    const request = report.resources.requests.find(row => row.id === requestId), grant = report.resources.computeGrants.find(row => row.requestId === requestId);
    const staff = report.resources.staffGrants.find(row => row.requestId === requestId)?.grants ?? [];
    check(request && grant && request.taskId === design.id && request.category === category && request.workloadKind === workloadKind
      && request.normalizedWorkCUw === latest.remainingWorkCUw && request.memoryMU === (!designStage && latest.remainingWorkCUw ? design.prototypeRun!.modelMemoryMU : 0)
      && request.staffDemand?.find(row => row.role === 'hardware')?.staffWeeks === latest.remainingHardwareStaff
      && (request.staffDemand?.find(row => row.role === 'ml')?.staffWeeks ?? 0) === latest.remainingMlStaff
      && grant.hardwareEffectiveCUw === latest.effectiveCUw && grant.physicalCUw === latest.physicalCUw && grant.memoryMU === latest.memoryMU
      && (!latest.effectiveCUw || grant.poolId === latest.poolId)
      && (staff.find(row => row.role === 'hardware')?.staffWeeks ?? 0) === latest.hardwareStaff
      && (staff.find(row => row.role === 'ml')?.staffWeeks ?? 0) === latest.mlStaff, 'Successor work disagrees with settled shared-allocator evidence.');
  }
}

/** Validate paid provenance, frozen compatibility, bounded history, and every activation boundary. */
export function assertWave4HardwareState(state: GameState, content: GameContent): void {
  const { compute, company } = state.slices, companyIds = new Set(Object.keys(company.companies)), payments = new Set<string>();
  record(compute.chipDesigns, 'Chip designs'); record(compute.chipBatches, 'Chip production');
  record(compute.fabricProjects, 'Fast fabric'); record(compute.servingHistory, 'Customer-serving history');
  const past = (week: number, label: string) => { checkedInteger(week, label); check(week <= state.week, `${label} is in the future.`); };
  const note = (value: unknown) => check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Hardware explanation is invalid.');
  const known = (companyId: string, researchId: string) => (state.slices.research.completedByCompany[companyId]
    ?? (companyId === state.playerCompanyId ? state.slices.research.completed : [])).includes(researchId);
  const payment = (paymentId: string, companyId: string, sourceId: string, amountCents: number, week: number, category: 'capital' | 'operating') => {
    id(paymentId, 'Hardware payment'); check(!payments.has(paymentId), 'A chip or fabric payment was reused.'); payments.add(paymentId);
    check(company.postedFacts[paymentId] === true, 'Hardware work has no settled payment proof.');
    const entry = company.ledger.find(item => item.id === paymentId);
    if (entry) check(entry.companyId === companyId && entry.sourceId === sourceId && entry.amountCents === amountCents && entry.week === week
      && entry.category === category && entry.kind === 'expense' && entry.unpaidCents === 0, 'Hardware payment does not match its frozen project.');
  };
  const meters = (value: ChipWorkMeters, requirements: { work: number; hardware: number; ml: number }) => {
    record(value, 'Chip work meters'); past(value.startedWeek, 'Chip stage start');
    for (const quantity of [value.requiredWorkCUw, value.completedWorkCUw, value.requiredHardwareStaff, value.completedHardwareStaff,
      value.requiredMlStaff, value.completedMlStaff, value.lastProgress]) checkedInteger(quantity, 'Chip stage quantity');
    check(value.requiredWorkCUw === requirements.work && value.requiredHardwareStaff === requirements.hardware && value.requiredMlStaff === requirements.ml,
      'Chip stage requirements differ from its authored specification.');
    check(value.completedWorkCUw <= value.requiredWorkCUw && value.completedHardwareStaff <= value.requiredHardwareStaff
      && value.completedMlStaff <= value.requiredMlStaff && value.lastProgress <= value.completedWorkCUw, 'Chip stage progress exceeds its paid requirements.');
    note(value.lastBottleneck);
    const finished = value.completedWorkCUw === value.requiredWorkCUw && value.completedHardwareStaff === value.requiredHardwareStaff && value.completedMlStaff === value.requiredMlStaff;
    if (value.completedWeek === null) check(value.readyWeek === null && !finished, 'Unfinished chip stage has an availability boundary or finished meters.');
    else {
      past(value.completedWeek, 'Chip stage completion');
      check(finished && value.completedWeek >= value.startedWeek && value.readyWeek === value.completedWeek + 1
        && value.readyWeek <= state.week + 1, 'Chip stage completion and availability do not match its work.');
    }
  };
  const uniqueSpecs = new Set<string>(), successorParents = new Set<string>();
  const researchBefore = (companyId: string, researchId: string, week: number) => Object.values(state.slices.research.projects)
    .some(project => project.companyId === companyId && project.researchId === researchId && project.status === 'complete'
      && project.availableWeek !== undefined && project.availableWeek < week);
  for (const [key, design] of Object.entries(compute.chipDesigns)) {
    record(design, 'Chip design'); id(key, 'Chip design ID'); name(design.name); spec(design.spec);
    record(design.design, 'Chip design work');
    check(Object.keys(design).sort().join() === (Object.hasOwn(design, 'successor')
      ? 'companyId,design,designFeeCents,designPaymentId,id,name,paused,prototypeRun,qualifiedYieldBps,spec,status,successor'
      : 'companyId,design,designFeeCents,designPaymentId,id,name,paused,prototypeRun,qualifiedYieldBps,spec,status'), 'Chip design has unknown or missing fields.');
    check(design.id === key && companyIds.has(design.companyId), 'Chip identity or ownership is invalid.');
    if (Object.hasOwn(design, 'successor')) {
      const successor = design.successor!; record(successor, 'Successor lineage');
      check([CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version) && Object.keys(successor).sort().join() === 'generation,improvement,parentDesignId,parentFingerprint'
        && successor.generation === 2 && ['memory', 'throughput'].includes(successor.improvement), 'Successor metadata is invalid or unavailable in this build.');
      id(successor.parentDesignId, 'Parent design');
      check(typeof successor.parentFingerprint === 'string' && /^[a-f0-9]{8}$/.test(successor.parentFingerprint), 'Parent design fingerprint is invalid.');
      const parent = compute.chipDesigns[successor.parentDesignId];
      check(parent && parent.companyId === design.companyId && !Object.hasOwn(parent, 'successor') && parent.status === 'validated'
        && parent.qualifiedYieldBps !== null && parent.prototypeRun?.readyWeek !== null && parent.prototypeRun!.readyWeek! < design.design.startedWeek
        && canonicalStateHash(design.spec) === canonicalStateHash(parent.spec) && successor.parentFingerprint === chipParentFingerprint(parent), 'Successor lost its original qualified parent, frozen specification or prototype lineage.');
      check(!successorParents.has(parent.id), 'An original design has more than one successor target.'); successorParents.add(parent.id);
      check(key === chipSuccessorId(design.companyId, parent.id, successor.improvement), 'Successor identity is not tied to its frozen parent and target.');
      check(known(design.companyId, GEN2_SILICON_RULES.requiredResearch) && researchBefore(design.companyId, GEN2_SILICON_RULES.requiredResearch, design.design.startedWeek)
        && hasShippedChipBuyerOrder(state, design.companyId, design.design.startedWeek - 1), 'Successor funding preceded paid S6 research or its accelerator shipment.');
    } else {
      check(key === chipDesignId(design.companyId, design.spec), 'Chip identity is not tied to its company and specification.');
      const fingerprint = `${design.companyId}:${chipSpecificationKey(design.spec)}`;
      check(!uniqueSpecs.has(fingerprint), 'A chip specification was duplicated to reroll its result.'); uniqueSpecs.add(fingerprint);
      check(!Object.hasOwn(design.design, 'grantProof') && (!design.prototypeRun || (!Object.hasOwn(design.prototypeRun, 'grantProof')
        && !Object.hasOwn(design.prototypeRun, 'modelFingerprint'))), 'Original chip work cannot carry successor evidence.');
    }
    check(known(design.companyId, 'R16') && (design.spec.architecture !== 'sparse' || known(design.companyId, 'R14')), 'Chip design is missing its required research.');
    check(['designing', 'design-ready', 'prototyping', 'validated'].includes(design.status) && typeof design.paused === 'boolean', 'Chip project status is invalid.');
    const values = chipDesignValues(design), prototypeValues = chipPrototypeValues(design);
    check(design.designFeeCents === values.designFeeCents && design.designPaymentId === `chip-design-fee:${key}`, 'Chip design fee differs from its specification.');
    meters(design.design, { work: values.designWorkCUw, hardware: values.designHardwareStaff, ml: 0 });
    if (design.successor) assertSuccessorGrants(state, content, design, design.design, true);
    payment(design.designPaymentId, design.companyId, key, design.designFeeCents, design.design.startedWeek, 'operating');
    if (design.status === 'designing') {
      check(design.prototypeRun === null && design.qualifiedYieldBps === null, 'Unfinished chip design has prototype or production evidence.');
      check(design.design.readyWeek === null || design.design.readyWeek === state.week + 1, 'Chip specification availability is overdue.');
    } else {
      check(design.design.readyWeek !== null && design.design.readyWeek <= state.week, 'Chip specification was used before it became available.');
      if (design.status === 'design-ready') check(design.prototypeRun === null && design.qualifiedYieldBps === null && !design.paused, 'A ready specification has unexpected prototype evidence.');
      else {
        const prototype = design.prototypeRun; check(prototype, 'Prototype stage is missing its validation work.');
        meters(prototype!, { work: prototypeValues.workCUw, hardware: prototypeValues.hardwareStaff, ml: prototypeValues.mlStaff });
        if (design.successor) assertSuccessorGrants(state, content, design, prototype!, false);
        check(prototype!.startedWeek > design.design.readyWeek!, 'Prototype began before the specification was available to plan.');
        const model = state.slices.models.versions[prototype!.modelId], report = state.slices.models.reports[prototype!.reportId];
        check(model?.companyId === design.companyId && report?.companyId === design.companyId && report.modelId === model.id && report.heldOut
          && isCapabilitySuite(report.suiteId) && report.week < prototype!.startedWeek, 'Prototype model is missing its owned preexisting capability report.');
        if (design.successor) check(prototype!.modelFingerprint === policyModelFingerprint(model!)
          && paidPolicyCapabilityBaseline(state, model!, report!.id, prototype!.startedWeek - 1), 'Successor prototype needs the exact completed paid model/runtime capability report.');
        check(prototype!.modelArchitecture === design.spec.architecture && prototype!.modelArchitecture === model!.architecture
          && prototype!.modelFamily === model!.family && prototype!.modelMemoryMU === model!.residentMU, 'Prototype compatibility or memory differs from its frozen model.');
        check(prototype!.feeCents === prototypeValues.feeCents && prototype!.paymentId === `chip-prototype-fee:${key}`, 'Prototype payment differs from its authored cost.');
        payment(prototype!.paymentId, design.companyId, key, prototype!.feeCents, prototype!.startedWeek, 'operating');
        if (design.status === 'prototyping') check(design.qualifiedYieldBps === null && (prototype!.readyWeek === null || prototype!.readyWeek === state.week + 1), 'Unfinished prototype has production qualification or overdue activation.');
        else check(prototype!.readyWeek !== null && prototype!.readyWeek <= state.week && !design.paused
          && design.qualifiedYieldBps === qualifiedChipYieldBps(state, design.companyId, design.spec), 'Qualified yield does not match the completed prototype or its stable specification.');
      }
    }
    const active = design.status === 'designing' ? design.design : design.status === 'prototyping' ? design.prototypeRun : null;
    if (design.paused) check(active && active.readyWeek === null, 'Only unfinished design or prototype work may be paused.');
  }
  if (![CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) check(!state.queuedCommands.some(command => command.payload.kind === 'start_chip_successor'), 'Successor commands are unavailable in this build.');
  const currentSilicon = [SILICON_CONTENT_VERSION, SYNTHETIC_CONTENT_VERSION, STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version);
  const foundryBookings: { foundry: ChipFoundry; start: number; end: number; racks: number }[] = [];
  const producedRacks = new Set<string>();
  for (const [key, batch] of Object.entries(compute.chipBatches)) {
    record(batch, 'Chip production batch'); id(key, 'Chip batch ID');
    check(batch.id === key && companyIds.has(batch.companyId) && key.startsWith('chip-batch-'), 'Chip batch identity is invalid.');
    const design = compute.chipDesigns[batch.designId]; check(design?.companyId === batch.companyId && design.status === 'validated', 'Production has no qualified owned specification.');
    check(!Object.hasOwn(batch, 'foundry') || (currentSilicon && isChipFoundry(batch.foundry)), 'Production foundry is invalid for this build.');
    const terms = chipProductionTerms(design!, batch.racks, content.infrastructure.rackCU, batch.foundry);
    check([1, 2, 4].includes(batch.racks) && Array.isArray(batch.rackIds) && batch.rackIds.length === batch.racks, 'Production batch size is invalid.');
    check(batch.location === 'colocation' || compute.facilities[batch.location]?.companyId === batch.companyId, 'Chip batch location is missing or foreign.');
    past(batch.orderedWeek, 'Production order'); checkedInteger(batch.arrivalWeek, 'Production arrival');
    check(batch.orderedWeek > design!.prototypeRun!.readyWeek! && batch.arrivalWeek === batch.orderedWeek + terms.leadWeeks, 'Production began before qualification or has an invalid lead time.');
    check(batch.attemptedCU === terms.attemptedCU && batch.yieldBps === terms.yieldBps && batch.usableCU === terms.usableCU, 'Production yield or capacity was changed.');
    check(batch.purchaseCents === terms.costCents && batch.paymentId === `chip-production:${key}`, 'Production payment does not match the attempted wafer capacity.');
    if (batch.foundry && CHIP_FOUNDRIES[batch.foundry].rackSlots !== null) {
      foundryBookings.push({ foundry: batch.foundry, start: batch.orderedWeek, end: batch.arrivalWeek, racks: batch.racks });
    }
    payment(batch.paymentId, batch.companyId, key, batch.purchaseCents, batch.orderedWeek, 'capital');
    check(['fabricating', 'delivered'].includes(batch.status), 'Production status is invalid.');
    if (batch.status === 'fabricating') check(batch.arrivalWeek > state.week && batch.deliveredWeek === null, 'Unarrived production has delivery evidence.');
    else check(batch.arrivalWeek <= state.week && batch.deliveredWeek === batch.arrivalWeek, 'Production delivery is missing or repeated.');
    batch.rackIds.forEach((rackId, index) => {
      check(rackId === `rack-${key.slice('chip-batch-'.length)}-${index + 1}` && !producedRacks.has(rackId), 'Production rack identity was duplicated.'); producedRacks.add(rackId);
      const rack = compute.racks[rackId];
      check(rack && rack.companyId === batch.companyId && rack.chipDesignId === design!.id && rack.chipBatchId === key && rack.hardwareId === design!.id
        && (rack.purchaseLocation ?? rack.location) === batch.location && rack.orderedWeek === batch.orderedWeek && rack.arrivalWeek === batch.arrivalWeek
        && rack.usableCU === batch.usableCU / batch.racks && rack.purchaseCents === batch.purchaseCents / batch.racks, 'Produced rack does not match its paid batch.');
      check((batch.status === 'fabricating') === (rack.status === 'ordered'), 'Produced rack and batch delivery disagree.');
    });
  }
  for (const rack of Object.values(compute.racks)) if (rack.chipDesignId !== undefined) check(producedRacks.has(rack.id), 'Custom rack has no production receipt.');
  if (Object.hasOwn(compute, 'hardwareSales')) {
    check(currentSilicon, 'Hardware sales are unavailable in this build.');
    record(compute.hardwareSales, 'Hardware sales');
    for (const [key, sale] of Object.entries(compute.hardwareSales!)) {
      const buyerId = key as HardwareBuyerId;
      check(Object.hasOwn(HARDWARE_BUYERS, buyerId), 'Unknown hardware buyer.');
      record(sale, 'Hardware order');
      check(Object.keys(sale).sort().join() === 'arrivalWeek,buyerId,companyId,designId,foundry,orderedWeek,shippedWeek'
        && sale.buyerId === buyerId && sale.companyId === state.playerCompanyId && isChipFoundry(sale.foundry), 'Hardware order identity is invalid.');
      const design = compute.chipDesigns[sale.designId], buyer = HARDWARE_BUYERS[buyerId];
      check(design?.companyId === sale.companyId && design.status === 'validated', 'Hardware order lost its qualified design.');
      const terms = chipProductionTerms(design, buyer.racks, content.infrastructure.rackCU, sale.foundry);
      past(sale.orderedWeek, 'Hardware order start');
      check(sale.orderedWeek > design.prototypeRun!.readyWeek! && sale.arrivalWeek === sale.orderedWeek + terms.leadWeeks
        && !hardwareBuyerFit(design, buyerId, terms), 'Hardware shipment cannot satisfy its frozen specifications or deadline.');
      const delivered = sale.arrivalWeek <= state.week;
      check(sale.shippedWeek === (delivered ? sale.arrivalWeek : null), 'Hardware shipment is missing or premature.');
      payment(hardwareCostFactId(buyerId), sale.companyId, 'hardware-order:' + buyerId, terms.costCents, sale.orderedWeek, 'operating');
      const receiptId = hardwareRevenueFactId(buyerId);
      check((company.postedFacts[receiptId] === true) === delivered, 'Hardware revenue must settle exactly once on delivery.');
      const receipt = company.ledger.find(entry => entry.id === receiptId);
      if (receipt) check(receipt.companyId === sale.companyId && receipt.week === sale.arrivalWeek && receipt.sourceId === 'hardware-order:' + buyerId
        && receipt.amountCents === buyer.priceCents && receipt.kind === 'receipt' && receipt.category === 'revenue', 'Hardware receipt differs from its buyer’s offer.');
      if (CHIP_FOUNDRIES[sale.foundry].rackSlots !== null) {
        foundryBookings.push({ foundry: sale.foundry, start: sale.orderedWeek, end: sale.arrivalWeek, racks: buyer.racks });
      }
    }
  }
  for (const buyerId of Object.keys(HARDWARE_BUYERS) as HardwareBuyerId[]) {
    if (!compute.hardwareSales?.[buyerId]) check(!company.postedFacts[hardwareCostFactId(buyerId)]
      && !company.postedFacts[hardwareRevenueFactId(buyerId)], 'Hardware ledger facts require a matching order.');
  }
  for (const booking of foundryBookings) {
    const active = foundryBookings.filter(other => other.foundry === booking.foundry && other.start <= booking.start && booking.start < other.end);
    check(active.reduce((sum, other) => sum + other.racks, 0) <= CHIP_FOUNDRIES[booking.foundry].rackSlots!, 'Foundry bookings exceed the line’s capacity.');
  }
  if (!currentSilicon) check(!state.queuedCommands.some(command => command.payload.kind === 'accept_hardware_order'
    || (command.payload.kind === 'order_chip_batch' && Object.hasOwn(command.payload, 'foundry'))), 'Silicon expansion commands are unavailable in this build.');
  const fabricLocations = new Set<string>();
  for (const [key, fabric] of Object.entries(compute.fabricProjects)) {
    record(fabric, 'Fast fabric'); id(key, 'Fabric ID');
    check(fabric.id === key && companyIds.has(fabric.companyId) && key.startsWith('fabric-'), 'Fabric identity or ownership is invalid.');
    check(known(fabric.companyId, 'R14'), 'Fast fabric is missing Sparse architecture research.');
    check(fabric.location === 'colocation' || compute.facilities[fabric.location]?.companyId === fabric.companyId, 'Fabric location is missing or foreign.');
    const location = `${fabric.companyId}:${fabric.location}`; check(!fabricLocations.has(location), 'A location has duplicate fabric installations.'); fabricLocations.add(location);
    check(['installing', 'ready', 'active'].includes(fabric.status) && typeof fabric.paused === 'boolean', 'Fabric status is invalid.');
    past(fabric.startedWeek, 'Fabric start');
    for (const quantity of [fabric.requiredWeeks, fabric.elapsedWeeks, fabric.requiredStaff, fabric.completedStaff, fabric.requiredWorkCUw, fabric.completedWorkCUw, fabric.purchaseCents]) checkedInteger(quantity, 'Fabric meter');
    check(fabric.requiredWeeks === CHIP_RULES.fabricElapsedWeeks && fabric.requiredStaff === CHIP_RULES.fabricStaff
      && fabric.requiredWorkCUw === CHIP_RULES.fabricWorkCUw && fabric.purchaseCents === CHIP_RULES.fabricCostCents && fabric.paymentId === `fast-fabric:${key}`, 'Fabric requirements or price changed.');
    check(fabric.elapsedWeeks <= fabric.requiredWeeks && fabric.elapsedWeeks <= state.week - fabric.startedWeek + 1
      && fabric.completedStaff <= fabric.requiredStaff && fabric.completedWorkCUw <= fabric.requiredWorkCUw, 'Fabric progress exceeds its elapsed or paid work.');
    note(fabric.lastBottleneck); payment(fabric.paymentId, fabric.companyId, key, fabric.purchaseCents, fabric.startedWeek, 'capital');
    const finished = fabric.elapsedWeeks === fabric.requiredWeeks && fabric.completedStaff === fabric.requiredStaff && fabric.completedWorkCUw === fabric.requiredWorkCUw;
    if (fabric.status === 'installing') check(!finished && fabric.completedWeek === null && fabric.readyWeek === null, 'Unfinished fabric has a completion boundary.');
    else {
      check(finished && !fabric.paused && fabric.completedWeek !== null && fabric.readyWeek === fabric.completedWeek + 1
        && fabric.completedWeek >= fabric.startedWeek + fabric.requiredWeeks - 1, 'Fabric activation lacks complete installation evidence.');
      past(fabric.completedWeek!, 'Fabric completion');
      check(fabric.status === 'ready' ? fabric.readyWeek === state.week + 1 : fabric.readyWeek! <= state.week, 'Fabric activation boundary is invalid.');
    }
  }
  for (const [companyId, weeks] of Object.entries(compute.servingHistory)) {
    check(companyIds.has(companyId) && Array.isArray(weeks) && weeks.length <= CHIP_RULES.servingHistoryWeeks, 'Serving history has an invalid company or unbounded collection.');
    let previous = 0;
    for (const week of weeks) {
      record(week, 'Serving week'); past(week.week, 'Serving week');
      check(week.week > previous, 'Serving weeks must be distinct, ordered, and later than founding.'); previous = week.week;
      [week.publicPhysicalCUw, week.privatePhysicalCUw, week.agentPhysicalCUw].forEach(quantity => checkedInteger(quantity, 'Customer-serving work'));
      check(week.publicPhysicalCUw + week.privatePhysicalCUw + week.agentPhysicalCUw > 0, 'Idle capacity cannot establish a customer-serving week.');
    }
  }
  for (const companyId of companyIds) {
    check(Object.values(compute.chipDesigns).filter(item => item.companyId === companyId && !item.successor).length <= CHIP_RULES.maxDesignsPerCompany, 'Chip design collection exceeds the supported specifications.');
    check(Object.values(compute.chipDesigns).filter(item => item.companyId === companyId && item.successor).length <= GEN2_SILICON_RULES.maxSuccessorsPerCompany, 'Successor collection exceeds its separate company limit.');
    check(Object.values(compute.chipBatches).filter(item => item.companyId === companyId).length <= CHIP_RULES.maxBatchesPerCompany, 'Production history exceeds the supported rack limit.');
    check(Object.values(compute.fabricProjects).filter(item => item.companyId === companyId).length <= content.infrastructure.maxFacilitiesPerCompany + 1, 'Fabric installations exceed owned locations.');
  }
}
