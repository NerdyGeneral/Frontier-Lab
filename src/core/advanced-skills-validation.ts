import type { AdvancedScores } from '../contracts/advanced-skills';
import type { GameState, ModelVersion } from '../contracts/types';
import { ADVANCED_DATA_CATALOG, ADVANCED_DOMAINS, ADVANCED_EVALUATION_SUITE } from '../content/advanced-skills';
import { advancedScores, advancedTrainingOutcome, emptyAdvancedScores, getAdvancedCorpusEvidence } from '../modules/advanced-skills';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function scores(value: unknown, label: string, bounded = true): asserts value is AdvancedScores {
  check(record(value) && Object.keys(value).sort().join() === [...ADVANCED_DOMAINS].sort().join(), `${label} needs exactly reasoning, long context and multimodal scores.`);
  for (const domain of ADVANCED_DOMAINS) {
    const number = (value as AdvancedScores)[domain]; checkedInteger(number);
    check(!bounded || number <= 10000, `${label} is outside the score range.`);
  }
}
function modelOutcome(state: GameState, model: ModelVersion): AdvancedScores | undefined {
  if (model.runtimeVariant) return state.slices.models.versions[model.runtimeVariant.sourceModelId]?.advancedCapabilities;
  const run = model.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId] : undefined;
  if (!run) return undefined;
  if (!run.plan?.advanced) return run.plan?.kind === 'foundation' ? undefined : state.slices.models.versions[run.baseModelId]?.advancedCapabilities;
  const point = run.plan.checkpoints.find(item => model.id === (item.atBps === 10000 ? run.outputModelId
    : 'checkpoint-' + run.id + (item.atBps === 5000 ? '' : '-' + item.atBps)));
  check(point, 'Advanced skill model has no earned checkpoint.');
  return advancedTrainingOutcome(run, mulDiv(run.requiredWork, point!.atBps, 10000, 'ceil'));
}

/** Validate earned advanced skills without changing any historical four-domain result. */
export function assertAdvancedSkillsState(state: GameState): void {
  for (const packet of Object.values(state.slices.data.packets)) {
    if (packet.advancedCoverageBps !== undefined) scores(packet.advancedCoverageBps, 'Advanced data coverage');
    const catalog = ADVANCED_DATA_CATALOG.find(item => item.id === packet.catalogId);
    if (packet.parentPacketId) {
      const parent = state.slices.data.packets[packet.parentPacketId];
      check(same(packet.advancedCoverageBps ?? null, parent?.advancedCoverageBps ?? null), 'Data revision invented advanced skill coverage.');
    } else check(same(packet.advancedCoverageBps ?? null, catalog?.advancedCoverageBps ?? null), 'Advanced skill coverage has no authored data source.');
  }
  for (const run of Object.values(state.slices.models.trainingRuns)) {
    if (run.evidence.advancedCoverageBps !== undefined) scores(run.evidence.advancedCoverageBps, 'Saved advanced data coverage');
    const plan = run.plan, receipt = plan?.advanced;
    if (!receipt) continue;
    check(record(receipt) && Object.keys(receipt).sort().join() === ['anchors','ceilings','corpus','foundation','requiredEvidence','targets'].sort().join(), 'Advanced training receipt contains missing or unknown fields.');
    const base = state.slices.models.versions[run.baseModelId];
    check(base && base.companyId === run.companyId && typeof receipt.foundation === 'boolean'
      && receipt.foundation === (plan!.kind === 'foundation'), 'Advanced training changed its reference model or foundation choice.');
    scores(receipt.anchors, 'Advanced training anchors'); scores(receipt.targets, 'Advanced training targets'); scores(receipt.ceilings, 'Advanced training ceilings');
    checkedInteger(receipt.requiredEvidence); check(receipt.requiredEvidence > 0, 'Advanced training has no evidence requirement.');
    check(same(receipt.anchors, receipt.foundation ? emptyAdvancedScores() : advancedScores(base)), 'Advanced training changed the selected parent skill scores.');
    check(same(receipt.corpus, getAdvancedCorpusEvidence(state, run.companyId, plan!.corpus.packetIds)), 'Advanced training changed its frozen prepared evidence.');
    scores(receipt.corpus.relevantUnits, 'Advanced relevant examples', false); scores(receipt.corpus.qualityBps, 'Advanced evidence quality');
    for (const domain of ADVANCED_DOMAINS) check(receipt.targets[domain] <= receipt.ceilings[domain], 'Advanced training target exceeds its design ceiling.');
  }
  for (const model of Object.values(state.slices.models.versions)) {
    if (model.advancedCapabilities !== undefined) scores(model.advancedCapabilities, 'Model advanced capabilities');
    check(same(model.advancedCapabilities ?? null, modelOutcome(state, model) ?? null), 'Model advanced skills differ from paid training, inherited scores or its saved checkpoint.');
  }
  for (const report of Object.values(state.slices.models.reports)) {
    if (report.suiteId !== ADVANCED_EVALUATION_SUITE.id) {
      check(report.advancedCapabilities === undefined, 'An ordinary report invented advanced capability evidence.');
      continue;
    }
    const model = state.slices.models.versions[report.modelId];
    check(model, 'Advanced evaluation has no saved model.'); scores(report.advancedCapabilities, 'Advanced report scores');
    check(same(report.advancedCapabilities, advancedScores(model)), 'Advanced evaluation changed its tested model scores.');
    check(report.cases.length === ADVANCED_EVALUATION_SUITE.cases && report.basicChatEligible === false, 'Advanced evaluation changed its case count or claimed unrelated release evidence.');
    for (const [index, test] of report.cases.entries()) {
      check(test.domain === ADVANCED_DOMAINS[index % ADVANCED_DOMAINS.length]
        && test.difficultyBps === 3000 + Math.floor(index / ADVANCED_DOMAINS.length) % 5 * 1000,
      'Advanced held-out case skill or difficulty was changed.');
    }
  }
}
