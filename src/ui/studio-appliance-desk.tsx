'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { memo, useMemo, useState } from 'react';
import { BadgeCheck, CircleCheck, Clock3, FileCheck2, PackageCheck, Server, ShieldCheck, Truck } from 'lucide-react';
import type { ChipFoundry } from '../contracts/wave4-hardware';
import type { PrivateApplianceOrderView, PrivateApplianceView } from '../contracts/wave27-appliance';
import { formatMoney, formatUnits } from '../core/math';
import { getPrivateApplianceView, previewPrivateApplianceOrder } from '../modules/private-appliances';
import { getWorkforce } from '../modules/workforce';
import { ActionControl } from './components';
import { ReleaseFact, ReleaseLink, ReleaseNotice, ReleaseProgress, ReleaseStatus, releaseCount, releasePercent, retainedReleasePropsEqual } from './release-desk-parts';
import type { StudioReleaseDeskProps } from './release-desk-parts';

function ApplianceBuyer({ view, onOpenPanel }: Pick<StudioReleaseDeskProps, 'onOpenPanel'> & { view: PrivateApplianceView }) {
  const { buyer } = view;
  return <section className="release-desk-card" aria-labelledby="appliance-buyer-heading">
    <header className="release-desk-card-heading"><div><span className="release-desk-kicker">One buyer · one model and hardware package</span><h3 id="appliance-buyer-heading">{buyer.name}</h3><p>{buyer.description}</p></div><Server size={23} aria-hidden="true" /></header>
    <div className="release-desk-card-body">
      <dl className="release-desk-facts">
        <ReleaseFact label="Document capability">{releasePercent(buyer.minimumScoreBps)} minimum</ReleaseFact>
        <ReleaseFact label="Reliability">{releasePercent(buyer.minimumReliabilityBps)} minimum</ReleaseFact>
        <ReleaseFact label="Usable hardware">{formatUnits(buyer.minimumUsefulCU)} CU minimum</ReleaseFact>
        <ReleaseFact label="Connected memory">{formatUnits(buyer.minimumMemoryMU)} MU minimum</ReleaseFact>
        <ReleaseFact label="Workload">{releaseCount(buyer.weeklyRequests)} requests / week</ReleaseFact>
        <ReleaseFact label="Longest allowed build time">{buyer.maximumLeadWeeks} weeks</ReleaseFact>
      </dl>
      <p className="release-desk-copy"><strong>{buyer.racks} dense inference racks with wide memory.</strong> The package uses the model, runtime, and distribution rights chosen when you accept the order. After delivery, the buyer runs the model on its own equipment.</p>
      <ReleaseNotice title="Runs on the customer’s GPUs">You pay to manufacture and deliver the hardware, then provide a license for the chosen model and ongoing support. The customer pays for its own serving compute; you earn license and support fees.</ReleaseNotice>
      <div className="release-desk-links"><ReleaseLink panel="chips" onOpenPanel={onOpenPanel}>Design & prototype hardware</ReleaseLink><ReleaseLink panel="models" onOpenPanel={onOpenPanel}>Evaluate a model</ReleaseLink></div>
    </div>
  </section>;
}

