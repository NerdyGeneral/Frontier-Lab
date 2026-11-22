'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useEffect, useState } from 'react';
import type { CommandPayload, GameState, ProductFeatures, ProductKind } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { DEFAULT_FEATURES, SEGMENT_BY_ID } from '../content/wave2-market';
import { EVALUATION_SUITES } from '../content/wave2-lab';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { TRUST_PACING } from '../content/wave5-balance';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { EVIDENCE_LINKS } from '../content/wave6-evidence';
import { formatMoney, formatUnits } from '../core/index';
import { getMarketView } from '../modules/markets';
import type { ConsumerSessionProfile } from '../contracts/wave18-sessions';
import { SESSION_PROFILES } from '../modules/consumer-sessions';
import { getProductView, productDemand, requestMeter } from '../modules/products';
import { ActionControl, Metric, Metrics, parseFixed, parseWhole, Section } from './components';
import type { PanelProps } from './panels';
import { ProductEfficiencyControls } from './applied-research-panel';
import { MarketDynamicsPanel } from './market-dynamics-panel';
import { ProductStrategyControls } from './product-strategy-controls';
import { ReleaseOperationsControls } from './release-operations-controls';
import { FeedbackPanel } from './feedback-panel';
import { FeedbackReviewPanel } from './feedback-review-panel';
import { feedbackResearchReady } from '../modules/feedback';
import { RuntimeGuardrailsPanel } from './runtime-guardrails-panel';
import { AssuredApiPanel } from './assured-api-panel';
import { BatchInferencePanel } from './batch-inference-panel';
import { useStudioLaunchSelection, useStudioTaskActions, useStudioTaskMode } from './studio-interaction-context';
import { StudioDecisionLayout } from './studio-decision-layout';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import type { ProductWorkloadId } from '../contracts/product-workloads';
import { ProductPortfolioPicker, ProductWorkloadControls, ProductWorkloadPicker, RetireProductControl } from './product-workload-controls';

type ProductDetails = ReturnType<typeof getProductView>;
type PlayerProductKind = Extract<ProductKind, 'basic-chat' | 'developer-api'>;
const productName = (kind: PlayerProductKind) => kind === 'developer-api' ? 'Developer API' : 'Basic Chat';
const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const count = (amount: number) => amount.toLocaleString('en-US');
const ownEvaluatedModels = (game: GameState) => Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId
  && Object.values(game.slices.models.reports).some(report => report.companyId === game.playerCompanyId && report.modelId === model.id && isCapabilitySuite(report.suiteId)));

