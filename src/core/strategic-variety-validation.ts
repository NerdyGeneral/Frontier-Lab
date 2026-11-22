import type { CommandPayload, GameState } from '../contracts/types';
import type { ChapterId, ChapterProof } from '../contracts/strategic-variety';
import { CHAPTERS, PRODUCT_AUDIENCES, ROUTING_POLICIES } from '../content/strategic-variety';
import { hasCompletedModelTraining } from '../modules/campaign-progress';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { canonicalStateHash } from './canonical';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`); }
function keys(value: object, expected: readonly string[], label: string): void {
  check(Object.keys(value).sort().join() === [...expected].sort().join(), `${label} has unknown or missing fields.`);
}
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function integer(value: number, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void {
  check(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} is outside its allowed range.`);
}
function accepted(state: GameState, id: string, label: string, atWeek: number, exact = false): void {
  identifier(id, label);
  const receipt = state.commandReceipts[id];
  check(receipt?.status === 'accepted' && (exact ? receipt.week === atWeek : receipt.week <= atWeek), `${label} has no accepted command at the recorded boundary.`);
}

export function assertStrategicVarietyCommand(payload: CommandPayload): void {
  if (payload.kind === 'set_product_strategy') {
    keys(payload, ['kind', 'productId', 'audience', 'routingPolicy'], 'Product strategy command');
    identifier(payload.productId, 'Product strategy product');
    check(Object.hasOwn(PRODUCT_AUDIENCES, payload.audience) && Object.hasOwn(ROUTING_POLICIES, payload.routingPolicy), 'Choose an authored audience and routing policy.');
  } else if (payload.kind === 'select_chapter') {
    keys(payload, ['kind', 'chapterId'], 'Chapter selection command');
    check(Object.hasOwn(CHAPTERS, payload.chapterId), 'Choose an authored chapter.');
  }
}

function proofRow(state: GameState, id: ChapterId, proof: ChapterProof, selectedWeek: number): void {
  record(proof, 'Chapter proof');
  keys(proof, ['week', 'productId', 'modelId', 'reportIds', 'paidAccounts', 'billedCents', 'fulfillmentBps', 'revenueCents', 'operatingExpenseCents',
    'routingPolicy', 'strategyCommandId', 'routingInstallationId', 'secondaryModelId'], 'Chapter proof');
  integer(proof.week, 'Chapter proof week', selectedWeek, state.week);
  identifier(proof.productId, 'Chapter product'); identifier(proof.modelId, 'Chapter model');
  const product = state.slices.products.offers[proof.productId], model = state.slices.models.versions[proof.modelId];
  check(product?.companyId === state.playerCompanyId && model?.companyId === state.playerCompanyId && hasCompletedModelTraining(state, model), 'Chapter proof needs an owned product and a model trained by this lab.');
  integer(proof.paidAccounts, 'Chapter paying accounts', 1); integer(proof.billedCents, 'Chapter paid service', 1);
  integer(proof.fulfillmentBps, 'Chapter fulfilled service', id === 'first-product' ? 9000 : 9500, 10000);
  integer(proof.revenueCents, 'Chapter operating revenue'); integer(proof.operatingExpenseCents, 'Chapter operating expense');
  check(Object.hasOwn(ROUTING_POLICIES, proof.routingPolicy), 'Chapter routing policy is invalid.');
  if (proof.strategyCommandId !== null) accepted(state, proof.strategyCommandId, 'Chapter strategy', proof.week);
  else check(proof.routingPolicy === 'balanced', 'An explicit chapter routing choice needs a strategy command.');
  check(Array.isArray(proof.reportIds) && proof.reportIds.length >= 1 && proof.reportIds.length <= 2 && new Set(proof.reportIds).size === proof.reportIds.length, 'Chapter evaluation evidence is missing or duplicated.');
  const reports = proof.reportIds.map(reportId => {
    identifier(reportId, 'Chapter evaluation'); const report = state.slices.models.reports[reportId];
    check(report?.companyId === state.playerCompanyId && report.modelId === model.id && report.heldOut && !report.scenarioStart && report.week <= proof.week,
      'Chapter evaluation must belong to this exact model and precede the paid-service week.');
    const run = Object.values(state.slices.models.evaluationRuns).find(item => item.reportId === reportId);
    check(run?.status === 'complete' && run.completedWeek === report.week && run.modelId === model.id, 'Chapter evaluation must come from completed paid work.');
    return report;
  });
  check(reports.some(report => isCapabilitySuite(report.suiteId)), 'Chapter needs a paid capability evaluation.');
  if (id === 'advanced-specialist' || id === 'frontier-lab') check(reports.some(report => report.suiteId === 'advanced-capabilities-1'), 'This chapter needs a paid advanced evaluation on the exact model.');
  const advanced = model.advancedCapabilities ?? { reasoning: 0, longContext: 0, multimodal: 0 };
  if (id === 'advanced-specialist') check(Math.max(...Object.values(advanced)) >= 7000, 'Advanced specialist has not reached a 70-point advanced skill.');
  if (proof.routingInstallationId !== null) {
    identifier(proof.routingInstallationId, 'Chapter routing installation');
    check(proof.routingInstallationId.startsWith('efficiency:'), 'Chapter routing installation identity is invalid.');
    accepted(state, proof.routingInstallationId.slice('efficiency:'.length), 'Chapter routing installation', proof.week - 1);
    identifier(proof.secondaryModelId, 'Chapter secondary model');
    check(state.slices.models.versions[proof.secondaryModelId!]?.companyId === state.playerCompanyId && proof.secondaryModelId !== model.id,
      'Chapter routing must use two different owned models.');
  } else check(proof.secondaryModelId === null, 'Chapter secondary model is missing its routing installation.');
  if (id === 'efficient-portfolio') check(proof.routingPolicy === 'economy' && proof.strategyCommandId !== null && proof.routingInstallationId !== null && proof.secondaryModelId !== null,
    'Efficient portfolio needs a captured two-model Economy route.');
  if (id === 'frontier-lab') check(model.family === 'frontier' && !!model.modelDesign && Math.min(...Object.values(model.capabilityBps)) >= 8000 && Math.min(...Object.values(advanced)) >= 6000,
    'Frontier chapter needs its custom architecture and all seven measured skill thresholds.');
  if (id === 'efficient-portfolio' || id === 'frontier-lab') check(proof.revenueCents > proof.operatingExpenseCents, 'This chapter needs a positive operating surplus.');
}