function ApplianceOrder({ item, ...props }: StudioReleaseDeskProps & { item: PrivateApplianceOrderView }) {
  const { game, onOpenPanel } = props;
  const { order, contract, phase } = item;
  const config = order.configuration;
  const model = game.slices.models.versions[order.modelId];
  const design = game.slices.compute.chipDesigns[config.designId];
  const workforce = getWorkforce(game, game.playerCompanyId);
  const steps = [
    { label: 'Fabrication paid', complete: item.fabricationPaid, detail: item.fabricationPaid ? 'Week ' + order.orderedWeek : 'Payment pending' },
    { label: 'Direct shipment', complete: order.shippedWeek !== null, detail: order.shippedWeek !== null ? 'Week ' + order.shippedWeek : 'Due Week ' + order.arrivalWeek },
    { label: 'Delivery work', complete: order.delivery.completedStaff >= contract.requiredDeliveryStaff, detail: formatWorkPoints(order.delivery.completedStaff) + ' / ' + formatWorkPoints(contract.requiredDeliveryStaff) + ' ML weeks' },
    { label: 'Buyer acceptance', complete: order.acceptedWeek !== null, detail: order.acceptedWeek !== null ? 'Week ' + order.acceptedWeek : 'After installation' },
    { label: 'Bundle payment', complete: item.bundleSettled, detail: item.bundleSettled && order.settledWeek !== null ? 'Week ' + order.settledWeek : 'On acceptance' },
  ];
  const firstIncomplete = steps.findIndex(step => !step.complete);
  const phaseLabel = phase === 'fabricating' ? 'Fabricating' : phase === 'installing' ? 'Installing' : phase === 'ready' ? 'Awaiting acceptance' : 'Accepted';
  const serviceLabel = contract.status === 'active' ? 'Support active' : contract.status === 'expired' ? 'Term expired' : contract.status === 'terminated' ? 'Term terminated' : 'Support begins on acceptance';
  return <div className="release-desk-stack">
    <section className="release-desk-card" aria-labelledby="appliance-order-heading">
      <header className="release-desk-card-heading"><div><span className="release-desk-kicker"><Truck size={13} aria-hidden="true" /> Private appliance delivery</span><h3 id="appliance-order-heading">Delivery progress</h3><p>{model?.name ?? order.modelId} · {design?.name ?? config.designId}</p></div><ReleaseStatus tone={phase === 'accepted' ? 'good' : 'active'}>{phaseLabel}</ReleaseStatus></header>
      <div className="release-desk-card-body">
        <ol className="release-desk-steps" aria-label="Private appliance delivery progress">{steps.map((step, index) => <li key={step.label} className={step.complete ? 'is-complete' : index === firstIncomplete ? 'is-current' : ''} aria-current={index === firstIncomplete ? 'step' : undefined}>{step.label}{step.complete && <span className="sr-only">, complete</span>}<small>{step.detail}</small></li>)}</ol>
        <dl className="release-desk-facts facts-three">
          <ReleaseFact label="Measured hardware">{formatUnits(config.usableCU)} usable CU<small>{releasePercent(config.yieldBps)} fabrication yield</small></ReleaseFact>
          <ReleaseFact label="Resident memory">{formatUnits(config.requiredMemoryMU)} / {formatUnits(config.memoryMU)} MU</ReleaseFact>
          <ReleaseFact label="Buyer workload / capacity">{formatUnits(config.weeklyWorkCUw)} / {formatUnits(config.weeklyCapacityCUw)} CUw / week</ReleaseFact>
        </dl>
        <ReleaseProgress label="Design installation work" completed={order.delivery.completedStaff} required={contract.requiredDeliveryStaff} unit="points" />
        {order.delivery.latestGrant && <p className="release-desk-copy">Latest installation work: {formatWorkPoints(order.delivery.latestGrant.grantedStaff)} Design points in Week {order.delivery.latestGrant.week}. {order.delivery.grantCount} weekly work records are saved with this order.</p>}
        {phase !== 'accepted' && <ReleaseNotice tone={phase === 'ready' ? 'active' : 'neutral'} title={phase === 'fabricating' ? 'Waiting for direct shipment' : phase === 'ready' ? 'Delivery work complete' : 'Installation work'}>{phase === 'fabricating' ? 'Fabrication is booked for arrival in Week ' + order.arrivalWeek + '. The two racks ship to the buyer and never enter the lab’s fleet.' : contract.lastBottleneck || (phase === 'ready' ? 'Installation is complete. The buyer accepts the package and the support term starts at the beginning of next week.' : 'ML staff are installing the package. Finish the remaining work before the buyer can accept it.')}</ReleaseNotice>}
        <p className="release-desk-copy">Current lab capacity: <strong>{formatWorkPoints(workforce.capacity.ml)} Design points / week</strong> for shared delivery and development work. Track installation, shipment, and customer acceptance separately.</p>
        <div className="release-desk-links"><ReleaseLink panel="people" onOpenPanel={onOpenPanel}>View delivery team</ReleaseLink><ReleaseLink panel="business-commitments" onOpenPanel={onOpenPanel}>Review contracts</ReleaseLink></div>
        <details className="release-desk-details"><summary>Package details and delivery records</summary>
          <dl className="release-desk-facts"><ReleaseFact label="Order">{order.id}</ReleaseFact><ReleaseFact label="Foundry">{config.foundry}</ReleaseFact><ReleaseFact label="Model revision">{config.release.modelId}</ReleaseFact><ReleaseFact label="Capability report">{config.release.capabilityReportId}</ReleaseFact><ReleaseFact label="Policy report">{config.release.policyReportId ?? 'None captured'}</ReleaseFact><ReleaseFact label="Runtime source">{config.release.runtimeSourceModelId ?? 'Base runtime'}</ReleaseFact><ReleaseFact label="Manufacturing time">{config.leadWeeks} weeks</ReleaseFact><ReleaseFact label="Model distribution rights">{config.release.rights.weights ? 'Permitted' : 'Not permitted'}</ReleaseFact><ReleaseFact label="Fabrication paid">{item.fabricationPaid ? 'Confirmed' : 'Not confirmed'}</ReleaseFact><ReleaseFact label="Delivery setup paid">{item.deliverySetupPaid ? 'Confirmed' : 'Not confirmed'}</ReleaseFact></dl>
          {item.installedArtifact && <p className="release-desk-copy"><strong>Installed package:</strong> <span className="release-desk-id">{item.installedArtifact.id}</span> · accepted Week {item.installedArtifact.acceptedWeek}.</p>}
          <p className="release-desk-copy">This order keeps the model and hardware details you accepted. Later changes to their designs or names do not change the delivered package.</p>
        </details>
      </div>
    </section>
    <section className="release-desk-card" aria-labelledby="appliance-settlement-heading">
      <header className="release-desk-card-heading"><div><h3 id="appliance-settlement-heading">Payment and ongoing support</h3><p>Receive one payment for the equipment, then weekly license and support payments.</p></div><FileCheck2 size={23} aria-hidden="true" /></header>
      <div className="release-desk-card-body">
        {item.bundleSettled ? <div className="release-desk-receipt"><PackageCheck size={21} aria-hidden="true" /><div><strong>{formatMoney(order.bundlePriceCents)} bundle payment received</strong><p>Paid after acceptance · Week {order.settledWeek}<br /><span className="release-desk-id">{order.bundleReceiptId}</span></p></div></div> : <ReleaseNotice title={formatMoney(order.bundlePriceCents) + ' bundle payment pending'}>You receive the bundle payment once the buyer accepts the installed package. Shipping it or finishing staff work is not enough on its own.</ReleaseNotice>}
        <dl className="release-desk-facts">
          <ReleaseFact label="Manufacturing cost">{formatMoney(config.fabricationCostCents)}</ReleaseFact>
          <ReleaseFact label="Delivery setup">{formatMoney(contract.setupFeeCents)}</ReleaseFact>
          <ReleaseFact label="License & support price">{formatMoney(contract.weeklyPriceCents)} / week</ReleaseFact>
          <ReleaseFact label="Support staff needed">{formatWorkPoints(contract.supportStaffPerWeek)} Business points / week</ReleaseFact>
          <ReleaseFact label="Service term">{contract.termStartedWeek === null ? 'Begins on acceptance' : 'Week ' + contract.termStartedWeek + '–' + contract.termEndsWeek}<small>{serviceLabel}</small></ReleaseFact>
          <ReleaseFact label="Service billed / credits">{formatMoney(contract.lifetimeBilledCents)} / {formatMoney(contract.lifetimeCreditsCents)}</ReleaseFact>
        </dl>
        {contract.lastUsage && <ReleaseNotice tone={contract.lastUsage.creditsCents ? 'warning' : 'neutral'} title={'Week ' + contract.lastUsage.week + ' support results'}>{formatWorkPoints(contract.lastUsage.supportStaffGranted)} / {formatWorkPoints(contract.lastUsage.supportStaffRequired)} Business points provided; {releasePercent(contract.lastUsage.serviceBps)} service; {formatMoney(contract.lastUsage.billedCents)} billed after {formatMoney(contract.lastUsage.creditsCents)} credits. {contract.lastUsage.explanation}</ReleaseNotice>}
        {item.invoices.length > 0 && <details className="release-desk-details"><summary>Saved service invoices ({item.invoices.length})</summary><div className="release-desk-table-scroll"><table className="release-desk-table"><thead><tr><th scope="col">Week</th><th scope="col">Gross</th><th scope="col">Credits</th><th scope="col">Final bill</th></tr></thead><tbody>{[...item.invoices].sort((a, b) => b.week - a.week).map(invoice => <tr key={invoice.id}><th scope="row">{invoice.week}</th><td>{formatMoney(invoice.grossCents)}</td><td>{formatMoney(invoice.creditsCents)}</td><td>{formatMoney(invoice.amountCents)}</td></tr>)}</tbody></table></div></details>}
      </div>
    </section>
  </div>;
}