function TermsForm({ game, canAct, onQueue, kind, current }: PanelProps & { kind: PlayerProductKind; current?: ProductDetails }) {
  const isApi = kind === 'developer-api';
  const launchSelection = useStudioLaunchSelection();
  const taskActions = useStudioTaskActions();
  const focusedLaunch = useStudioTaskMode() === 'launch-basic-chat' && !isApi && !current;
  const selection = !current && (launchSelection?.productKind ?? 'basic-chat') === kind ? launchSelection : null;
  const candidates = ownEvaluatedModels(game);
  const [price, setPrice] = useState(String((current?.contract.weeklyPriceCents ?? (isApi ? SEGMENT_BY_ID.developers.referencePriceCents : CONTENT.firstSale.defaultPriceCents)) / 100));
  const [allowance, setAllowance] = useState(String(current?.contract.allowance ?? (isApi ? SEGMENT_BY_ID.developers.exchanges : CONTENT.firstSale.defaultAllowance)));
  const [modelId, setModelId] = useState(candidates[candidates.length - 1]?.id ?? '');
  const [offerName, setOfferName] = useState('');
  const [workload, setWorkload] = useState<ProductWorkloadId>('general');
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null);
  const [explicitSelection, setExplicitSelection] = useState(false);
  const [reportId, setReportId] = useState<string | undefined>();
  const [selectionProblem, setSelectionProblem] = useState<string | undefined>();
  const incoming = selection !== null && selection.intentId !== appliedIntent;
  const requestedId = incoming ? selection.modelId : modelId;
  const requestedReportId = incoming ? selection.reportId : reportId;
  const model = candidates.find(item => item.id === requestedId)
    ?? (incoming || explicitSelection ? undefined : candidates[candidates.length - 1]);
  const reports = model ? Object.values(game.slices.models.reports).filter(report => report.companyId === game.playerCompanyId
    && report.modelId === model.id && isCapabilitySuite(report.suiteId)) : [];
  // An explicit report is evidence for this exact handoff. Missing, unrelated or
  // non-capability evidence cannot silently become a different report.
  const report = requestedReportId ? reports.find(item => item.id === requestedReportId)
    : reports.find(item => item.basicChatEligible) ?? reports[0];
  const problem = !current ? (incoming ? selection.unavailableReason : selectionProblem)
    ?? (!model && (incoming || explicitSelection) ? 'This model is unavailable or has not passed a separate capability test. Choose another model for launch.' : undefined)
    ?? (requestedReportId && !report ? 'This capability report is missing or belongs to another model. Choose a model to review its launch test results.' : undefined)
    ?? (!isApi && requestedReportId && report && !report.basicChatEligible ? 'This report does not meet the Basic Chat launch requirements. Choose a model and review its latest qualifying results.' : undefined)
    : undefined;
  useEffect(() => {
    if (!incoming) return;
    setModelId(selection.modelId ?? ''); setReportId(selection.reportId);
    setSelectionProblem(selection.unavailableReason); setExplicitSelection(true);
    setAppliedIntent(selection.intentId);
  }, [incoming, selection]);
  const chooseModel = (id: string) => {
    setModelId(id); setReportId(undefined); setSelectionProblem(undefined); setExplicitSelection(true);
  };
  const cents = parseFixed(price, 2), limit = parseWhole(allowance);
  const payload: CommandPayload | null = cents === null || limit === null ? null : current
    ? { kind: 'set_product_terms', productId: current.product.id, priceCents: cents, allowance: limit }
    : model && !problem ? { kind: 'deploy_product', productKind: kind, modelId: model.id, priceCents: cents, allowance: limit, features: { ...DEFAULT_FEATURES },
      ...(hasConnectedCompanyRules(game.contentVersion) ? { workload, ...(offerName.trim() ? { name: offerName.trim() } : {}) } : {}) } : null;
  return <div className="product-terms">
    <StudioDecisionLayout focused={focusedLaunch} className="studio-launch-task" summaryLabel="Launch cost and requirements" summary={<>
    {!current && !isApi && model && <div className="studio-journey-callout">
      <p className="small-heading">{model.name}</p>
      {report ? <p className="small-note">{EVALUATION_SUITES.find(suite => suite.id === (report.suiteId ?? 'basic-conversation-1'))?.name ?? 'Capability evaluation'} · Week {report.week} · {report.basicChatEligible ? 'Basic Chat capability requirements met' : 'Basic Chat capability requirements not met'}.</p>
        : <p className="small-note">Choose a capability report for this model.</p>}
      <Metrics><Metric label="Conversation / reliability">{model.capabilityBps.conversation / 100} / {model.reliabilityBps / 100}</Metric><Metric label="Deployment effort">{formatWorkPoints(CONTENT.firstSale.deploymentStaff)} Design points</Metric><Metric label="Model memory">{formatUnits(model.residentMU)} MU</Metric></Metrics>
      <p className="small-note">Launching needs Design points and a compatible GPU pool with enough memory. Once live, free trials and paying customers share serving compute and use extra memory. Review the costs and launch requirements below.</p>
    </div>}
    <ActionControl game={game} payload={payload} label={current ? 'Update price and allowance' : 'Deploy ' + productName(kind)} taskAction={!current && !isApi ? 'launch-basic-chat' : undefined} canAct={canAct} onQueue={onQueue} emptyReason={problem ?? (!model && !current ? 'Complete a separate capability test before launching.' : undefined)} />
    {!current && !isApi && taskActions && <div className="studio-journey-actions"><button type="button" className="studio-surface-button" onClick={taskActions.reviewResources}>Review people and compute</button></div>}
    {!current && !isApi && <p className="small-note">This change starts in Week {game.week + 1}. Finish deployment to open Basic Chat. You earn your first sale when a customer moves from a trial to paid service.</p>}
    </>}>
    {problem && <p className="bottleneck" role="status">{problem}</p>}
    {!current && <label className="line-control wide-select" htmlFor={kind + '-deploy-model'}>{isApi ? 'Model' : problem ? 'Choose a model to launch' : 'Launch model'}<select id={kind + '-deploy-model'} value={problem ? '' : model?.id ?? ''} onChange={event => chooseModel(event.target.value)} disabled={!canAct || !candidates.length}>{(!model || problem) && <option value="">{candidates.length ? 'Choose a tested model' : 'Evaluate a model first'}</option>}{candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {!current && hasConnectedCompanyRules(game.contentVersion) && <><label className="line-control" htmlFor={kind + '-offer-name'}>Offer name<input id={kind + '-offer-name'} maxLength={48} value={offerName} placeholder={productName(kind)} onChange={event => setOfferName(event.target.value)} disabled={!canAct} /></label>
      <ProductWorkloadPicker game={game} value={workload} onChange={setWorkload} modelId={model?.id} id={kind + '-new-workload'} disabled={!canAct} /></>}
    <label className="line-control" htmlFor={kind + '-price'}>{isApi ? 'Reference bill / 600 requests' : 'Price / account / week'}<span className="unit-input"><span>$</span><input id={kind + '-price'} type="number" inputMode="decimal" min="1" max={isApi ? 1000 : 100} step="0.25" value={price} onChange={event => setPrice(event.target.value)} disabled={!canAct} /></span></label>
    <label className="line-control" htmlFor={kind + '-allowance'}>{isApi ? 'Request limit / account / week' : 'Included exchanges'}<input id={kind + '-allowance'} type="number" inputMode="numeric" min="25" max={isApi ? 5000 : 500} step="25" value={allowance} onChange={event => setAllowance(event.target.value)} disabled={!canAct} /></label>
    <p className="small-note">{isApi ? 'The reference bill sets input and output token rates. Bill only executed paid tokens; internal reasoning is billed at the output rate. Unserved requests create no charge.' : 'The weekly subscription includes exchanges up to the allowance. Unserved work receives proportional credits. Price and allowance affect conversion and retention.'}</p>
    </StudioDecisionLayout>
  </div>;
}

function FeatureForm({ game, canAct, onQueue, current }: PanelProps & { current: ProductDetails }) {
  const [features, setFeatures] = useState<ProductFeatures>({ ...current.features });
  const meter = requestMeter(current.model, features);
  const changed = (Object.keys(features) as (keyof ProductFeatures)[]).some(key => features[key] !== current.features[key]);
  return <div className="feature-form">
    <label className="checkbox-control"><input type="checkbox" checked={features.memory} disabled={!canAct} onChange={event => setFeatures(value => ({ ...value, memory: event.target.checked }))} /><span>Conversation memory</span></label>
    <p className="small-note">Adds 100 input tokens before the context multiplier. For regular, heavy, and professional consumers, conversion improves 5% and baseline churn falls 25%.</p>
    <label className="checkbox-control"><input type="checkbox" checked={features.extendedContext} disabled={!canAct} onChange={event => setFeatures(value => ({ ...value, extendedContext: event.target.checked }))} /><span>Extended context</span></label>
    <p className="small-note">Doubles input tokens and uses 4× session memory. Professional and developer work gains 5 effective task-score points.</p>
    <label className="checkbox-control"><input type="checkbox" checked={features.deepReasoning} disabled={!canAct} onChange={event => setFeatures(value => ({ ...value, deepReasoning: event.target.checked }))} /><span>Deep reasoning</span></label>
    <p className="small-note">Adds 200 internal tokens and 10 effective task-score points. These options change how the product answers customers; they do not retrain the model.</p>
    <div className="training-preview"><Metrics><Metric label="Input / output / internal tokens">{meter.inputTokens} / {meter.outputTokens} / {meter.internalTokens}</Metric><Metric label="Baseline work / request">{formatUnits(meter.work)} CUw</Metric><Metric label="Peak memory / active account">{formatUnits(meter.sessionMemory)} MU</Metric></Metrics></div>
    <ActionControl game={game} payload={{ kind: 'set_product_features', productId: current.product.id, features }} label="Apply product options" canAct={canAct} onQueue={onQueue} extraDisabled={!changed} />
  </div>;
}

function ConsumerSessions({ game, canAct, onQueue, current }: PanelProps & { current: ProductDetails }) {
  const [draft, setDraft] = useState<ConsumerSessionProfile | 'off' | null>(null);
  const active = current.product.sessionProfile ?? 'off', choice = draft ?? active;
  const offered = { ...current.product };
  if (choice === 'off') delete offered.sessionProfile;
  else offered.sessionProfile = choice;
  const nextWeek = game.week + 1;
  const planned = choice === active ? current : productDemand(game, offered, CONTENT, nextWeek);
  const returning = planned.segments.reduce((sum, row) => sum + (row.sessionHistory?.accounts ?? 0), 0);
  const exchanges = planned.segments.reduce((sum, row) => sum + row.requestedExchanges, 0);
  const baseExchanges = planned.segments.reduce((sum, row) => sum + row.accounts * Math.min(SEGMENT_BY_ID[row.segmentId].exchanges, planned.contract.allowance), 0);
  const rules = choice === 'off' ? null : SESSION_PROFILES[choice];
  return <details className="inline-details"><summary>Conversation history · {active === 'off' ? 'Off' : active === 'brief' ? 'Brief' : 'Extended'}</summary>
    <p className="small-note">Remember past conversations for paying customers. Returning customers can ask more follow-ups within their allowance. With enough serving capacity, this history can improve answers and help customers stay.</p>
    <label className="line-control wide-select" htmlFor="chat-session-profile">History length<select id="chat-session-profile" value={choice} onChange={event => setDraft(event.target.value as typeof choice)} disabled={!canAct}>
      <option value="off">Off</option><option value="brief">Brief history · up to 400 tokens</option><option value="extended">Extended history · up to 1,200 tokens</option>
    </select></label>
    {rules && <p className="small-note">Returning accounts request up to {(rules.repeatBps - 10000) / 100}% more exchanges and get up to {rules.churnReliefBps / 100}% lower baseline churn with full service. Model quality, price, and allowance still matter.</p>}
    <Metrics><Metric label="Returning paid accounts">{count(returning)}</Metric><Metric label="Paid exchanges / without history">{count(exchanges)} / {count(baseExchanges)}</Metric>
      <Metric label="History tokens / paid exchange">{count(planned.retainedInput)} tokens</Metric><Metric label="Extra serving work">{formatUnits(planned.paidWork - baseExchanges * planned.meter.work)} CUw</Metric>
      <Metric label="Extra connected memory">{formatUnits(planned.historyMemory)} MU</Metric></Metrics>
    {current.usage?.consumerSessions && <p className="small-note">Latest Chat service used {formatUnits(current.usage.tokens?.physicalWork ?? 0)} physical CUw and {formatMoney(current.usage.tokens?.ownedVariableCostCents ?? 0)} in owned GPU usage costs. Service credits were {formatMoney(current.usage.creditsCents)}. Cloud rental is billed separately.</p>}
    <p className="small-note">Week {nextWeek} estimate uses your current customers and their history. New subscribers and trials start fresh. Turning history off clears it next week. Customers can also lose history when they receive no service. Prices stay the same, and missed service still earns credits.</p>
    <ActionControl game={game} payload={{ kind: 'set_consumer_sessions', productId: current.product.id, profile: choice }} label="Set conversation history" canAct={canAct} onQueue={onQueue} extraDisabled={choice === active} />
  </details>;
}

export function ReplaceModel({ game, canAct, onQueue, current }: PanelProps & { current: ProductDetails }) {
  const candidates = ownEvaluatedModels(game);
  const [modelId, setModelId] = useState(current.model.id);
  const launch = useStudioLaunchSelection(), selection = (launch?.productKind ?? 'basic-chat') === current.product.kind ? launch : null;
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null), [explicitSelection, setExplicitSelection] = useState(false);
  const [reportId, setReportId] = useState<string | undefined>(), [selectionProblem, setSelectionProblem] = useState<string | undefined>();
  const incoming = !!selection && selection.intentId !== appliedIntent, requestedId = incoming ? selection.modelId : modelId;
  const requestedReport = incoming ? selection.reportId : reportId;
  const model = candidates.find(item => item.id === requestedId) ?? (incoming || explicitSelection ? undefined : candidates[0]);
  const report = requestedReport ? game.slices.models.reports[requestedReport] : undefined;
  const problem = (incoming ? selection.unavailableReason : selectionProblem)
    ?? (!model && (incoming || explicitSelection) ? 'The chosen replacement is unavailable or has not completed its capability evaluation. Choose a model explicitly.' : undefined)
    ?? (requestedReport && (!report || report.modelId !== model?.id || report.companyId !== game.playerCompanyId || !isCapabilitySuite(report.suiteId)) ? 'The selected report does not belong to this tested model. Choose a replacement explicitly.' : undefined);
  useEffect(() => {
    if (!incoming) return;
    setModelId(selection.modelId ?? ''); setReportId(selection.reportId); setSelectionProblem(selection.unavailableReason); setExplicitSelection(true); setAppliedIntent(selection.intentId);
  }, [incoming, selection]);
  return <div>{problem && <p className="bottleneck" role="status">{problem}</p>}<label className="line-control wide-select" htmlFor={current.product.id + '-replacement'}>Replacement model<select id={current.product.id + '-replacement'} value={model?.id ?? ''} onChange={event => { setModelId(event.target.value); setReportId(undefined); setSelectionProblem(undefined); setExplicitSelection(true); }} disabled={!canAct || !candidates.length}>{!model && <option value="">Choose a tested replacement</option>}{candidates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.family}</option>)}</select></label>
    <ActionControl game={game} payload={model && !problem ? { kind: 'upgrade_product', productId: current.product.id, modelId: model.id } : null} label="Deploy replacement model" canAct={canAct} onQueue={onQueue} extraDisabled={model?.id === current.model.id} emptyReason={problem} />
    <p className="small-note">Deployment takes 20 Design points and pauses service until the replacement is ready. Subscriptions receive service credits during the gap.</p>
  </div>;
}

