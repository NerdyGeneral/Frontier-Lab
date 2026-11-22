'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useEffect, useState } from 'react';
import type { CommandPayload } from '../contracts/types';
import type { BusinessView, CommercialContract, CommercialContractKind, RetrievalInstallation } from '../contracts/wave3-commerce';
import { CONTENT } from '../content/catalog';
import { DEFAULT_FEATURES, SEGMENT_BY_ID } from '../content/wave2-market';
import { BUSINESS_BY_ID, COMMERCE_RULES } from '../content/wave3-commerce';
import { formatMoney, formatUnits } from '../core/index';
import { getBusinessView } from '../modules/business';
import { getProductView } from '../modules/products';
import { ActionControl, Metric, Metrics, parseFixed, parseWhole, Section } from './components';
import type { PanelProps } from './panels';
import { ReplaceModel } from './product-panels';
import { ProductEfficiencyControls } from './applied-research-panel';
import { ProductStrategyControls } from './product-strategy-controls';
import { ReleaseOperationsControls } from './release-operations-controls';
import { EvidencePanel } from './evidence-panel';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import type { ProductWorkloadId } from '../contracts/product-workloads';
import { createProductWorkloadReceipt, workloadPrivatePrice } from '../modules/product-workloads';
import { PRODUCT_WORKLOADS } from '../content/product-workloads';
import { ProductPortfolioPicker, ProductWorkloadControls, ProductWorkloadPicker, RetireProductControl } from './product-workload-controls';
import { useStudioLaunchSelection } from './studio-interaction-context';
import { isCapabilitySuite } from '../modules/evaluation-classification';

const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const count = (amount: number) => amount.toLocaleString('en-US');
const KIND_NAME: Record<CommercialContractKind, string> = { 'private-hosted': 'Private deployment', 'customer-hosted': 'Customer-hosted license' };

function PacketSelect({ business, value, onChange, disabled, id }: { business: BusinessView; value: string; onChange: (value: string) => void; disabled: boolean; id: string }) {
  return <label className="line-control wide-select" htmlFor={id}>Prepared source data<select id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled || !business.packets.length}>{!business.packets.length && <option value="">Prepare eligible hosted-use data</option>}{business.packets.map(packet => <option key={packet.id} value={packet.id}>{packet.name} · quality {packet.qualityBps / 100}</option>)}</select></label>;
}

function RetrievalStatus({ installation }: { installation: RetrievalInstallation }) {
  return <div className="retrieval-status"><p className="small-heading">Document retrieval<span className="status-inline">{installation.status}</span></p><Metrics>
    {installation.status !== 'active' && <Metric label="Design installation effort">{formatWorkPoints(installation.completedStaff)} / {formatWorkPoints(installation.requiredStaff)} points</Metric>}
    {installation.readyWeek !== null && installation.status !== 'active' && <Metric label="Index available">Week {installation.readyWeek}</Metric>}
    <Metric label="Source freshness">{percent(installation.lastFreshnessBps)}</Metric><Metric label="Data upkeep / required">{formatWorkPoints(installation.lastUpkeepGranted)} / {formatWorkPoints(installation.lastUpkeepRequired)} points / week</Metric>
  </Metrics>{installation.lastBottleneck && <p className="bottleneck">{installation.lastBottleneck}</p>}<details className="inline-details"><summary>Source quality and query costs</summary><Metrics><Metric label="Source quality">{installation.evidence.qualityBps / 100}</Metric><Metric label="Document coverage">{percent(installation.evidence.documentCoverageBps)}</Metric><Metric label="Maximum task-score bonus">+{installation.evidence.documentBonusBps / 100}</Metric><Metric label="Added input tokens / query">{installation.evidence.extraInputTokens}</Metric><Metric label="Lookup work / query">{formatUnits(installation.evidence.lookupWorkCUw)} CUw</Metric><Metric label="Resident index memory">{formatUnits(installation.evidence.indexMemoryMU)} MU</Metric></Metrics><p className="small-note">The index uses the data selected at installation. The team contributes Data points each week to keep it fresh. Queries use extra tokens and compute from the product’s serving capacity.</p></details></div>;
}

