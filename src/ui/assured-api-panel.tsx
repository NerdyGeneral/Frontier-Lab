'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import type { AssuranceContract, AssuranceView } from '../contracts/wave13-assurance';
import { ASSURANCE_BY_ID, ASSURANCE_RULES } from '../content/wave13-assurance';
import { formatMoney, formatUnits } from '../core/index';
import { getAssuranceView } from '../modules/assured-api';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const live = (contract: AssuranceContract) => ['building', 'ready', 'active'].includes(contract.status);

function ContractReceipt({ item, assuranceView, ...props }: PanelProps & { item: AssuranceView['contracts'][number]; assuranceView: AssuranceView }) {
  const { game, canAct, onQueue } = props;
  const { contract, currentQualification: qualification } = item;
  const buyer = ASSURANCE_BY_ID[contract.buyerId], usage = contract.lastUsage;
  const invoices = assuranceView.invoices.filter(invoice => invoice.contractId === contract.id);
  return <div className="system-application" role="group" aria-label={buyer.name + ' contract'}>
    <p className="small-heading">{buyer.name}<span className="status-inline">{contract.status === 'active' && (!item.qualified || !item.productActive) ? 'Suspended' : contract.status}</span></p>
    <Metrics>
      <Metric label="Weekly retainer">{formatMoney(contract.weeklyPriceCents)}</Metric>
      <Metric label="Dedicated requests / week">{contract.weeklyRequests.toLocaleString('en-US')}</Metric>
      <Metric label="Support required">{formatWorkPoints(contract.supportStaffPerWeek)} Business points / week</Metric>
      {contract.termStartedWeek !== null && <Metric label="Service term">Weeks {contract.termStartedWeek}–{contract.termEndsWeek! - 1}</Metric>}
      {contract.status === 'building' && <Metric label="Business onboarding">{formatWorkPoints(contract.completedOnboardingStaff)} / {formatWorkPoints(contract.requiredOnboardingStaff)} points</Metric>}
      {contract.status === 'ready' && <Metric label="Service starts">Week {contract.readyWeek}</Metric>}
      <Metric label="Approved checker">{qualification.profile === 'strict' ? 'Strict' : 'Balanced'} · version {qualification.version}</Metric>
    </Metrics>
    <p className={live(contract) && contract.status === 'active' && (!item.qualified || !item.productActive) ? 'bottleneck' : 'small-note'} role="status">{item.status}</p>
    {usage && <div className="usage-summary">
      <p className="small-heading">Delivered service · Week {usage.week}</p>
      <Metrics>
        <Metric label="Completed requests">{usage.servedRequests.toLocaleString('en-US')} / {usage.requestedRequests.toLocaleString('en-US')}</Metric>
        <Metric label="Physical GPU work">{formatUnits(usage.physicalWorkCUw)} CUw</Metric>
        <Metric label="Support supplied">{formatWorkPoints(usage.supportStaffGranted)} / {formatWorkPoints(usage.supportStaffRequired)} points / week</Metric>
        <Metric label="Service delivered / target">{percent(usage.serviceBps)} / {percent(contract.slaBps)}</Metric>
        <Metric label="Service credit">{formatMoney(usage.creditsCents)}</Metric>
        <Metric label="Net retainer">{formatMoney(usage.billedCents)}</Metric>
      </Metrics>
      <p className="small-note">{usage.explanation}</p>
    </div>}
    {live(contract) && <details className="inline-details"><summary>Update the audit or end the contract</summary>
      <p className="small-note">Changing the model, routing, conversation options, or checker requires a new paid audit. Approve that audit here when it meets the buyer’s requirements. The contract still ends on its original eight-week schedule.</p>
      <ActionControl game={game} payload={{ kind: 'requalify_assurance_contract', contractId: contract.id }} label="Approve this audit" canAct={canAct} onQueue={onQueue} compact />
      <ActionControl game={game} payload={{ kind: 'cancel_assurance_contract', contractId: contract.id }} label="End assured API contract" canAct={canAct} onQueue={onQueue} compact />
    </details>}
    <details className="inline-details"><summary>Approved test results and workload</summary>
      <Metrics>
        <Metric label="Serving model">{game.slices.models.versions[qualification.binding.primary.modelId]?.name}</Metric>
        {qualification.binding.secondary && <Metric label="Routed model">{game.slices.models.versions[qualification.binding.secondary.modelId]?.name}</Metric>}
        <Metric label="Useful allowed answers">{qualification.usefulAnswers} / 50 · needs {buyer.minimumUsefulAnswers}</Metric>
        <Metric label="Restricted requests answered">{qualification.unsafeCompliances} / 50 · maximum {buyer.maximumUnsafeCompliances}</Metric>
        <Metric label="Accepted in">Week {qualification.acceptedWeek}</Metric>
        <Metric label="Weekly model work">{formatUnits(contract.weeklyRequests * qualification.meter.workPerRequestCUw)} CUw</Metric>
        <Metric label="Reserved model memory">{formatUnits(qualification.meter.reservedMemoryMU)} MU</Metric>
        <Metric label="Capacity headroom">{percent(qualification.meter.servingHeadroomBps)}</Metric>
      </Metrics>
      <p className="small-note">This customer pays a fixed weekly amount for requests and support. The model and checker use your GPUs and their own memory, without the public prefix-cache discount. Audit scores cover the test cases only; live results can differ.</p>
    </details>
    {invoices.length > 0 && <details className="inline-details"><summary>Term invoices · {invoices.length}</summary>
      <div className="table-scroll"><table className="compact-table"><thead><tr><th>Week</th><th>Service</th><th>Credit</th><th>Net bill</th></tr></thead><tbody>
        {invoices.map(invoice => <tr key={invoice.id}><td>{invoice.week}</td><td>{percent(invoice.serviceBps)}</td><td>{formatMoney(invoice.creditsCents)}</td><td>{formatMoney(invoice.amountCents)}</td></tr>)}
      </tbody></table></div>
      <Metrics><Metric label="Earned this term">{formatMoney(contract.lifetimeBilledCents)}</Metric><Metric label="Credits this term">{formatMoney(contract.lifetimeCreditsCents)}</Metric></Metrics>
    </details>}
  </div>;
}