function ProductSection(props: PanelProps & { kind: PlayerProductKind }) {
  const { game, view, canAct, onQueue, kind } = props;
  const launchSelection = useStudioLaunchSelection();
  const taskMode = useStudioTaskMode();
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [consumedLaunchIntent, setConsumedLaunchIntent] = useState<number | null>(null);
  const products = Object.values(game.slices.products.offers).filter(item => item.companyId === game.playerCompanyId && item.kind === kind);
  const selectedLiveProduct = products.find(item => item.id === selectedOfferId && item.retiredWeek === undefined) ?? products.find(item => item.retiredWeek === undefined);
  const matchingLaunch = !!launchSelection && (launchSelection.productKind ?? 'basic-chat') === kind;
  const incomingLaunch = matchingLaunch && launchSelection.intentId !== consumedLaunchIntent;
  const handoffOfferId = selectedLiveProduct?.id ?? 'new';
  useEffect(() => {
    if (incomingLaunch) {
      setSelectedOfferId(handoffOfferId); setConsumedLaunchIntent(launchSelection.intentId);
    }
  }, [incomingLaunch, handoffOfferId, launchSelection]);
  const effectiveOfferId = incomingLaunch ? handoffOfferId : selectedOfferId;
  const product = effectiveOfferId === 'new' ? undefined : products.find(item => item.id === effectiveOfferId) ?? products.find(item => item.retiredWeek === undefined) ?? products[0];
  const current = product ? getProductView(game, product.id, CONTENT) : undefined;
  const deployment = product ? game.slices.products.deployments[product.deploymentId] : undefined;
  const usage = current?.usage;
  const isApi = kind === 'developer-api';
  const focusedFirstLaunch = taskMode === 'launch-basic-chat' && !isApi && !current;
  const invoices = game.slices.products.invoices.filter(invoice => invoice.productId === product?.id && invoice.companyId === game.playerCompanyId);
  if (product?.retiredWeek !== undefined && current) return <Section title={productName(kind)} id={isApi ? 'developer-api' : 'product'}>
    <ProductPortfolioPicker game={game} kind={kind} value={product.id} onChange={setSelectedOfferId} />
    <h4>{product.name} · Retired Week {product.retiredWeek}</h4><p className="small-note">{current.model.name}. This archived offer has no remaining customers. Its model, terms and {invoices.length} recent invoices remain available for review.</p>
    <Metrics><Metric label="Last weekly revenue">{formatMoney(current.usage?.billedCents ?? 0)}</Metric><Metric label="Last subscription price">{formatMoney(current.contract.weeklyPriceCents)}</Metric></Metrics>
  </Section>;
  return <Section title={productName(kind)} id={isApi ? 'developer-api' : 'product'}>
    <ProductPortfolioPicker game={game} kind={kind} value={product?.id ?? 'new'} onChange={setSelectedOfferId} />
    {current && product ? <>
      <p className="small-heading">{product.name} · {current.model.name}<span className="status-inline">{product.status === 'deploying' ? 'Deploying' : product.status === 'paused' ? 'Paused' : 'Live'}</span></p>
      <ProductWorkloadControls key={product.id + '-workload-controls'} {...props} product={product} />
      {product.status === 'deploying' && deployment && <div className="deployment-status"><Metrics><Metric label="Design deployment work">{formatWorkPoints(deployment.completedStaff)} / {formatWorkPoints(deployment.requiredStaff)} points</Metric>{deployment.readyWeek !== null && <Metric label="Activates">Week {deployment.readyWeek}</Metric>}</Metrics>{deployment.lastBottleneck && <p className="bottleneck">{deployment.lastBottleneck}</p>}</div>}
      <Metrics><Metric label={isApi ? 'Developer accounts / next week' : 'Subscribed accounts / next week'}>{count(current.accounts)}</Metric><Metric label="Trials / next week">{count(current.trialAccounts)}</Metric><Metric label={isApi ? 'Reference bill / 600 requests' : 'Current subscription'}>{formatMoney(current.contract.weeklyPriceCents)}{isApi ? '' : ' / week'}</Metric><Metric label={isApi ? 'Request limit' : 'Included exchanges'}>{current.contract.allowance} / account</Metric></Metrics>
      {product.status !== 'deploying' && <ProductStrategyControls {...props} productId={product.id} key={product.id + '-strategy'} />}
      {usage && <div className="usage-summary"><p className="small-heading">Usage · Week {usage.week}</p><Metrics><Metric label="Billed accounts">{count(usage.paidAccounts)}</Metric><Metric label="Physical serving work">{formatUnits(usage.tokens?.physicalWork ?? usage.executedWork)} CUw</Metric><Metric label="Customer requests completed">{percent(usage.fulfillmentBps)}</Metric><Metric label="Technical errors">{percent(usage.errorBps)}</Metric><Metric label="Billed revenue">{formatMoney(usage.billedCents)}</Metric></Metrics>
        <details className="inline-details"><summary>Usage meter and billing</summary><Metrics><Metric label="Requested baseline work">{formatUnits(usage.requestedWork)} CUw</Metric><Metric label="Effective work served">{formatUnits(usage.executedWork)} CUw</Metric>{usage.behavior && <><Metric label="Confident-error rate">{percent(usage.behavior.confidentErrorBps)}</Metric><Metric label="False-refusal rate">{percent(usage.behavior.falseRefusalBps)}</Metric></>}<Metric label="Requests and exchanges served">{count(usage.exchanges)}</Metric><Metric label={isApi ? 'Tokens billed' : 'Gross subscription bill'}>{formatMoney(usage.grossBillCents)}</Metric>{!isApi && <Metric label="Service credits">{formatMoney(usage.creditsCents)}</Metric>}{usage.tokens && <><Metric label="Paid input tokens">{count(usage.tokens.inputTokens)}</Metric><Metric label="Paid output tokens">{count(usage.tokens.outputTokens)}</Metric><Metric label="Paid internal tokens">{count(usage.tokens.internalTokens)}</Metric><Metric label="Owned GPU running cost">{formatMoney(usage.tokens.ownedVariableCostCents)}</Metric></>}</Metrics><p className="small-note">Trials use real serving capacity and generate no revenue. Failed answers still consume work. Physical GPU work depends on hardware efficiency; effective work measures the workload served.</p>{usage.behavior && <p className="small-note">Calibration redirects confident errors into clarification. Better behavior can improve retention and trust without increasing useful-answer capability.</p>}</details>
      </div>}
      <details className="inline-details"><summary>{isApi ? 'Token rates and next-week demand' : 'Next-week serving demand'}</summary><Metrics><Metric label="Baseline requested work">{formatUnits(current.forecastWork)} CUw</Metric><Metric label="Resident and session memory">{formatUnits(current.memory)} MU</Metric><Metric label="Tokens / input, output, internal">{current.meter.inputTokens} / {current.meter.outputTokens} / {current.meter.internalTokens}</Metric>{isApi && <><Metric label="Input / million tokens">{formatMoney(current.inputPriceCentsPerMillion)}</Metric><Metric label="Output and internal / million">{formatMoney(current.outputPriceCentsPerMillion)}</Metric></>}</Metrics><p className="small-note">Forecast includes active accounts and trials. Serving reserves compute headroom and needs one connected pool with enough memory. Larger model families multiply baseline work: compact 1×, medium 2×, large 4×.</p></details>
      <details className="inline-details"><summary>Price and allowance</summary><TermsForm key={product.id + '-terms'} {...props} current={current} /></details>
      <details className="inline-details"><summary>Conversation and reasoning options</summary><FeatureForm key={product.id + '-features'} {...props} current={current} /></details>
      {!isApi && product.status !== 'deploying' && <ConsumerSessions key={product.id + ':' + (product.sessionProfile ?? 'off')} {...props} current={current} />}
      <details className="inline-details" open={matchingLaunch || undefined}><summary>Replace the live model</summary><ReplaceModel key={product.id + '-replacement'} {...props} current={current} /></details>
      <ReleaseOperationsControls {...props} productId={product.id} />
      <RuntimeGuardrailsPanel {...props} productId={product.id} />
      {isApi && <AssuredApiPanel {...props} productId={product.id} />}
      {isApi && <BatchInferencePanel {...props} productId={product.id} />}
      {(feedbackResearchReady(game, game.playerCompanyId) || Object.values(game.slices.data.feedbackStudies ?? {}).some(study => study.productId === product.id)) && <details className="inline-details"><summary>Customer feedback</summary><FeedbackPanel {...props} productId={product.id} /><FeedbackReviewPanel {...props} productId={product.id} /></details>}
      <ProductEfficiencyControls {...props} productId={product.id} />
      {product.status !== 'deploying' && <details className="inline-details"><summary>Pause, resume or retire this offer</summary><p className="small-note">Pausing stops service and acquisition. Cloud, payroll, and installed hardware bills continue.</p><ActionControl game={game} payload={{ kind: 'set_product_paused', productId: product.id, paused: product.status !== 'paused' }} label={product.status === 'paused' ? 'Resume ' + product.name : 'Pause ' + product.name} canAct={canAct} onQueue={onQueue} /><RetireProductControl {...props} product={product} /></details>}
      <details className="inline-details"><summary>Recent invoices</summary>{invoices.length ? <div className="table-scroll"><table className="compact-table"><thead><tr><th>Week</th><th>Accounts</th><th>Credits</th><th>Net bill</th></tr></thead><tbody>{invoices.slice(-6).reverse().map(invoice => <tr key={invoice.id}><td>{invoice.week}</td><td>{invoice.accounts}</td><td>{formatMoney(invoice.creditsCents)}</td><td>{formatMoney(invoice.amountCents)}</td></tr>)}</tbody></table></div> : <p className="small-note">Invoices begin when converted accounts enter a paid week.</p>}</details>
    </> : <>
      {!isApi && <div className="studio-first-launch-overview" hidden={focusedFirstLaunch}><Metrics><Metric label="Waiting for first access">{game.slices.markets.waitlistRemaining}</Metric><Metric label="Subscribed accounts">0</Metric></Metrics></div>}
      <p className="small-note" hidden={focusedFirstLaunch}>{isApi ? 'Serve developers through a metered API. The model needs a held-out capability report, coding 50, and reliability 80.' : 'Launch a tested conversation model, attract trial users, and turn them into paying customers.'}</p>
      {view.progress.trained || ownEvaluatedModels(game).length > 0 || (!isApi && launchSelection) ? <TermsForm {...props} /> : <p className="planned-note">Test your first model, then launch it.</p>}
      {isApi && <BatchInferencePanel {...props} />}
    </>}
    <details className="inline-details"><summary>{isApi ? 'API billing rules' : 'Consumer billing rules'}</summary><p className="small-note">{isApi ? 'Choose a reference price for 600 standard requests. It defines separate input and output token rates; output and internal reasoning tokens share the higher rate. Only executed paid tokens are invoiced. The allowance caps requests per account.' : 'Casual, regular, heavy, and professional consumers have different budgets, request volumes, and quality requirements. All use your Basic Chat subscription terms. Higher allowances permit more use; they do not force customers to use it.'}</p><p className="small-note">New subscribers begin using and paying the following week. Trials and paid traffic share serving capacity. The game uses fictional token, GPU, and currency units.</p></details>
  </Section>;
}