function InstallRetrieval(props: PanelProps & { business: BusinessView; productId: string }) {
  const { game, canAct, onQueue, business, productId } = props;
  const [packetId, setPacketId] = useState(business.packets[0]?.id ?? '');
  const packet = business.packets.find(item => item.id === packetId) ?? business.packets[0];
  return <div><PacketSelect business={business} value={packet?.id ?? ''} onChange={setPacketId} disabled={!canAct} id={productId + '-retrieval-packet'} />
    {packet && <p className="small-note">Document coverage {percent(packet.documentCoverageBps)}; up to +{packet.documentBonusBps / 100} document skill points while the source stays fresh.</p>}
    <p className="small-note">Installation takes {formatWorkPoints(COMMERCE_RULES.retrievalInstallStaff)} Design points. Upkeep needs {formatWorkPoints(COMMERCE_RULES.retrievalDataStaffPerOrganization)} Data points / week per organization; each query adds tokens and lookup work.</p>
    <ActionControl game={game} payload={packet ? { kind: 'install_retrieval', productId, packetId: packet.id } : null} label="Install retrieval index" canAct={canAct} onQueue={onQueue} emptyReason="Prepare an owned dataset with hosted-use rights before installing retrieval." />
  </div>;
}

function BusinessDocumentTerms(props: PanelProps & { business: BusinessView; productId?: string }) {
  const { game, canAct, onQueue, business, productId } = props;
  const current = productId ? getProductView(game, productId, CONTENT) : undefined;
  const candidates = business.models.filter(model => model.evaluated);
  const launchSelection = useStudioLaunchSelection();
  const selection = !current && launchSelection?.productKind === 'business-docs' ? launchSelection : null;
  const [modelId, setModelId] = useState(candidates[candidates.length - 1]?.id ?? '');
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null), [explicitSelection, setExplicitSelection] = useState(false);
  const [reportId, setReportId] = useState<string | undefined>(), [selectionProblem, setSelectionProblem] = useState<string | undefined>();
  const [offerName, setOfferName] = useState(''), [workload, setWorkload] = useState<ProductWorkloadId>('general');
  const [price, setPrice] = useState(String((current?.contract.weeklyPriceCents ?? SEGMENT_BY_ID.business.referencePriceCents) / 100));
  const [allowance, setAllowance] = useState(String(current?.contract.allowance ?? SEGMENT_BY_ID.business.exchanges));
  const incoming = !!selection && selection.intentId !== appliedIntent;
  const selectedId = incoming ? selection.modelId : modelId, selectedReportId = incoming ? selection.reportId : reportId;
  const model = candidates.find(item => item.id === selectedId) ?? (incoming || explicitSelection ? undefined : candidates[candidates.length - 1]);
  const report = selectedReportId ? game.slices.models.reports[selectedReportId] : undefined;
  const selectionError = !current ? (incoming ? selection.unavailableReason : selectionProblem)
    ?? (!model && (incoming || explicitSelection) ? 'The chosen model is unavailable or lacks its own capability evaluation. Choose a tested model explicitly.' : undefined)
    ?? (selectedReportId && (!report || report.companyId !== game.playerCompanyId || report.modelId !== model?.id || !isCapabilitySuite(report.suiteId)) ? 'The chosen report does not prove this exact model. Choose a model explicitly to review its current evidence.' : undefined) : undefined;
  useEffect(() => {
    if (!incoming) return;
    setModelId(selection.modelId ?? ''); setReportId(selection.reportId); setSelectionProblem(selection.unavailableReason);
    setExplicitSelection(true); setAppliedIntent(selection.intentId);
  }, [incoming, selection]);
  const chooseModel = (id: string) => { setModelId(id); setReportId(undefined); setSelectionProblem(undefined); setExplicitSelection(true); };
  const cents = parseFixed(price, 2), limit = parseWhole(allowance);
  const payload: CommandPayload | null = cents === null || limit === null ? null : current
    ? { kind: 'set_product_terms', productId: current.product.id, priceCents: cents, allowance: limit }
    : model && !selectionError ? { kind: 'deploy_product', productKind: 'business-docs', modelId: model.id, priceCents: cents, allowance: limit, features: { ...DEFAULT_FEATURES },
      ...(hasConnectedCompanyRules(game.contentVersion) ? { workload, ...(offerName.trim() ? { name: offerName.trim() } : {}) } : {}) } : null;
  return <div className="product-terms">
    {selectionError && <p className="bottleneck" role="status">{selectionError}</p>}
    {!current && <label className="line-control wide-select" htmlFor="business-documents-model">Model<select id="business-documents-model" value={model?.id ?? ''} onChange={event => chooseModel(event.target.value)} disabled={!canAct || !candidates.length}>{!model && <option value="">Choose a tested model</option>}{candidates.map(item => <option key={item.id} value={item.id}>{item.name} · documents {item.documentsBps / 100}</option>)}</select></label>}
    {!current && hasConnectedCompanyRules(game.contentVersion) && <><label className="line-control" htmlFor="business-new-offer-name">Offer name<input id="business-new-offer-name" value={offerName} placeholder="Business Documents" maxLength={48} onChange={event => setOfferName(event.target.value)} disabled={!canAct} /></label><ProductWorkloadPicker game={game} value={workload} onChange={setWorkload} modelId={model?.id} id="business-new-workload" disabled={!canAct} /></>}
    <label className="line-control" htmlFor="business-documents-price">Price / organization / week<span className="unit-input"><span>$</span><input id="business-documents-price" type="number" inputMode="decimal" min="1" max="1000" step="1" value={price} onChange={event => setPrice(event.target.value)} disabled={!canAct} /></span></label>
    <label className="line-control" htmlFor="business-documents-allowance">Included queries<input id="business-documents-allowance" type="number" inputMode="numeric" min="25" max="5000" step="25" value={allowance} onChange={event => setAllowance(event.target.value)} disabled={!canAct} /></label>
    <ActionControl game={game} payload={payload} label={current ? 'Update business subscription' : 'Deploy Business Documents'} canAct={canAct} onQueue={onQueue} emptyReason={!model ? 'Complete a separate capability test before launching.' : undefined} />
    <p className="small-note">Business subscriptions run on your company’s GPUs. Launching takes 20 Design points. Missed queries earn customers proportional credits. Free trials use resources before customers start paying.</p>
  </div>;
}

