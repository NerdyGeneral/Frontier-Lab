import { DESIGN_RESEARCH_IDS } from './model-designs';
import { CUSTOMIZATION_RESEARCH_IDS } from './model-customization-research';
import type { GameContent } from '../contracts/types';

type RecordValue = Record<string, unknown>;
const RESOURCE_SCALE = 1_000_000_000;
const ROLES = ['research', 'ml', 'data', 'infrastructure', 'commercial', 'hardware'];
const HARDWARE_IDS = ['general', 'memory-rich', 'training'];
const CORE_IDS = Array.from({ length: 16 }, (_, index) => `R${index + 1}`);
const PRIORITY_PARENTS: Readonly<Record<string, string>> = {
  R1A: 'R1', R2A: 'R2', R3B: 'R3', R4B: 'R4', R4C: 'R4', R5A: 'R5', R6A: 'R6',
  R7A: 'R7', R8A: 'R8', R9A: 'R9', R10A: 'R10', R11A: 'R11', R12A: 'R12',
};

/**
 * Validates authored content before it can initialize a company.
 * It is deliberately independent of the engine and tolerates malformed runtime
 * input: errors are ordinary readable strings, never partial economic changes.
 */
export function validateContent(content: GameContent): string[] {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const object = (value: unknown, path: string): RecordValue => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(path, 'must be an object');
      return {};
    }
    return value as RecordValue;
  };
  const array = (value: unknown, path: string): unknown[] => {
    if (!Array.isArray(value)) {
      fail(path, 'must be an array');
      return [];
    }
    return value;
  };
  const text = (value: unknown, path: string, maximum = 2_000): value is string => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
      fail(path, `must be nonempty text of at most ${maximum} characters`);
      return false;
    }
    return true;
  };
  const id = (value: unknown, path: string): value is string => {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value)) {
      fail(path, 'must be a stable identifier with letters, digits, underscores, or hyphens');
      return false;
    }
    return true;
  };
  const integer = (value: unknown, path: string, minimum = 0): value is number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
      fail(path, `must be a safe integer of at least ${minimum}`);
      return false;
    }
    return true;
  };
  const coefficient = (value: unknown, path: string): value is number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0
      || !Number.isSafeInteger(value * RESOURCE_SCALE)) {
      fail(path, 'must be a positive finite coefficient representable in fixed-point units');
      return false;
    }
    return true;
  };
  const score = (value: unknown, path: string): value is number => {
    if (!integer(value, path)) return false;
    if (value > 10_000) {
      fail(path, 'must be in the basis-point range 0–10000');
      return false;
    }
    return true;
  };
  const scores = (value: unknown, path: string) => {
    const entries = object(value, path);
    for (const domain of ['conversation', 'documents', 'coding', 'tools']) {
      score(entries[domain], `${path}.${domain}`);
    }
    return entries;
  };
  const enumValue = (value: unknown, choices: readonly string[], path: string) => {
    if (typeof value !== 'string' || !choices.includes(value)) {
      fail(path, `must be one of ${choices.join(', ')}`);
    }
  };
  const sameMembers = (actual: readonly string[], expected: readonly string[], path: string) => {
    const actualSet = new Set(actual);
    for (const expectedId of expected) {
      if (!actualSet.has(expectedId)) fail(path, `missing ${expectedId}`);
    }
    for (const actualId of actualSet) {
      if (!expected.includes(actualId)) fail(path, `unexpected ${actualId}`);
    }
    if (actual.length !== expected.length) fail(path, `must contain exactly ${expected.length} entries`);
  };
  const registeredIds = new Map<string, string>();
  const register = (value: unknown, path: string): value is string => {
    if (!id(value, path)) return false;
    const existingPath = registeredIds.get(value);
    if (existingPath) fail(path, `duplicate identifier ${value}, already used at ${existingPath}`);
    else registeredIds.set(value, path);
    return true;
  };

  const root = object(content, 'content');
  for (const key of ['version', 'buildVersion']) {
    if (text(root[key], key, 80) && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(root[key] as string)) {
      fail(key, 'must be a semantic version');
    }
  }
  text(root.title, 'title', 80);

  const opening = object(root.opening, 'opening');
  register(opening.companyId, 'opening.companyId');
  text(opening.companyName, 'opening.companyName', 60);
  text(opening.seed, 'opening.seed', 128);
  for (const key of ['cashCents', 'cloudCU', 'memoryMU', 'rentCentsPerCUWeek', 'overheadCentsPerWeek']) {
    integer(opening[key], `opening.${key}`, 1);
  }
  integer(opening.waitlist, 'opening.waitlist');
  const allocation = object(opening.allocation, 'opening.allocation');
  let remaining = typeof opening.cloudCU === 'number' && Number.isSafeInteger(opening.cloudCU)
    ? opening.cloudCU : 0;
  for (const category of ['serving', 'development', 'research']) {
    if (integer(allocation[category], `opening.allocation.${category}`)) {
      remaining -= allocation[category] as number;
      if (remaining < 0) {
        fail('opening.allocation', 'total allocation exceeds rented cloud capacity');
        break;
      }
    }
  }

  const clock = object(root.clock, 'clock');
  integer(clock.secondsPerWeek, 'clock.secondsPerWeek', 1);
  const speeds = array(clock.speeds, 'clock.speeds');
  if (speeds.length !== 3 || speeds.some((speed, index) => speed !== [1, 2, 5][index])) {
    fail('clock.speeds', 'Wave 0 speeds must be [1, 2, 5]');
  }

  const model = object(root.seedModel, 'seedModel');
  register(model.id, 'seedModel.id');
  text(model.name, 'seedModel.name', 80);
  id(model.companyId, 'seedModel.companyId');
  if (model.companyId !== opening.companyId) fail('seedModel.companyId', 'must reference the opening company');
  enumValue(model.family, ['compact'], 'seedModel.family');
  enumValue(model.architecture, ['dense'], 'seedModel.architecture');
  enumValue(model.status, ['checkpoint'], 'seedModel.status');
  const capabilities = scores(model.capabilityBps, 'seedModel.capabilityBps');
  score(model.reliabilityBps, 'seedModel.reliabilityBps');
  if (integer(model.residentMU, 'seedModel.residentMU', 1)
    && typeof opening.memoryMU === 'number' && model.residentMU > opening.memoryMU) {
    fail('seedModel.residentMU', 'cannot exceed opening fleet memory');
  }
  text(model.source, 'seedModel.source');

  const data = object(root.starterData, 'starterData');
  register(data.id, 'starterData.id');
  text(data.name, 'starterData.name', 80);
  const rawValid = integer(data.rawUnits, 'starterData.rawUnits', 1);
  const readyValid = integer(data.readyUnits, 'starterData.readyUnits');
  if (rawValid && readyValid && (data.readyUnits as number) > (data.rawUnits as number)) {
    fail('starterData.readyUnits', 'cannot exceed raw data units');
  }
  score(data.qualityBps, 'starterData.qualityBps');
  scores(data.coverageBps, 'starterData.coverageBps');
  const rights = object(data.rights, 'starterData.rights');
  for (const right of ['hosted', 'weights', 'feedback']) {
    if (typeof rights[right] !== 'boolean') fail(`starterData.rights.${right}`, 'must be a boolean');
  }
  if (data.prepared !== false || data.readyUnits !== 0) {
    fail('starterData', 'Wave 0 starter data must be unprepared with zero ready units');
  }

  const preparation = object(root.preparation, 'preparation');
  integer(preparation.feeCents, 'preparation.feeCents', 1);
  coefficient(preparation.staffWeeks, 'preparation.staffWeeks');
  const training = object(root.firstTraining, 'firstTraining');
  register(training.id, 'firstTraining.id');
  text(training.name, 'firstTraining.name', 80);
  integer(training.workCUw, 'firstTraining.workCUw', 1);
  integer(training.relevantUnits, 'firstTraining.relevantUnits', 1);
  score(training.conversationTargetBps, 'firstTraining.conversationTargetBps');
  score(training.reliabilityAnchorBps, 'firstTraining.reliabilityAnchorBps');
  score(training.reliabilityTargetBps, 'firstTraining.reliabilityTargetBps');
  if (typeof training.conversationTargetBps === 'number' && typeof capabilities.conversation === 'number'
    && training.conversationTargetBps < capabilities.conversation) {
    fail('firstTraining.conversationTargetBps', 'must not be below the starting conversation score');
  }
  if (training.reliabilityAnchorBps !== model.reliabilityBps) {
    fail('firstTraining.reliabilityAnchorBps', 'must match the starting checkpoint reliability');
  }
  if (typeof training.reliabilityTargetBps === 'number' && typeof training.reliabilityAnchorBps === 'number'
    && training.reliabilityTargetBps < training.reliabilityAnchorBps) {
    fail('firstTraining.reliabilityTargetBps', 'must not be below the reliability anchor');
  }
  if (typeof training.relevantUnits === 'number' && typeof data.rawUnits === 'number'
    && training.relevantUnits > data.rawUnits) {
    fail('firstTraining.relevantUnits', 'cannot exceed available starter raw units');
  }
  const evaluation = object(root.evaluation, 'evaluation');
  integer(evaluation.workCUw, 'evaluation.workCUw', 1);
  coefficient(evaluation.researchStaffWeeks, 'evaluation.researchStaffWeeks');
  integer(evaluation.cases, 'evaluation.cases', 1);

  const sale = object(root.firstSale, 'firstSale');
  for (const key of ['minConversationBps', 'minReliabilityBps', 'shoppingBps', 'conversionBps', 'churnBps', 'servingHeadroomBps']) score(sale[key], `firstSale.${key}`);
  for (const key of ['defaultPriceCents', 'defaultAllowance', 'population', 'weeklyReach', 'reachPerCommercialFte', 'trialWork', 'exchangeWork', 'sessionMemory', 'deploymentStaff', 'trainingMemory', 'trainingWorkPerMl', 'minPriceCents', 'maxPriceCents', 'minAllowance', 'maxAllowance', 'maxCloudCU']) integer(sale[key], `firstSale.${key}`, 1);
  scores(sale.trainingTargetsBps, 'firstSale.trainingTargetsBps');
  for (const [minimum, value, maximum] of [['minPriceCents', 'defaultPriceCents', 'maxPriceCents'], ['minAllowance', 'defaultAllowance', 'maxAllowance']]) {
    if (typeof sale[minimum] === 'number' && typeof sale[value] === 'number' && typeof sale[maximum] === 'number'
      && ((sale[minimum] as number) > (sale[value] as number) || (sale[value] as number) > (sale[maximum] as number))) fail(`firstSale.${value}`, 'must fit within the declared limits');
  }

  const staff = array(root.staff, 'staff').map((value, index) => object(value, `staff[${index}]`));
  const staffIds: string[] = [];
  for (const [index, role] of staff.entries()) {
    const path = `staff[${index}]`;
    if (register(role.id, `${path}.id`)) staffIds.push(role.id);
    enumValue(role.id, ROLES, `${path}.id`);
    text(role.name, `${path}.name`, 80);
    const salaryValid = integer(role.weeklyCents, `${path}.weeklyCents`, 1);
    const recruitmentValid = integer(role.recruitmentCents, `${path}.recruitmentCents`, 1);
    integer(role.onboardingWeeks, `${path}.onboardingWeeks`, 1);
    if (salaryValid && recruitmentValid
      && BigInt(role.recruitmentCents as number) !== BigInt(role.weeklyCents as number) * BigInt(5)) {
      fail(`${path}.recruitmentCents`, 'must equal five weeks of salary');
    }
    if (role.availableOnResearchEntry !== undefined) id(role.availableOnResearchEntry, `${path}.availableOnResearchEntry`);
    if (role.id === 'hardware' && role.availableOnResearchEntry !== 'R16') {
      fail(`${path}.availableOnResearchEntry`, 'hardware specialists must unlock on entry to R16');
    }
    if (role.id !== 'hardware' && role.availableOnResearchEntry !== undefined) {
      fail(`${path}.availableOnResearchEntry`, 'only hardware specialists are research-gated in the opening catalog');
    }
  }
  sameMembers(staffIds, ROLES, 'staff');

  const hardware = array(root.hardware, 'hardware').map((value, index) => object(value, `hardware[${index}]`));
  const hardwareIds: string[] = [];
  for (const [index, item] of hardware.entries()) {
    const path = `hardware[${index}]`;
    if (register(item.id, `${path}.id`)) hardwareIds.push(item.id);
    text(item.name, `${path}.name`, 80);
    for (const key of ['purchaseCentsPerCU', 'cloudCentsPerCUWeek', 'variableCentsPerCUw', 'memoryMUPerCU']) {
      integer(item[key], `${path}.${key}`, 1);
    }
    for (const key of ['trainingMultiplier', 'servingMultiplier', 'powerPerCU']) coefficient(item[key], `${path}.${key}`);
  }
  sameMembers(hardwareIds, HARDWARE_IDS, 'hardware');
  const generalHardware = hardware.find(item => item.id === 'general');
  if (generalHardware) {
    if (opening.rentCentsPerCUWeek !== generalHardware.cloudCentsPerCUWeek) {
      fail('opening.rentCentsPerCUWeek', 'must match general-purpose cloud hardware pricing');
    }
    if ([opening.cloudCU, opening.memoryMU, generalHardware.memoryMUPerCU]
      .every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
      const suppliedMemory = BigInt(opening.cloudCU as number) * BigInt(generalHardware.memoryMUPerCU as number);
      if (suppliedMemory !== BigInt(opening.memoryMU as number) * BigInt(RESOURCE_SCALE)) {
        fail('opening.memoryMU', 'must match the rented general-purpose fleet memory');
      }
    }
  }

  const infrastructure = object(root.infrastructure, 'infrastructure');
  const boundedInfrastructureInteger = (value: unknown, path: string, maximum: number): value is number => {
    if (!integer(value, path, 1)) return false;
    if (value > maximum) { fail(path, `exceeds the supported maximum of ${maximum}`); return false; }
    return true;
  };
  const rackValid = boundedInfrastructureInteger(infrastructure.rackCU, 'infrastructure.rackCU', 8 * RESOURCE_SCALE);
  if (rackValid && infrastructure.rackCU !== 8 * RESOURCE_SCALE) fail('infrastructure.rackCU', 'this wave installs whole eight-CU racks');
  boundedInfrastructureInteger(infrastructure.deliveryWeeks, 'infrastructure.deliveryWeeks', 104);
  boundedInfrastructureInteger(infrastructure.installationStaffWeeks, 'infrastructure.installationStaffWeeks', 16 * RESOURCE_SCALE);
  const rackLimitValid = boundedInfrastructureInteger(infrastructure.maxRacksPerCompany, 'infrastructure.maxRacksPerCompany', 64);
  boundedInfrastructureInteger(infrastructure.maxFacilitiesPerCompany, 'infrastructure.maxFacilitiesPerCompany', 4);
  for (const key of ['colocationCentsPerRackWeek', 'ownedMaintenanceCentsPerCUWeek', 'siteFixedCentsPerWeek']) {
    boundedInfrastructureInteger(infrastructure[key], `infrastructure.${key}`, 100_000_000);
  }
  for (const key of ['colocationStaffPerRack', 'siteBaseStaff', 'siteStaffPer16CU']) {
    boundedInfrastructureInteger(infrastructure[key], `infrastructure.${key}`, 4 * RESOURCE_SCALE);
  }
  const slotsValid = boundedInfrastructureInteger(infrastructure.siteSlotsCU, 'infrastructure.siteSlotsCU', 64 * RESOURCE_SCALE);
  if (slotsValid && rackValid && (infrastructure.siteSlotsCU as number) % (infrastructure.rackCU as number) !== 0) {
    fail('infrastructure.siteSlotsCU', 'must hold a whole number of eight-CU racks');
  }
  for (const key of ['sitePowerUnits', 'siteCoolingUnits']) boundedInfrastructureInteger(infrastructure[key], `infrastructure.${key}`, 256 * RESOURCE_SCALE);
  const fabricValid = boundedInfrastructureInteger(infrastructure.crossRackTrainingBps, 'infrastructure.crossRackTrainingBps', 10_000);
  const stageIds = ['reservation', 'preparation', 'shell', 'power-cooling', 'network-storage', 'acceptance'];
  const stages = array(infrastructure.stages, 'infrastructure.stages');
  if (stages.length !== stageIds.length) fail('infrastructure.stages', 'must contain the six sequential standard-facility stages');
  for (const [index, value] of stages.entries()) {
    const path = `infrastructure.stages[${index}]`, stage = object(value, path);
    if (!id(stage.id, `${path}.id`) || stage.id !== stageIds[index]) fail(`${path}.id`, `must be ${stageIds[index] ?? 'a supported standard stage'} in this sequence`);
    text(stage.name, `${path}.name`, 80);
    boundedInfrastructureInteger(stage.costCents, `${path}.costCents`, 100_000_000);
    boundedInfrastructureInteger(stage.elapsedWeeks, `${path}.elapsedWeeks`, 104);
    boundedInfrastructureInteger(stage.staffWeeks, `${path}.staffWeeks`, 16 * RESOURCE_SCALE);
  }
  // Runtime hardware throughput is represented in basis points; reject content
  // that would silently round to zero or overflow an owned rack/fleet quote.
  for (const [index, item] of hardware.entries()) {
    for (const key of ['trainingMultiplier', 'servingMultiplier']) {
      const value = item[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0
        && (!Number.isSafeInteger(value * 10_000) || value > 100)) fail(`hardware[${index}].${key}`, 'must fit positive basis-point precision and be at most 100');
    }
    if (fabricValid && typeof item.trainingMultiplier === 'number' && Number.isFinite(item.trainingMultiplier)
      && item.trainingMultiplier > 0 && item.trainingMultiplier * (infrastructure.crossRackTrainingBps as number) < 1) {
      fail(`hardware[${index}].trainingMultiplier`, 'combined hardware and cross-rack throughput must remain at least one basis point');
    }
    if (rackValid && typeof item.purchaseCentsPerCU === 'number' && Number.isSafeInteger(item.purchaseCentsPerCU) && item.purchaseCentsPerCU > 0
      && BigInt(infrastructure.rackCU as number) * BigInt(item.purchaseCentsPerCU) / BigInt(RESOURCE_SCALE) > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(`hardware[${index}].purchaseCentsPerCU`, 'an eight-CU rack purchase exceeds safe money precision');
    }
    if (rackValid && rackLimitValid && typeof item.memoryMUPerCU === 'number' && Number.isSafeInteger(item.memoryMUPerCU) && item.memoryMUPerCU > 0
      && BigInt(infrastructure.rackCU as number) * BigInt(infrastructure.maxRacksPerCompany as number) * BigInt(item.memoryMUPerCU) / BigInt(RESOURCE_SCALE) > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail(`hardware[${index}].memoryMUPerCU`, 'the maximum owned fleet exceeds safe memory precision');
    }
  }

  const research = array(root.research, 'research').map((value, index) => object(value, `research[${index}]`));
  const researchIds: string[] = [];
  const researchMap = new Map<string, RecordValue>();
  const prerequisites = new Map<string, string[]>();
  const roots: string[] = [];
  const children: string[] = [];
  for (const [index, item] of research.entries()) {
    const path = `research[${index}]`;
    const validId = register(item.id, `${path}.id`);
    if (validId) {
      researchIds.push(item.id as string);
      researchMap.set(item.id as string, item);
      (item.parentId === undefined ? roots : children).push(item.id as string);
    }
    text(item.name, `${path}.name`, 80);
    text(item.description, `${path}.description`);
    integer(item.feeCents, `${path}.feeCents`, 1);
    integer(item.workCUw, `${path}.workCUw`, 1);
    coefficient(item.staffWeeks, `${path}.staffWeeks`);
    enumValue(item.role, staffIds, `${path}.role`);
    if (item.implemented !== ['R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','R12','R13','R14','R15','R16','R1A','R2A','R3B','R5A','R6A','R7A','R8A','R12A','R4B','R4C','R9A','R10A','R11A','S1','S2','S3','S4','S5','S6',...DESIGN_RESEARCH_IDS,...CUSTOMIZATION_RESEARCH_IDS].includes(String(item.id))) fail(`${path}.implemented`, 'research availability must match the implemented research programs');
    const requires = array(item.requires, `${path}.requires`);
    const validRequires: string[] = [];
    for (const [requireIndex, requirement] of requires.entries()) {
      if (id(requirement, `${path}.requires[${requireIndex}]`)) validRequires.push(requirement);
    }
    if (new Set(validRequires).size !== validRequires.length) fail(`${path}.requires`, 'cannot repeat a prerequisite');
    if (validId) prerequisites.set(item.id as string, validRequires);
    if (item.parentId !== undefined) id(item.parentId, `${path}.parentId`);
  }
  sameMembers(roots, [...CORE_IDS, 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', ...DESIGN_RESEARCH_IDS, ...CUSTOMIZATION_RESEARCH_IDS], 'research.core');
  sameMembers(children, Object.keys(PRIORITY_PARENTS), 'research.prioritized');
  if (research.length !== 35 + DESIGN_RESEARCH_IDS.length + CUSTOMIZATION_RESEARCH_IDS.length) fail('research', 'missing or extra research programs');
  for (const [researchId, item] of researchMap) {
    const requires = prerequisites.get(researchId) ?? [];
    for (const prerequisite of requires) {
      if (!researchMap.has(prerequisite)) fail(`research.${researchId}.requires`, `unknown prerequisite ${prerequisite}`);
      if (prerequisite === researchId) fail(`research.${researchId}.requires`, 'cannot depend on itself');
    }
    if (item.parentId !== undefined) {
      const parent = item.parentId;
      if (typeof parent !== 'string' || !CORE_IDS.includes(parent) || !researchMap.has(parent)) {
        fail(`research.${researchId}.parentId`, 'must reference an existing core research program');
      } else if (!requires.includes(parent)) {
        fail(`research.${researchId}.requires`, 'must include its parent program');
      }
      if (PRIORITY_PARENTS[researchId] !== parent) {
        fail(`research.${researchId}.parentId`, 'does not match the prioritized applied-research catalog');
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (researchId: string, trail: string[]): void => {
    if (visiting.has(researchId)) {
      fail('research', `dependency cycle: ${[...trail, researchId].join(' -> ')}`);
      return;
    }
    if (visited.has(researchId)) return;
    visiting.add(researchId);
    for (const prerequisite of prerequisites.get(researchId) ?? []) {
      if (researchMap.has(prerequisite)) visit(prerequisite, [...trail, researchId]);
    }
    visiting.delete(researchId);
    visited.add(researchId);
  };
  for (const researchId of researchIds) visit(researchId, []);

  // Hiring on research ENTRY breaks the intentional R16/hardware dependency:
  // entering an eligible program exposes its role before that program finishes.
  const availableRoles = new Set(staff.filter(role => role.availableOnResearchEntry === undefined)
    .map(role => role.id).filter((role): role is string => typeof role === 'string'));
  for (const role of staff) {
    if (typeof role.availableOnResearchEntry === 'string' && !researchMap.has(role.availableOnResearchEntry)) {
      fail(`staff.${String(role.id)}.availableOnResearchEntry`, 'must reference a known research program');
    }
  }
  const reachable = new Set<string>();
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const [researchId, item] of researchMap) {
      if (reachable.has(researchId) || !(prerequisites.get(researchId) ?? []).every(required => reachable.has(required))) continue;
      for (const role of staff) {
        if (role.availableOnResearchEntry === researchId && typeof role.id === 'string') {
          availableRoles.add(role.id);
        }
      }
      if (typeof item.role === 'string' && availableRoles.has(item.role)) {
        reachable.add(researchId);
        madeProgress = true;
      }
    }
  }
  const unreachable = researchIds.filter(researchId => !reachable.has(researchId));
  if (unreachable.length) fail('research', `unreachable prerequisites or role unlocks: ${unreachable.join(', ')}`);

  const roadmap = array(root.roadmap, 'roadmap');
  const waves = new Set<number>();
  for (const [index, value] of roadmap.entries()) {
    const item = object(value, `roadmap[${index}]`);
    const path = `roadmap[${index}]`;
    if (integer(item.wave, `${path}.wave`)) {
      if (waves.has(item.wave)) fail(`${path}.wave`, 'duplicate roadmap wave');
      waves.add(item.wave);
      if (item.wave > 30) fail(`${path}.wave`, 'The roadmap contains waves 0 through 30');
    }
    text(item.title, `${path}.title`, 80);
    text(item.description, `${path}.description`);
    enumValue(item.status, item.wave === 30 ? ['current'] : ['complete'], `${path}.status`);
  }
  if (roadmap.length !== 31 || waves.size !== 31) {
    fail('roadmap', 'must include each wave from 0 through 30 exactly once');
  }
  return errors;
}