function proofSequence(state: GameState, id: ChapterId, proof: ChapterProof[], selectedWeek: number, complete: boolean): void {
  check(Array.isArray(proof) && proof.length <= CHAPTERS[id].weeks && (!complete || proof.length === CHAPTERS[id].weeks), 'Chapter proof has the wrong number of weeks.');
  for (let index = 0; index < proof.length; index++) {
    proofRow(state, id, proof[index], selectedWeek);
    if (index) check(proof[index].week === proof[index - 1].week + 1 && proof[index].productId === proof[0].productId && proof[index].modelId === proof[0].modelId,
      'Chapter progress must be consecutive weeks of the same product and model.');
  }
}

export function validateStrategicVarietyState(state: GameState): void {
  for (const product of Object.values(state.slices.products.offers)) {
    if (product.strategy === undefined) continue;
    const strategy = product.strategy;
    record(strategy, 'Product strategy'); keys(strategy, ['audience', 'routingPolicy', 'updatedWeek', 'commandId'], 'Product strategy');
    check(Object.hasOwn(PRODUCT_AUDIENCES, strategy.audience) && Object.hasOwn(ROUTING_POLICIES, strategy.routingPolicy), 'Product strategy contains an unknown choice.');
    integer(strategy.updatedWeek, 'Product strategy boundary', product.createdWeek, state.week);
    accepted(state, strategy.commandId, 'Product strategy', strategy.updatedWeek, true);
  }
  for (const installation of Object.values(state.slices.products.efficiencyInstalls ?? {})) {
    if (installation.routingProtocol !== undefined) check(installation.kind === 'routing' && installation.routingProtocol === 2, 'Only a routing installation can use the seven-skill routing protocol.');
  }
  const chapters = state.slices.campaign.chapters;
  if (chapters === undefined) return;
  record(chapters, 'Company chapters'); keys(chapters, ['active', 'selectedWeek', 'selectionCommandId', 'streak', 'progress', 'completed'], 'Company chapters');
  check(chapters.active !== null && Object.hasOwn(CHAPTERS, chapters.active), 'A saved chapter selection must name an authored goal.');
  integer(chapters.selectedWeek, 'Chapter selection boundary', 0, state.week);
  accepted(state, chapters.selectionCommandId, 'Chapter selection', chapters.selectedWeek, true);
  const id = chapters.active!;
  integer(chapters.streak, 'Chapter consecutive weeks', 0, CHAPTERS[id].weeks);
  proofSequence(state, id, chapters.progress, chapters.selectedWeek, false);
  check(chapters.streak === chapters.progress.length && (!chapters.progress.length || chapters.progress.at(-1)!.week <= state.week), 'Chapter streak differs from its earned proof.');
  record(chapters.completed, 'Completed chapters');
  check(Object.keys(chapters.completed).length <= Object.keys(CHAPTERS).length, 'Completed chapter history exceeds the authored chapters.');
  for (const [chapterId, achievement] of Object.entries(chapters.completed)) {
    check(Object.hasOwn(CHAPTERS, chapterId), 'Completed chapter is unknown.');
    record(achievement, 'Chapter achievement'); keys(achievement!, ['id', 'selectedWeek', 'selectionCommandId', 'completedWeek', 'proof'], 'Chapter achievement');
    check(achievement!.id === chapterId, 'Chapter achievement identity changed.');
    integer(achievement!.selectedWeek, 'Earned chapter selection', 0, state.week);
    accepted(state, achievement!.selectionCommandId, 'Earned chapter selection', achievement!.selectedWeek, true);
    integer(achievement!.completedWeek, 'Chapter completion boundary', achievement!.selectedWeek, state.week);
    proofSequence(state, chapterId as ChapterId, achievement!.proof, achievement!.selectedWeek, true);
    check(achievement!.proof.at(-1)!.week === achievement!.completedWeek, 'Chapter completion does not match the final qualifying week.');
    if (chapterId === id) check(chapters.selectedWeek === achievement!.selectedWeek && chapters.selectionCommandId === achievement!.selectionCommandId
      && canonicalStateHash(chapters.progress) === canonicalStateHash(achievement!.proof), 'Active completed chapter differs from its permanent achievement.');
  }
  if (!chapters.completed[id]) check(chapters.streak < CHAPTERS[id].weeks, 'A completed chapter streak is missing its permanent achievement.');
}