function BusinessDocuments(props: PanelProps & { business: BusinessView }) {
  const { game, canAct, onQueue, business } = props;
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const launchSelection = useStudioLaunchSelection();
  const [consumedLaunchIntent, setConsumedLaunchIntent] = useState<number | null>(null);
  const selectedLiveProduct = business.products.find(product => product.id === selectedOfferId && game.slices.products.offers[product.id].retiredWeek === undefined)
    ?? business.products.find(product => game.slices.products.offers[product.id].retiredWeek === undefined);
  const matchingLaunch = launchSelection?.productKind === 'business-docs';
  const incomingLaunch = matchingLaunch && launchSelection.intentId !== consumedLaunchIntent;
  const handoffOfferId = selectedLiveProduct?.id ?? 'new';
  useEffect(() => {
    if (incomingLaunch) {
      setSelectedOfferId(handoffOfferId); setConsumedLaunchIntent(launchSelection.intentId);
    }
  }, [incomingLaunch, handoffOfferId, launchSelection]);
  const effectiveOfferId = incomingLaunch ? handoffOfferId : selectedOfferId;
  const item = effectiveOfferId === 'new' ? undefined : business.products.find(product => product.id === effectiveOfferId)
    ?? business.products.find(product => game.slices.products.offers[product.id].retiredWeek === undefined) ?? business.products[0];
  const current = item ? getProductView(game, item.id, CONTENT) : undefined;
  const deployment = current ? game.slices.products.deployments[current.product.deploymentId] : undefined;
  if (current?.product.retiredWeek !== undefined) return <><ProductPortfolioPicker game={game} kind="business-docs" value={current.product.id} onChange={setSelectedOfferId} /><p>{current.product.name} · Retired Week {current.product.retiredWeek}. Historical contract and invoice records remain in the archive.</p></>;
  return <><ProductPortfolioPicker game={game} kind="business-docs" value={item?.id ?? 'new'} onChange={setSelectedOfferId} />
    {current && <ProductWorkloadControls key={current.product.id + '-workload-controls'} {...props} product={current.product} />}
    {current && item && current.product.status !== 'deploying' && <ProductStrategyControls {...props} productId={item.id} key={item.id + '-strategy'} />}<details className="inline-details" open={!item && business.research.retrieval || hasConnectedCompanyRules(game.contentVersion) || undefined}><summary>Business Documents and retrieval</summary>
    {current && item ? <><p className="small-heading">{current.model.name}<span className="status-inline">{item.status}</span></p><Metrics><Metric label="Subscribed organizations">{count(current.accounts)}</Metric><Metric label="Organization trials">{count(current.trialAccounts)}</Metric><Metric label="Next-week requested work">{formatUnits(current.forecastWork)} CUw</Metric><Metric label="Resident and session memory">{formatUnits(current.memory)} MU</Metric></Metrics>
      {deployment && current.product.status === 'deploying' && <div className="deployment-status"><p className="small-note">ML deployment effort: {formatWorkPoints(deployment.completedStaff)} / {formatWorkPoints(deployment.requiredStaff)} points.{deployment.readyWeek !== null ? ' Available Week ' + deployment.readyWeek + '.' : ''}</p>{deployment.lastBottleneck && <p className="bottleneck">{deployment.lastBottleneck}</p>}</div>}
      {current.usage && <details className="inline-details"><summary>Latest subscription service · Week {current.usage.week}</summary><Metrics><Metric label="Paid demand fulfilled">{percent(current.usage.fulfillmentBps)}</Metric><Metric label="Technical execution errors">{percent(current.usage.errorBps)}</Metric><Metric label="Physical GPU work">{formatUnits(current.usage.tokens?.physicalWork ?? current.usage.executedWork)} CUw</Metric><Metric label="Gross bill">{formatMoney(current.usage.grossBillCents)}</Metric><Metric label="Service credits">{formatMoney(current.usage.creditsCents)}</Metric><Metric label="Net bill">{formatMoney(current.usage.billedCents)}</Metric></Metrics></details>}
      {item.installation ? <RetrievalStatus installation={item.installation} /> : <details className="inline-details"><summary>Install a retrieval index</summary><InstallRetrieval {...props} productId={item.id} /></details>}
      <details className="inline-details"><summary>Subscription price and allowance</summary><BusinessDocumentTerms key={item.id + '-terms'} {...props} productId={item.id} /></details>
      <details className="inline-details" open={matchingLaunch || undefined}><summary>Replace the subscription model</summary><ReplaceModel key={item.id + '-replacement'} {...props} current={current} /></details>
      <ReleaseOperationsControls {...props} productId={item.id} />
      <ProductEfficiencyControls {...props} productId={item.id} />
      <EvidencePanel {...props} productId={item.id} />
      {current.product.status !== 'deploying' && <details className="inline-details"><summary>Pause, resume or retire this offer</summary><ActionControl game={game} payload={{ kind: 'set_product_paused', productId: item.id, paused: current.product.status !== 'paused' }} label={(current.product.status === 'paused' ? 'Resume ' : 'Pause ') + current.product.name} canAct={canAct} onQueue={onQueue} /><RetireProductControl {...props} product={current.product} /><p className="small-note">This changes this public offer. Signed customer contracts keep their own service terms.</p></details>}
    </> : business.research.retrieval ? <><p className="small-note">Business Documents needs a tested Documents score of 55 and Reliability of 90. Install retrieval separately using prepared source data.</p><BusinessDocumentTerms {...props} /></> : <p className="small-note">Research Retrieval (R6) to launch Business Documents and search prepared source data.</p>}
  </details></>;
}

