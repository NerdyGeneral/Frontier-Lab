import { FEEDBACK_CONSENTS, FEEDBACK_RULES as RULES, FEEDBACK_SAMPLING } from '../content/wave10-feedback';
import type { CommandPayload, Deployment, GameContent, GameState } from '../contracts/types';
import type { FeedbackPaidUsage, FeedbackStudy, FeedbackWeekReceipt } from '../contracts/wave10-feedback';
import { feedbackPaidUsage, feedbackResearchReady, feedbackRowCounts, feedbackWeekSourceId } from '../modules/feedback';
import { inheritedModelRights } from '../modules/model-runtime';
import { activeEfficiency } from '../modules/product-efficiency';
import { segmentForProduct } from '../modules/product-models';
import { releaseModelFingerprint } from '../modules/release-rehearsals';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';
import { RUNTIME_GUARDRAIL_PROFILES } from '../content/wave12-guardrails';
import { BASE_BEHAVIOR } from '../modules/lab-planner';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`);
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}

export function assertFeedbackCommand(payload: CommandPayload): void {
  if (payload.kind === 'start_feedback_study') {
    identifier(payload.productId, 'Feedback product');
    check(FEEDBACK_SAMPLING.some(item => item.id === payload.sampling), 'Feedback sampling method is invalid.');
    check(FEEDBACK_CONSENTS.some(item => item.id === payload.consent), 'Feedback consent scope is invalid.');
  } else if (payload.kind === 'cancel_feedback_study') identifier(payload.studyId, 'Feedback study');
}

/** Paid release operations replace live deployment objects; their admitted receipts remain. */
function assertDeployment(deployment: Deployment, study: FeedbackStudy, state: GameState, content: GameContent, capturedWeek: number, serving: boolean): void {
  record(deployment, 'Frozen feedback deployment');
  for (const value of [deployment.id, deployment.companyId, deployment.productId, deployment.modelId]) identifier(value, 'Feedback deployment identity');
  for (const value of [deployment.startedWeek, deployment.requiredStaff, deployment.completedStaff]) checkedInteger(value, 'Feedback deployment work');
  check(deployment.companyId === study.companyId && deployment.productId === study.productId && deployment.startedWeek <= capturedWeek
    && state.slices.models.versions[deployment.modelId]?.companyId === study.companyId && deployment.completedStaff <= deployment.requiredStaff
    && ['building', 'ready', 'active'].includes(deployment.status), 'Frozen feedback deployment ownership, chronology or work is invalid.');
  check(typeof deployment.lastBottleneck === 'string' && deployment.lastBottleneck.length <= 2000
    && !/[\u0000-\u001f\u007f]/.test(deployment.lastBottleneck), 'Frozen feedback deployment explanation is invalid.');
  if (deployment.readyWeek !== null) {
    checkedInteger(deployment.readyWeek, 'Feedback deployment availability');
    check(deployment.readyWeek >= deployment.startedWeek && deployment.completedStaff === deployment.requiredStaff,
      'Feedback deployment became available before paid deployment work finished.');
  }
  check(deployment.status === 'building' ? deployment.readyWeek === null : deployment.readyWeek !== null, 'Feedback deployment status and availability disagree.');
  if (serving) check(deployment.status === 'active' && deployment.readyWeek !== null && deployment.readyWeek <= capturedWeek,
    'Feedback collected paid responses from an unavailable deployment.');
  if (deployment.scenarioStart) {
    check(deployment.companyId !== state.playerCompanyId && !!state.slices.markets.rivals[deployment.companyId]
      && deployment.startedWeek === 0 && deployment.readyWeek === 0 && deployment.requiredStaff === 0,
    'Feedback source invented an unpaid scenario deployment.');
  } else {
    check(deployment.requiredStaff === content.firstSale.deploymentStaff, 'Feedback source changed its paid deployment requirement.');
    if (deployment.id.startsWith('deployment:')) {
      const command = state.commandReceipts[deployment.id.slice('deployment:'.length)];
      check(command?.status === 'accepted' && command.week === deployment.startedWeek, 'Feedback source has no admitted ordinary deployment command.');
    } else {
      const rollback = deployment.id.startsWith('rollback-deployment:'), prefix = rollback ? 'rollback-deployment:' : 'prepared-deployment:';
      check(deployment.id.startsWith(prefix), 'Feedback source deployment identity is unsupported.');
      const release = state.slices.products.preparedReleases?.[deployment.id.slice(prefix.length)];
      const work = rollback ? release?.rollback : release;
      check(release?.companyId === study.companyId && release.productId === study.productId && work
        && deployment.modelId === (rollback ? release.sourceModelId : release.candidateModelId)
        && deployment.startedWeek === work.startedWeek && deployment.readyWeek === work.cutoverWeek
        && (rollback ? release.rollback?.restoredDeploymentId === deployment.id : release.candidateDeploymentId === deployment.id),
      'Feedback source lacks its paid prepared-handover or rollback receipt.');
    }
  }
  const live = state.slices.products.deployments[deployment.id];
  if (live) check(live.companyId === deployment.companyId && live.productId === deployment.productId && live.modelId === deployment.modelId
    && live.startedWeek === deployment.startedWeek && live.requiredStaff === deployment.requiredStaff && live.completedStaff >= deployment.completedStaff
    && (deployment.readyWeek === null || live.readyWeek === deployment.readyWeek), 'Frozen feedback deployment differs from its still-live immutable identity.');
}

function assertPaidUsage(usage: FeedbackPaidUsage, row: FeedbackWeekReceipt, study: FeedbackStudy, state: GameState): void {
  record(usage, 'Feedback paid usage');
  for (const value of [usage.paidAccounts, usage.paidRequestedExchanges, usage.paidRequestedWork, usage.paidExecutedWork,
    usage.paidCompletedExchanges, usage.errorBps, usage.confidentErrorBps, usage.falseRefusalBps, usage.billedCents]) checkedInteger(value, 'Feedback paid usage quantity');
  check(usage.errorBps <= 10000 && usage.confidentErrorBps <= usage.errorBps && usage.falseRefusalBps <= 10000,
    'Feedback behavior must use the bounded actual serving meter.');
  if (usage.guardrail !== undefined) {
    const captured = usage.guardrail;
    record(captured, 'Feedback runtime guardrail');
    check(Object.keys(captured).sort().join() === ['installationId', 'profile', 'bindingFingerprint', 'checkingApplied', 'baselineFalseRefusalBps', 'addedFalseRefusalBps'].sort().join(),
      'Feedback runtime attribution contains an unknown or missing field.');
    identifier(captured.installationId, 'Feedback guardrail installation');
    check(['balanced', 'strict'].includes(captured.profile) && typeof captured.checkingApplied === 'boolean', 'Feedback guardrail profile or checking state is invalid.');
    const installation = state.slices.products.runtimeGuardrails?.[captured.installationId];
    check(installation && installation.companyId === study.companyId && installation.productId === study.productId
      && installation.profile === captured.profile && installation.bindingFingerprint === captured.bindingFingerprint
      && installation.availableWeek !== null && installation.availableWeek <= row.week && installation.audit
      && installation.binding.primary.modelId === row.observedModelId
      && (installation.binding.secondary?.modelId ?? null) === row.routingModelId,
    'Feedback runtime attribution lacks its exact available model and routed checker.');
    checkedInteger(captured.baselineFalseRefusalBps); checkedInteger(captured.addedFalseRefusalBps);
    const binding = installation!.binding, primary = state.slices.models.versions[binding.primary.modelId];
    const primaryFalse = (primary.behavior ?? BASE_BEHAVIOR).falseRefusalBps;
    const secondaryFalse = binding.secondary ? (state.slices.models.versions[binding.secondary.modelId].behavior ?? BASE_BEHAVIOR).falseRefusalBps : primaryFalse;
    const baseline = mulDiv(primaryFalse, 10000 - binding.secondaryShareBps, 10000) + mulDiv(secondaryFalse, binding.secondaryShareBps, 10000);
    const added = captured.checkingApplied ? mulDiv(Math.max(0, 10000 - usage.errorBps - baseline), RUNTIME_GUARDRAIL_PROFILES[captured.profile].allowedBlockBps, 10000) : 0;
    check(captured.baselineFalseRefusalBps === baseline && captured.addedFalseRefusalBps === added
      && usage.falseRefusalBps === baseline + added && (usage.paidCompletedExchanges === 0 || captured.checkingApplied),
    'Feedback runtime false refusals do not match the frozen benign checker effect.');
  }
  const segments = segmentForProduct(study.productKind), population = segments.reduce((sum, segment) => sum + segment.population, 0);
  check(usage.paidAccounts <= population && usage.paidRequestedExchanges <= usage.paidAccounts * Math.max(...segments.map(segment => segment.exchanges))
    && usage.paidExecutedWork <= usage.paidRequestedWork && usage.paidCompletedExchanges <= usage.paidRequestedExchanges,
  'Feedback paid demand exceeds its finite market, requested work, or completed paid exchanges.');
  check(usage.paidCompletedExchanges === (usage.paidRequestedWork > 0 ? mulDiv(usage.paidExecutedWork, usage.paidRequestedExchanges, usage.paidRequestedWork) : 0),
    'Feedback completed exchanges must come from actual paid execution, not trials or requested demand.');
  if (usage.paidAccounts === 0) {
    check(usage.invoiceId === null && usage.paidRequestedExchanges === 0 && usage.paidRequestedWork === 0 && usage.paidExecutedWork === 0 && usage.billedCents === 0,
      'An unpaid feedback week cannot contain a customer invoice, paid demand, or paid execution.');
  } else {
    check(usage.paidRequestedExchanges > 0 && usage.paidRequestedWork > 0 && usage.invoiceId === `invoice:${study.productId}:${row.week}`
      && state.slices.company.postedFacts[usage.invoiceId] === true, 'Feedback paid service has no settled product invoice provenance.');
    const invoice = state.slices.products.invoices.find(item => item.id === usage.invoiceId);
    if (invoice) check(invoice.companyId === study.companyId && invoice.productId === study.productId && invoice.week === row.week
      && invoice.accounts === usage.paidAccounts && invoice.amountCents === usage.billedCents,
    'Feedback paid usage disagrees with the retained customer invoice.');
    const fact = state.slices.company.ledger.find(item => item.id === usage.invoiceId);
    if (fact) check(fact.companyId === study.companyId && fact.week === row.week && fact.category === 'revenue'
      && fact.kind === 'receipt' && fact.amountCents === usage.billedCents, 'Feedback invoice differs from its settled money fact.');
  }
  const latest = state.slices.products.lastUsage[study.productId];
  if (latest?.week === row.week) check(same(usage, feedbackPaidUsage(latest, study.productId, row.week)),
    'Feedback changed this week’s actual paid usage or imported trial traffic.');
  const cost = state.slices.compute.costReports?.[study.companyId]?.find(item => item.week === row.week);
  if (cost) {
    const requestId = `serve:${study.productId}`, request = cost.resources.requests.find(item => item.id === requestId);
    const grant = cost.resources.computeGrants.find(item => item.requestId === requestId);
    check(usage.paidExecutedWork === Math.min(grant?.hardwareEffectiveCUw ?? 0, usage.paidRequestedWork)
      && (usage.paidExecutedWork === 0 || request?.category === 'serving' && request.companyId === study.companyId
        && request.taskId === study.productId && request.normalizedWorkCUw >= usage.paidRequestedWork),
    'Feedback work differs from the retained ordinary paid serving grant.');
  }
}

function assertWeek(row: FeedbackWeekReceipt, index: number, study: FeedbackStudy, state: GameState, content: GameContent): void {
  record(row, 'Feedback weekly receipt'); checkedInteger(row.week, 'Feedback receipt week');
  for (const value of [row.sourceId, row.observedDeploymentId, row.observedModelId]) identifier(value, 'Feedback weekly source');
  check(row.week === study.startedWeek + index && row.week <= state.week && row.week <= study.endsWeek
    && row.sourceId === feedbackWeekSourceId(study.companyId, study.productId, row.week),
  'Feedback source identity must describe one prospective company, product and calendar week.');
  const deployment = row.observedDeployment, observedModel = state.slices.models.versions[row.observedModelId];
  assertDeployment(deployment, study, state, content, row.week, (row.paidUsage?.paidExecutedWork ?? 0) > 0);
  check(deployment.id === row.observedDeploymentId && deployment.modelId === row.observedModelId
    && observedModel?.companyId === study.companyId && (observedModel.createdWeek ?? 0) <= row.week,
  'Feedback observed a foreign, missing, or unavailable source model.');
  if (row.routingModelId !== null) {
    identifier(row.routingModelId, 'Feedback routed source'); const routeModel = state.slices.models.versions[row.routingModelId];
    check(routeModel?.companyId === study.companyId && (routeModel.createdWeek ?? 0) <= row.week
      && inheritedModelRights(state, routeModel.id, content).hosted, 'Feedback routing source is foreign, unavailable, or lacks hosted-use rights.');
  }
  if (row.week === state.week) {
    const product = state.slices.products.offers[study.productId];
    check(product.deploymentId === row.observedDeploymentId && row.routingModelId === (activeEfficiency(state, study.productId, 'routing')?.secondaryModelId ?? null),
      'Feedback weekly source differs from the actual current deployment or routing model.');
  }
  assertPaidUsage(row.paidUsage, row, study, state);
  for (const value of [row.servedAccounts, row.consentAccounts, row.negativeCandidates]) checkedInteger(value, 'Feedback consent quantity');
  record(row.outcomes, 'Feedback case outcomes');
  for (const value of [row.outcomes.cases, row.outcomes.useful, row.outcomes.confidentError, row.outcomes.falseRefusal, row.outcomes.clarification]) checkedInteger(value, 'Feedback outcome count');
  const sourceMatches = row.observedDeploymentId === study.sourceDeploymentId && row.observedModelId === study.sourceModelId
    && !study.weeks.slice(0, index).some(previous => previous.reason === 'source-changed');
  const expected = feedbackRowCounts(study, row.paidUsage, sourceMatches);
  check(same({ servedAccounts: row.servedAccounts, consentAccounts: row.consentAccounts, negativeCandidates: row.negativeCandidates,
    reason: row.reason, outcomes: row.outcomes }, expected), 'Feedback cases do not reconcile with the fixed opt-in cohort, sampling choice, or paid service.');
  check(row.outcomes.cases <= RULES.casesPerWeek && row.outcomes.cases <= row.consentAccounts
    && row.outcomes.cases === row.outcomes.useful + row.outcomes.confidentError + row.outcomes.falseRefusal + row.outcomes.clarification,
  'Feedback counts exceed their finite weekly cohort or do not sum to the sampled cases.');
}

/** Validate immutable paid evidence; collection itself creates no packet or model improvement. */
export function assertWave10Feedback(state: GameState, content: GameContent): void {
  const collection = state.slices.data.feedbackStudies; if (collection === undefined) return;
  record(collection, 'Customer feedback studies'); const entries = Object.entries(collection);
  check(entries.length <= RULES.maximumHistory, 'Feedback history exceeds its supported bound.');
  const byProduct = new Map<string, number>(), collecting = new Set<string>(), sources = new Set<string>();
  for (const [key, study] of entries) {
    record(study, 'Feedback study');
    for (const value of [key, study.id, study.companyId, study.productId, study.sourceDeploymentId, study.sourceModelId]) identifier(value, 'Feedback identity');
    check(key === study.id && key.startsWith('feedback-study:') && study.protocol === RULES.protocol, 'Feedback study identity or protocol is invalid.');
    const receipt = state.commandReceipts[key.slice('feedback-study:'.length)], product = state.slices.products.offers[study.productId];
    checkedInteger(study.startedWeek, 'Feedback start'); checkedInteger(study.endsWeek, 'Feedback calendar end');
    check(receipt?.status === 'accepted' && receipt.week === study.startedWeek && product?.companyId === study.companyId
      && ['basic-chat', 'developer-api'].includes(study.productKind) && product.kind === study.productKind
      && study.startedWeek >= product.createdWeek && study.startedWeek <= state.week && study.endsWeek === study.startedWeek + RULES.weeks - 1
      && feedbackResearchReady(state, study.companyId, study.startedWeek), 'Feedback lacks an admitted command, available R5 research, owned public product, or fixed prospective window.');
    const source = state.slices.models.versions[study.sourceModelId], deployment = study.sourceDeployment;
    assertDeployment(deployment, study, state, content, study.startedWeek, true);
    check(source?.companyId === study.companyId && deployment.id === study.sourceDeploymentId && deployment.modelId === study.sourceModelId
      && study.sourceModelFingerprint === releaseModelFingerprint(source)
      && inheritedModelRights(state, study.sourceModelId, content).hosted, 'Feedback source deployment, frozen model identity or hosted rights changed.');
    check(FEEDBACK_SAMPLING.some(item => item.id === study.sampling) && FEEDBACK_CONSENTS.some(item => item.id === study.consent)
      && ['collecting', 'closed'].includes(study.status) && typeof study.endedEarly === 'boolean', 'Feedback sampling, consent or status is invalid.');
    check(typeof study.lastBottleneck === 'string' && study.lastBottleneck.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(study.lastBottleneck), 'Feedback explanation is invalid.');
    check(Array.isArray(study.weeks) && study.weeks.length <= RULES.weeks, 'Feedback weekly history is invalid or excessive.');
    byProduct.set(study.productId, (byProduct.get(study.productId) ?? 0) + 1);
    check(byProduct.get(study.productId)! <= RULES.maximumPerProduct, 'This product has excessive feedback study history.');
    if (study.status === 'collecting') {
      check(!collecting.has(study.productId), 'A product has multiple open feedback studies.'); collecting.add(study.productId);
      check(!study.endedEarly && study.closedWeek === null && study.reviewableWeek === null && study.endCommandId === null
        && state.week < study.endsWeek && study.weeks.length === state.week - study.startedWeek + 1, 'An open feedback study changed its finite window or acquired early review availability.');
    } else {
      checkedInteger(study.closedWeek!, 'Feedback close'); checkedInteger(study.reviewableWeek!, 'Feedback availability');
      check(study.closedWeek! >= study.startedWeek && study.closedWeek! <= study.endsWeek && study.closedWeek! <= state.week
        && study.reviewableWeek === study.closedWeek! + 1, 'Feedback report violates its next-boundary review availability.');
      if (study.endedEarly) {
        identifier(study.endCommandId, 'Feedback early-end command'); const end = state.commandReceipts[study.endCommandId!];
        check(study.endCommandId !== key.slice('feedback-study:'.length) && end?.status === 'accepted' && end.week === study.closedWeek
          && study.weeks.length === study.closedWeek! - study.startedWeek, 'Early-ended feedback lacks its command or collected cases after closure.');
      } else check(study.endCommandId === null && study.closedWeek === study.endsWeek && study.weeks.length === RULES.weeks,
        'Completed feedback must preserve all four calendar receipts.');
    }
    let cases = 0, negatives = 0;
    for (const [index, row] of study.weeks.entries()) {
      assertWeek(row, index, study, state, content);
      check(!sources.has(row.sourceId), 'The same product-week feedback was collected twice.'); sources.add(row.sourceId);
      cases = checkedAdd(cases, row.outcomes.cases); negatives = checkedAdd(negatives, row.outcomes.cases - row.outcomes.useful);
    }
    checkedInteger(study.totalCases, 'Feedback total cases'); checkedInteger(study.totalNegativeCases, 'Feedback negative cases');
    check(study.totalCases === cases && study.totalNegativeCases === negatives && cases <= RULES.maximumCases,
      'Feedback totals changed from their finite paid weekly receipts.');
  }
}