export function ProductPanel(props: PanelProps) { return <ProductSection {...props} kind="basic-chat" />; }
export function DeveloperApiPanel(props: PanelProps) { return <ProductSection {...props} kind="developer-api" />; }

export function MarketPanel({ game }: PanelProps) {
  const market = getMarketView(game, CONTENT);
  const competitive = game.slices.campaign.rules === 'release';
  const consumers = market.segments.filter(segment => segment.market === 'consumer');
  const developer = market.segments.find(segment => segment.id === 'developers')!;
  const business = market.segments.find(segment => segment.id === 'business')!;
  return <Section title="Market and rivals" id="market">
    <MarketDynamicsPanel game={game} />
    <Metrics><Metric label="Company trust">{percent(market.trustBps)}</Metric></Metrics>
    <details className="inline-details"><summary>How trust changes</summary><p className="small-note">Trust changes once per company per week on the 0–100 scale. Actual paid service that meets the fulfillment and reliability checks earns {((TRUST_PACING.goodWeekBps) / 100).toFixed(2)} points, or {((TRUST_PACING.calibratedGoodWeekBps) / 100).toFixed(2)} when every paid product’s model has reduced confident-error tendency. A poor paid-service week loses {((TRUST_PACING.poorWeekLossBps) / 100).toFixed(2)} points.</p><p className="small-note">Check each product’s delivered service and <a href="#models">model behavior</a>. An active document evidence checker also needs source support for at least {EVIDENCE_LINKS.trustSupportFloorBps / 100}% of completed requests. Withheld answers add customer friction. Adding more products does not multiply a company’s weekly trust gain.</p></details>
    <table className="compact-table market-table"><caption>Consumer market</caption><thead><tr><th>Segment</th><th>Yours</th><th>Outside</th></tr></thead><tbody>{consumers.map(segment => <tr key={segment.id}><td>{segment.name.replace(' consumers', '')}<span className="table-subline">{segment.eligible ? 'Can attract these customers' : 'Requirements not met'} · {count(segment.population)} total</span></td><td>{count(segment.yours)}</td><td>{count(segment.outside)}</td></tr>)}</tbody></table>
    <p className="small-note">{market.lastExplanation}</p>
    <details className="inline-details"><summary>Consumer needs and workloads</summary>{consumers.map(segment => <div className="segment-row" key={segment.id}><p className="small-heading">{segment.name}</p><Metrics><Metric label="Reference budget">{formatMoney(segment.referencePriceCents)} / week</Metric><Metric label="Typical exchanges">{segment.exchanges} / week</Metric><Metric label="Conversation requirement">{segment.minConversationBps / 100}</Metric>{segment.minDocumentsBps > 0 && <Metric label="Document requirement">{segment.minDocumentsBps / 100}</Metric>}<Metric label="Reliability requirement">{segment.minReliabilityBps / 100}</Metric><Metric label="Execution-error tolerance">{percent(segment.errorToleranceBps)}</Metric></Metrics></div>)}<p className="small-note">Quality, service, price, allowance, and trust affect who joins and who stays. Available customers exclude anyone already paying or trying another provider.</p></details>
    <details className="inline-details"><summary>Developer market</summary><Metrics><Metric label="Your developer accounts">{developer.yours}</Metric><Metric label="Outside / total accounts">{developer.outside} / {developer.population}</Metric><Metric label="Your API offer">{developer.eligible ? 'Eligible' : 'Requirements not met'}</Metric><Metric label="Typical requests">{developer.exchanges} / week</Metric><Metric label="Reference bill">{formatMoney(developer.referencePriceCents)} / week</Metric></Metrics><p className="small-note">Developer accounts form a separate market. Coding 50 and reliability 80 are required; API usage is billed by executed tokens.</p></details>
    <details className="inline-details"><summary>Compare qualified offers</summary>
      <p className="small-note">{competitive ? 'Budget shoppers and developers give extra weight to the bill. Larger buyers favor task fit and reliability. Recent paid fulfillment affects the shortlist. Reach and available capacity still limit trial offers.' : 'This run uses classic competition. Prices, relevant capability, allowance and trust affect trial allocation.'}</p>
      <table className="compact-table market-table"><caption>Offers customers are considering</caption><thead><tr><th scope="col">Segment</th><th scope="col">Your rank</th><th scope="col">Leading offer</th></tr></thead>
        <tbody>{market.segments.map(segment => {
          const own = segment.contenders.findIndex(offer => offer.companyId === game.playerCompanyId), first = segment.contenders[0];
          return <tr key={segment.id}><th scope="row">{segment.name}</th><td>{own === -1 ? 'Unqualified' : `${own + 1} of ${segment.contenders.length}`}</td><td>{first?.name ?? 'Open'}</td></tr>;
        })}</tbody>
      </table>
      {competitive && <p className="small-note">An eligible alternative can weaken generic business renewals. Named agreements stay with the signed supplier through delivery and renewal under their own terms.</p>}
    </details>
    <div className="rival-list">{market.rivals.map(rival => <details className="rival-row" key={rival.companyId}><summary>{rival.name}<span className="asset-summary">{rival.withdrawn ? 'Withdrawn' : rival.style === 'frontier' ? 'Frontier research' : rival.style === 'efficient' ? 'Low-cost API' : 'Enterprise licensing'}</span></summary><p className="small-note">{rival.publicActivity}</p>{rival.products.map((product, index) => <div className="rival-product" key={index}><p className="small-heading">{product.name} · {product.model}</p><Metrics><Metric label={product.kind === 'developer-api' ? 'Reference API bill' : 'Published subscription'}>{formatMoney(product.priceCents)} / week</Metric><Metric label="Accounts">{count(product.accounts)}</Metric><Metric label="Included requests">{count(product.allowance)} / week</Metric>{product.serviceBps !== undefined && <Metric label="Last delivered">{percent(product.serviceBps)}</Metric>}<Metric label="Conversation / documents">{product.capabilityBps.conversation / 100} / {product.capabilityBps.documents / 100}</Metric><Metric label="Coding / tools">{product.capabilityBps.coding / 100} / {product.capabilityBps.tools / 100}</Metric><Metric label="Reliability">{product.reliabilityBps / 100}</Metric></Metrics></div>)}{rival.commitments.map(contract => <p key={contract.id} className="small-note"><strong>{BUSINESS_BY_ID[contract.customerId].name}</strong> · {contract.contractKind === 'customer-hosted' ? 'Buyer-hosted license' : 'Private deployment'} · {contract.status === 'active' ? `Term ${contract.termIndex} · ends Week ${contract.termEndsWeek}` : 'Delivery in progress'}</p>)}</details>)}</div>
    <p className="small-note">Rivals pay for staff, compute, and projects under the same operating rules. Public releases and prices are visible here.</p>
    <details className="inline-details"><summary>Business organizations</summary><Metrics><Metric label="Your generic subscriptions">{business.yours}</Metric><Metric label="Customer contracts · all suppliers">{business.committed}</Metric><Metric label="Outside / total organizations">{business.outside} / {business.population}</Metric></Metrics><p className="small-note">Businesses form a separate market from consumers and developers. Available businesses exclude those already using or trying a provider. Research Retrieval to launch Business Documents, then Enterprise operations for private deployments and customer-hosted licenses. Review their delivery, capacity, and support needs under Business contracts.</p></details>
  </Section>;
}