function BusinessContractForm(props: PanelProps & { business: BusinessView }) {
  const { game, canAct, onQueue, business } = props;
  const [customerId, setCustomerId] = useState(business.board.find(customer => customer.available)?.id ?? '');
  const [chosenKind, setChosenKind] = useState<CommercialContractKind>('private-hosted');
  const candidates = business.models.filter(model => model.evaluated);
  const [modelId, setModelId] = useState(candidates[candidates.length - 1]?.id ?? '');
  const [packetId, setPacketId] = useState(business.packets[0]?.id ?? '');
  const [workload, setWorkload] = useState<ProductWorkloadId>('general');
  const customer = business.board.find(item => item.id === customerId) ?? business.board.find(item => item.available) ?? business.board[0];
  const contractKind = customer?.kinds.includes(chosenKind) ? chosenKind : customer?.kinds[0] ?? chosenKind;
  const model = candidates.find(item => item.id === modelId) ?? candidates[candidates.length - 1];
  const packet = business.packets.find(item => item.id === packetId) ?? business.packets[0];
  const hosted = contractKind === 'private-hosted';
  const payload: CommandPayload | null = customer && model && (!hosted || packet)
    ? { kind: 'sign_business_contract', customerId: customer.id, modelId: model.id, contractKind, ...(hosted && packet ? { packetId: packet.id } : {}),
      ...(hasConnectedCompanyRules(game.contentVersion) ? { workload } : {}) } : null;
  return <div className="business-contract-form">
    <label className="line-control wide-select" htmlFor="business-customer">Customer<select id="business-customer" value={customer?.id ?? ''} onChange={event => setCustomerId(event.target.value)} disabled={!canAct || !business.board.length}>{business.board.map(item => <option key={item.id} value={item.id}>{item.name}{!item.available ? ' · unavailable' : ''}</option>)}</select></label>
    {customer && <><p className="small-note">{customer.description}</p>{!customer.available && <p className="bottleneck">{customer.unavailableReason}</p>}
      <label className="line-control wide-select" htmlFor="business-contract-kind">Delivery<select id="business-contract-kind" value={contractKind} onChange={event => setChosenKind(event.target.value as CommercialContractKind)} disabled={!canAct}>{customer.kinds.map(kind => <option key={kind} value={kind}>{KIND_NAME[kind]}</option>)}</select></label>
      <Metrics><Metric label="Weekly contract price">{formatMoney(workloadPrivatePrice(hosted ? customer.hostedWeeklyCents : customer.licenseWeeklyCents, hasConnectedCompanyRules(game.contentVersion) ? createProductWorkloadReceipt(workload, game.week + 1) : undefined))}</Metric><Metric label="Initial term">{customer.termWeeks} weeks</Metric><Metric label="Service / support required">{percent(customer.slaBps)}</Metric><Metric label={customer.domain === 'documents' ? 'Minimum documents / reliability' : 'Minimum coding / reliability'}>{customer.minimumScoreBps / 100} / {customer.minimumReliabilityBps / 100}</Metric>{hosted && <Metric label="Committed queries / week">{count(customer.weeklyRequests)}</Metric>}</Metrics></>}
    <label className="line-control wide-select" htmlFor="business-contract-model">Contract model<select id="business-contract-model" value={model?.id ?? ''} onChange={event => setModelId(event.target.value)} disabled={!canAct || !candidates.length}>{!candidates.length && <option value="">Evaluate an owned model first</option>}{candidates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.family}</option>)}</select></label>
    {model && <p className="small-note">Documents {model.documentsBps / 100}, coding {model.codingBps / 100}, reliability {model.reliabilityBps / 100}. Rights: hosted use {model.hosted ? 'allowed' : 'restricted'}; weight distribution {model.weights ? 'allowed' : 'restricted'}.</p>}
    <ProductWorkloadPicker game={game} value={workload} onChange={setWorkload} modelId={model?.id} id="private-contract-workload" disabled={!canAct} />
    {hasConnectedCompanyRules(game.contentVersion) && <p className="small-note">This customer pays {((PRODUCT_WORKLOADS[workload].privatePriceBps - 10000) / 100).toFixed(0)}% above its standard fee for this operating promise. The exact model must meet every threshold before signing; the fee and promise remain fixed for the contract.</p>}
    {hosted && <><PacketSelect business={business} value={packet?.id ?? ''} onChange={setPacketId} disabled={!canAct} id="business-contract-packet" />{packet && <p className="small-note">The private index uses this dataset, giving up to +{packet.documentBonusBps / 100} document-task points at full freshness.</p>}</>}
    <p className="small-note">{hosted ? 'Your GPUs serve the fixed workload. Signing reserves capacity with headroom and connected memory; deployment and index delivery take ' + formatWorkPoints(COMMERCE_RULES.privateDeploymentStaff) + ' Design points. Weekly upkeep needs ' + formatWorkPoints(COMMERCE_RULES.retrievalDataStaffPerOrganization) + ' Data points / week and ' + formatWorkPoints(COMMERCE_RULES.supportStaffPerOrganization) + ' Business points / week.' : 'The customer runs the weights on its own GPUs. Delivery takes ' + formatWorkPoints(COMMERCE_RULES.licenseDeliveryStaff) + ' Design points; support needs ' + formatWorkPoints(COMMERCE_RULES.supportStaffPerOrganization) + ' Business points / week each week. This license adds no company inference work.'}</p>
    <ActionControl game={game} payload={payload} label={hosted ? 'Sign private deployment' : 'Sign customer-hosted license'} canAct={canAct} onQueue={onQueue} emptyReason={!model ? 'Complete a separate capability test before signing.' : hosted && !packet ? 'Prepare source data with hosted-use rights for the private index.' : undefined} />
    <p className="small-note">Your company pays the setup cost. Weekly payments begin after delivery. Missed service or support reduces what you earn. Contracts renew only if they still qualify and you have enabled renewal.</p>
  </div>;
}