export function AssuredApiPanel({ productId, ...props }: PanelProps & { productId: string }) {
  const { game, canAct, onQueue } = props;
  const view = getAssuranceView(game);
  const product = view.products.find(item => item.id === productId);
  const contracts = view.contracts.filter(item => item.contract.productId === productId);
  if (!view.researched && !contracts.length) return null;
  const ongoing = contracts.filter(item => live(item.contract));
  const ended = contracts.filter(item => !live(item.contract));
  return <details className="inline-details"><summary>Assured API contracts</summary>
    <p className="small-note">Business customers pay for reserved API capacity, Commercial staff support, and an approved response-checking audit. Choose a checker that meets each buyer’s requirements for useful answers and refusals.</p>
    {product?.profile ? <p className="small-note">Current {product.profile} audit: <strong>{product.usefulAnswers}/50 useful allowed answers</strong> and <strong>{product.unsafeCompliances}/50 restricted requests answered</strong>.</p>
      : <p className="bottleneck">Install and activate a qualifying runtime checker before accepting work.</p>}
    {view.board.map(buyer => <div className="system-application" key={buyer.id} role="group" aria-label={buyer.name + ' offer'}>
      <p className="small-heading">{buyer.name}<span className="status-inline">{!buyer.available ? 'Already contracted or unavailable' : product?.qualifyingBuyers.includes(buyer.id) ? 'Audit qualifies' : 'Audit requirement unmet'}</span></p>
      <Metrics>
        <Metric label="Useful allowed answers required">At least {buyer.minimumUsefulAnswers} / 50</Metric>
        <Metric label="Restricted answers allowed">At most {buyer.maximumUnsafeCompliances} / 50</Metric>
        <Metric label="Dedicated requests / week">{buyer.weeklyRequests.toLocaleString('en-US')}</Metric>
        <Metric label="Weekly retainer / term">{formatMoney(buyer.weeklyPriceCents)} / {ASSURANCE_RULES.termWeeks} weeks</Metric>
        <Metric label="Business support">{formatWorkPoints(buyer.supportStaffPerWeek)} points / week</Metric>
      </Metrics>
      {buyer.available ? <ActionControl game={game} payload={{ kind: 'sign_assurance_contract', buyerId: buyer.id, productId }} label={'Accept ' + buyer.name + ' contract'} canAct={canAct} onQueue={onQueue} />
        : <p className="small-note">{buyer.unavailableReason}</p>}
    </div>)}
    <p className="small-note">Each new term costs {formatMoney(ASSURANCE_RULES.setupFeeCents)} for setup and 20 Business points. Service starts the following week. Payment is reduced by whichever falls further short: completed requests or support provided. An unavailable approved audit gives the customer a full credit. Falling below the 98% service target adds no extra fine.</p>
    {ongoing.map(item => <ContractReceipt {...props} assuranceView={view} item={item} key={item.contract.id} />)}
    {ended.length > 0 && <details className="inline-details"><summary>Completed and ended terms · {ended.length}</summary>{ended.map(item => <ContractReceipt {...props} assuranceView={view} item={item} key={item.contract.id} />)}</details>}
    <details className="inline-details"><summary>Contract resources</summary>
      <Metrics><Metric label="Contracted business customers">{view.committedOrganizations}</Metric><Metric label="Promised weekly GPU work">{formatUnits(view.reservedWorkCUw)} CUw</Metric><Metric label="Reserved model memory">{formatUnits(view.reservedMemoryMU)} MU</Metric><Metric label="Promised commercial support">{formatWorkPoints(view.requiredSupportStaff)} points / week</Metric></Metrics>
      <p className="small-note">These customers come from the business market. Capacity forecasts include their contracts during setup and suspension. Find their weekly invoices and GPU costs in Compute costs. Public API usage and feedback are tracked separately.</p>
      <p className="small-note">Contracts last eight service weeks and do not renew automatically. Cancelling stops service and billing at the start of next week. Each buyer allows up to four terms, with up to four approved audits per term.</p>
    </details>
  </details>;
}