function PrivateApplianceContent(props: StudioReleaseDeskProps) {
  const { game, canAct, onQueue, onOpenPanel } = props;
  const view = useMemo(() => getPrivateApplianceView(game), [game]);
  const [modelId, setModelId] = useState('');
  const [designId, setDesignId] = useState('');
  const [foundry, setFoundry] = useState<ChipFoundry>('standard');
  const selectedModel = view.models.find(model => model.id === modelId);
  const selectedDesign = view.designs.find(design => design.id === designId);
  const preview = useMemo(() => previewPrivateApplianceOrder(game, { modelId, designId, foundry }), [game, modelId, designId, foundry]);
  const payload = selectedModel && selectedDesign ? { kind: 'accept_private_appliance_order' as const, buyerId: view.buyer.id, modelId, designId, foundry } : null;
  const workforce = getWorkforce(game, game.playerCompanyId);
  const order = view.orders[0];
  return <div id="private-appliance" className="release-desk-layout">
    <div className="release-desk-stack">
      {order ? <ApplianceOrder {...props} item={order} /> : <section className="release-desk-card" aria-labelledby="appliance-quote-heading">
        <header className="release-desk-card-heading"><div><span className="release-desk-kicker"><BadgeCheck size={13} aria-hidden="true" /> Model and hardware package</span><h3 id="appliance-quote-heading">Build a private appliance</h3><p>Choose the model, tested hardware, and manufacturer for {view.buyer.name}.</p></div><ReleaseStatus tone={view.unlocked ? 'good' : 'neutral'}>{view.unlocked ? 'S4 discovered' : 'S4 required'}</ReleaseStatus></header>
        <div className="release-desk-card-body">
          {!view.unlocked && <ReleaseNotice title="Research Private appliance (S4)">{view.gateReason}</ReleaseNotice>}
          {!view.available && <ReleaseNotice tone="warning" title="Buyer availability">{view.unavailableReason}</ReleaseNotice>}
          <div className="release-desk-form-grid">
            <label className="release-desk-field release-desk-form-wide" htmlFor="appliance-model">Evaluated model<select id="appliance-model" value={modelId} disabled={!canAct || !view.models.length} onChange={event => setModelId(event.target.value)}><option value="">{view.models.length ? 'Choose a model version' : 'Evaluate a compact or medium model'}</option>{modelId && !selectedModel && <option value={modelId}>Saved selection is no longer available</option>}{view.models.map(model => <option key={model.id} value={model.id}>{model.name}{model.eligible ? ' · qualified' : ' · review requirements'}</option>)}</select><small>The model must pass its capability and policy tests and allow distribution of its weights.</small></label>
            <label className="release-desk-field" htmlFor="appliance-design">Tested chip design<select id="appliance-design" value={designId} disabled={!canAct || !view.designs.length} onChange={event => setDesignId(event.target.value)}><option value="">{view.designs.length ? 'Choose validated hardware' : 'Design & prototype hardware first'}</option>{designId && !selectedDesign && <option value={designId}>Saved design is no longer available</option>}{view.designs.map(design => <option key={design.id} value={design.id}>{design.name}{design.eligible ? '' : ' · ' + design.status}</option>)}</select></label>
            <label className="release-desk-field" htmlFor="appliance-foundry">Manufacturer<select id="appliance-foundry" value={foundry} disabled={!canAct} onChange={event => setFoundry(event.target.value as ChipFoundry)}>{view.foundries.map(item => <option value={item.id} key={item.id}>{item.name}{item.availableRackSlots === null ? '' : ' · ' + item.availableRackSlots + ' rack slots'}</option>)}</select><small>Both racks need space in the shared manufacturing queue.</small></label>
          </div>
          {(modelId && !selectedModel || designId && !selectedDesign) && <ReleaseNotice tone="warning" title="Choose a replacement">The selected model or design is no longer available. Choose a replacement to continue.</ReleaseNotice>}
          {selectedModel && <dl className="release-desk-facts facts-three"><ReleaseFact label="Documents / reliability">{releasePercent(selectedModel.documentsBps)} / {releasePercent(selectedModel.reliabilityBps)}</ReleaseFact><ReleaseFact label="Weight distribution rights">{selectedModel.weights ? 'Permitted' : 'Not permitted'}</ReleaseFact><ReleaseFact label="Model memory">{formatUnits(selectedModel.residentMU)} MU</ReleaseFact></dl>}
          {(selectedModel || selectedDesign) && <ul className="release-desk-gates" aria-label="Package requirements">{selectedModel && <li className={selectedModel.eligible ? '' : 'is-blocked'}>{selectedModel.eligible ? <CircleCheck size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<div><strong>Model requirements</strong>{selectedModel.eligible ? 'This model passes the appliance’s launch requirements.' : selectedModel.reasons.join(' ')}</div></li>}{selectedDesign && <li className={selectedDesign.eligible ? '' : 'is-blocked'}>{selectedDesign.eligible ? <CircleCheck size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}<div><strong>Hardware requirements</strong>{selectedDesign.eligible ? 'Tested dense-inference design with wide memory.' : selectedDesign.reasons.join(' ')}</div></li>}</ul>}
          {preview.configuration && <dl className="release-desk-facts"><ReleaseFact label="Usable / required capacity">{formatUnits(preview.configuration.usableCU)} / {formatUnits(view.buyer.minimumUsefulCU)} CU</ReleaseFact><ReleaseFact label="Memory / workload requirement">{formatUnits(preview.configuration.memoryMU)} / {formatUnits(preview.configuration.requiredMemoryMU)} MU</ReleaseFact><ReleaseFact label="Weekly workload / throughput">{formatUnits(preview.configuration.weeklyWorkCUw)} / {formatUnits(preview.configuration.weeklyCapacityCUw)} CUw</ReleaseFact><ReleaseFact label="Manufacturing time">{preview.configuration.leadWeeks} weeks</ReleaseFact></dl>}
          <dl className="release-desk-facts">
            <ReleaseFact label="Payment when the buyer accepts">{formatMoney(preview.bundlePriceCents)}</ReleaseFact>
            <ReleaseFact label="Manufacturing cost">{preview.configuration ? formatMoney(preview.fabricationCostCents) : 'Select a qualified package'}</ReleaseFact>
            <ReleaseFact label="Delivery setup fee">{formatMoney(preview.deliverySetupCents)}</ReleaseFact>
            <ReleaseFact label="License & support term">{formatMoney(preview.licenseWeeklyCents)} / week · {preview.termWeeks} weeks</ReleaseFact>
          </dl>
          {modelId && designId && preview.reasons.length > 0 && <ReleaseNotice tone="warning" title="What this package still needs">{preview.reasons.join(' ')}</ReleaseNotice>}
          <ActionControl game={game} payload={payload} label="Accept appliance order" canAct={canAct} onQueue={onQueue} emptyReason="Choose a model and tested hardware to review the order and its costs." />
          <p className="release-desk-copy">Accepting locks in these choices and pays for manufacturing. {formatWorkPoints(preview.requiredDeliveryStaff)} Design points are required after direct shipment, followed by {formatWorkPoints(preview.supportStaffPerWeek)} Business points / week each service week. Staff pay is included in your usual company bills.</p>
        </div>
      </section>}
    </div>
    <aside className="release-desk-stack release-desk-side" aria-label="Buyer requirements and staffing">
      <ApplianceBuyer view={view} onOpenPanel={onOpenPanel} />
      <section className="release-desk-card" aria-labelledby="appliance-support-heading"><header className="release-desk-card-heading"><div><h3 id="appliance-support-heading">Delivery & support</h3><p>These staff also work on your other projects and contracts.</p></div><ShieldCheck size={22} aria-hidden="true" /></header><div className="release-desk-card-body"><dl className="release-desk-facts"><ReleaseFact label="Team Design output">{formatWorkPoints(workforce.capacity.ml)} points / week</ReleaseFact><ReleaseFact label="Delivery requirement">{formatWorkPoints(view.requiredDeliveryStaff)} points</ReleaseFact><ReleaseFact label="Team Business output">{formatWorkPoints(workforce.capacity.commercial)} points / week</ReleaseFact><ReleaseFact label="Weekly support needed">{formatWorkPoints(view.supportStaffPerWeek)} points / week</ReleaseFact></dl><p className="release-desk-copy">Too little support reduces service and can earn the customer credits. Other projects may need some of the staff shown here.</p><div className="release-desk-links"><ReleaseLink panel="people" onOpenPanel={onOpenPanel}>View team output</ReleaseLink>{!view.unlocked && <ReleaseLink panel="research" onOpenPanel={onOpenPanel}>Discover S4</ReleaseLink>}</div></div></section>
    </aside>
  </div>;
}

/** First visit is lazy; later hidden renders bail out without unmounting the draft. */
export const StudioPrivateAppliance = memo(function StudioPrivateAppliance(props: StudioReleaseDeskProps) {
  return props.active === false ? null : <PrivateApplianceContent {...props} />;
}, retainedReleasePropsEqual);