function BusinessContractRow({ game, canAct, onQueue, contract, business }: PanelProps & { contract: CommercialContract; business: BusinessView }) {
  const customer = BUSINESS_BY_ID[contract.customerId];
  const model = business.models.find(item => item.id === contract.modelId);
  const usage = contract.lastUsage;
  const hosted = contract.contractKind === 'private-hosted';
  const active = contract.status !== 'expired' && contract.status !== 'terminated';
  return <article className="project-row business-contract" aria-label={customer.name + ' ' + KIND_NAME[contract.contractKind]}>
    <div className="project-heading"><strong>{customer.name}</strong><span>{contract.status}</span></div><p className="small-note">{KIND_NAME[contract.contractKind]} · {model?.name ?? 'Contract model'}</p>
    {contract.status === 'building' && <><p className="small-note">ML delivery: {formatWorkPoints(contract.completedDeliveryStaff)} / {formatWorkPoints(contract.requiredDeliveryStaff)} points.</p><progress value={contract.completedDeliveryStaff} max={contract.requiredDeliveryStaff} aria-label={customer.name + ' delivery effort'} /></>}
    {contract.status === 'ready' && contract.readyWeek !== null && <p className="small-note">Delivery complete. Service begins Week {contract.readyWeek}.</p>}
    <Metrics><Metric label="Weekly price">{formatMoney(contract.weeklyPriceCents)}</Metric><Metric label="Term ends at">{contract.termEndsWeek !== null ? 'Week ' + contract.termEndsWeek : 'Starts after delivery'}</Metric><Metric label="Renewal">{contract.autoRenew ? 'Enabled' : 'Ends at term'}</Metric>
      {hosted ? <><Metric label="Hosted baseline work reserved">{formatUnits(contract.reservedWorkCUw)} CUw</Metric><Metric label="Connected memory reserved">{formatUnits(contract.reservedMemoryMU)} MU</Metric></> : <><Metric label="Runtime compute">Customer GPUs</Metric><Metric label="Weekly support need">{formatWorkPoints(contract.supportStaffPerWeek)} Business points / week</Metric></>}
    </Metrics>{contract.lastBottleneck && <p className="bottleneck">{contract.lastBottleneck}</p>}
    {usage && <div className="usage-summary"><p className="small-heading">{hosted ? 'Service' : 'Support'} · Week {usage.week}</p><Metrics><Metric label="Delivered service">{percent(usage.serviceBps)}</Metric><Metric label="Service target">{percent(customer.slaBps)}</Metric><Metric label="Credits">{formatMoney(usage.creditsCents)}</Metric><Metric label="Net bill">{formatMoney(usage.billedCents)}</Metric></Metrics><p className="small-note">{usage.explanation}</p>
      <details className="inline-details"><summary>{hosted ? 'Usage and resource meter' : 'Support meter'}</summary><Metrics>{hosted && <><Metric label="Effective work / demand">{formatUnits(usage.executedWorkCUw)} / {formatUnits(usage.requestedWorkCUw)} CUw</Metric><Metric label="Physical GPU work">{formatUnits(usage.physicalWorkCUw)} CUw</Metric><Metric label="Input / output tokens">{count(usage.inputTokens)} / {count(usage.outputTokens)}</Metric><Metric label="Data upkeep / needed">{formatWorkPoints(usage.dataStaffGranted)} / {formatWorkPoints(usage.dataStaffRequired)} points / week</Metric><Metric label="Source freshness">{percent(usage.freshnessBps)}</Metric>{usage.technicalErrorBps !== null && <Metric label="Technical execution errors">{percent(usage.technicalErrorBps)}</Metric>}</>}<Metric label="Support / needed">{formatWorkPoints(usage.supportStaffGranted)} / {formatWorkPoints(usage.supportStaffRequired)} points / week</Metric><Metric label="Gross weekly bill">{formatMoney(usage.grossCents)}</Metric></Metrics>{!hosted && <p className="small-note">The customer uses its own GPUs. This tracks your delivery and support work.</p>}</details>
    </div>}
    <details className="inline-details"><summary>Contract terms and payments</summary><Metrics><Metric label="Company setup cost">{formatMoney(contract.setupFeeCents)}</Metric><Metric label="Term duration">{customer.termWeeks} weeks</Metric><Metric label="Served in current term">{contract.termWeeksServed} weeks</Metric><Metric label="Consecutive breach weeks">{contract.breachWeeks}</Metric><Metric label="Total revenue">{formatMoney(contract.lifetimeBilledCents)}</Metric><Metric label="Total credits">{formatMoney(contract.lifetimeCreditsCents)}</Metric><Metric label="Hosted / weight rights">{contract.rights.hosted ? 'Yes' : 'No'} / {contract.rights.weights ? 'Yes' : 'No'}</Metric>{hosted && <><Metric label="Committed queries">{count(contract.weeklyRequests)} / week</Metric><Metric label="Serving headroom">{percent(contract.servingHeadroomBps)}</Metric><Metric label="Data staff needed">{formatWorkPoints(contract.dataStaffPerWeek)} points / week</Metric></>}</Metrics>{contract.evidence && <p className="small-note">Index quality when signed {contract.evidence.qualityBps / 100}, document coverage {percent(contract.evidence.documentCoverageBps)}, maximum document bonus +{contract.evidence.documentBonusBps / 100}.</p>}<p className="small-note">The contract keeps the model and source data chosen when you signed. Missed service earns customers credits; repeated failures can end the contract.</p></details>
    {active && <details className="inline-details"><summary>Renewal choice</summary><ActionControl game={game} payload={{ kind: 'set_business_renewal', contractId: contract.id, renew: !contract.autoRenew }} label={(contract.autoRenew ? 'Do not renew · ' : 'Enable renewal · ') + customer.name} canAct={canAct} onQueue={onQueue} /><p className="small-note">You must finish the current term. Turning renewal off stops the next term; it does not cancel current delivery or service.</p></details>}
  </article>;
}

export function BusinessCommitmentsPanel(props: PanelProps) {
  const { game } = props;
  const business = getBusinessView(game, CONTENT, game.playerCompanyId);
  const contracts = business.contracts.filter(contract => contract.companyId === game.playerCompanyId);
  const active = contracts.filter(contract => contract.status !== 'expired' && contract.status !== 'terminated');
  const ended = contracts.filter(contract => contract.status === 'expired' || contract.status === 'terminated');
  const invoices = business.invoices.filter(invoice => invoice.companyId === game.playerCompanyId);
  return <Section title="Business contracts" id="business-commitments">
    <Metrics><Metric label="Your contracted organizations">{business.committedOrganizations}</Metric><Metric label="Organizations outside all offers">{business.outsideOrganizations}</Metric></Metrics>
    {active.length > 0 && <><details className="inline-details"><summary>Weekly resources required</summary><Metrics><Metric label="Private baseline work reserved">{formatUnits(business.reservedWorkCUw)} CUw</Metric><Metric label="Private connected memory reserved">{formatUnits(business.reservedMemoryMU)} MU</Metric><Metric label="Required data upkeep">{formatWorkPoints(business.requiredDataStaff)} points / week</Metric><Metric label="Required commercial support">{formatWorkPoints(business.requiredSupportStaff)} points / week</Metric></Metrics><p className="small-note">Private deployments need 10% spare serving capacity. Cutting compute, parking GPUs, or reducing Data and support staff can cause missed service. Customer-hosted licenses run on the customer’s GPUs.</p></details><div className="project-list">{active.map(contract => <BusinessContractRow key={contract.id} {...props} business={business} contract={contract} />)}</div></>}
    <BusinessDocuments {...props} business={business} />
    {business.research.enterprise ? <details className="inline-details" open={!contracts.length || undefined}><summary>Contract and license board</summary><p className="small-note">Each customer comes from the business market. Running the model for a customer and licensing it for their GPUs require different rights, staff, and resources.</p><BusinessContractForm {...props} business={business} /></details> : <p className="planned-note">Research Enterprise operations (R12) to sign reserved private deployments or supported customer-hosted licenses.</p>}
    {ended.length > 0 && <details className="inline-details"><summary>Ended contracts · {ended.length}</summary>{ended.slice().reverse().map(contract => <BusinessContractRow key={contract.id} {...props} business={business} contract={contract} />)}</details>}
    {invoices.length > 0 && <details className="inline-details"><summary>Recent business invoices</summary><div className="table-scroll"><table className="compact-table"><thead><tr><th>Week / customer</th><th>Credits</th><th>Net bill</th></tr></thead><tbody>{invoices.slice(-8).reverse().map(invoice => <tr key={invoice.id}><td>{invoice.week} · {BUSINESS_BY_ID[invoice.customerId].name}<span className="table-subline">{KIND_NAME[invoice.contractKind]}</span></td><td>{formatMoney(invoice.creditsCents)}</td><td>{formatMoney(invoice.amountCents)}</td></tr>)}</tbody></table></div></details>}
  </Section>;
}
