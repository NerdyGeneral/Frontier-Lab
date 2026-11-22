'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { memo, useMemo, useState } from 'react';
import { Activity, ArrowRight, ClipboardCheck, FlaskConical, Layers3, Radio, Rocket, Server, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProductOffer } from '../contracts/wave1';
import type { ReleaseRehearsal } from '../contracts/wave9-rehearsals';
import type { CanaryCohortReceipt, CanaryView, CanaryViewRecord } from '../contracts/wave27-canary';
import { formatMoney, formatUnits } from '../core/math';
import { getComputePools } from '../modules/compute-pools';
import { getPreparedReleaseView } from '../modules/prepared-releases';
import { getCanaryView } from '../modules/release-canary';
import { getQualifiedReleaseRehearsal, rehearsalCapabilityReport, rehearsalTariffEstimateCents } from '../modules/release-rehearsals';
import { getWorkforce } from '../modules/workforce';
import { ActionControl, parseFixed, parseWhole } from './components';
import { ReleaseFact, ReleaseLink, ReleaseNotice, ReleaseProgress, ReleaseStatus, releaseCount, releasePercent, retainedReleasePropsEqual } from './release-desk-parts';
import type { StudioReleaseDeskProps } from './release-desk-parts';
import { StudioPrivateAppliance } from './studio-appliance-desk';

export type { StudioReleaseDeskProps } from './release-desk-parts';

interface PublicDraft {
  candidateId: string;
  releaseId: string;
  shareBps: 100 | 500 | 1000;
  sampleFloor: string;
  budgetCUw: string;
}

const productKind = (kind: ProductOffer['kind']) => kind === 'basic-chat' ? 'Chat' : kind === 'developer-api' ? 'Developer API' : 'Business documents';
const canaryLabel = (status: CanaryViewRecord['status']) => ({ scheduled: 'Scheduled', collecting: 'Testing with customers', qualified: 'Qualified', stopped: 'Stopped', promoted: 'Promoted' })[status];

function ComparisonTable({ source, candidate, rows, caption }: { source: ReactNode; candidate: ReactNode; caption: string; rows: Array<{ label: string; source: ReactNode; candidate: ReactNode }> }) {
  return <div className="release-desk-table-scroll"><table className="release-desk-table"><caption>{caption}</caption><thead><tr><th scope="col">Measure</th><th scope="col">Current model<strong>{source}</strong></th><th scope="col" className="release-desk-candidate">New model<strong>{candidate}</strong></th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.source}</td><td className="release-desk-candidate">{row.candidate}</td></tr>)}</tbody></table></div>;
}

function RehearsalEvidence({ rehearsal, ...props }: StudioReleaseDeskProps & { rehearsal: ReleaseRehearsal }) {
  const { game, canAct, onQueue } = props;
  const source = rehearsal.arms.source, candidate = rehearsal.arms.candidate;
  const reviewed = rehearsal.status === 'complete';
  const qualified = reviewed && getQualifiedReleaseRehearsal(game, rehearsal.productId, rehearsal.candidateModelId)?.id === rehearsal.id;
  return <div className="release-desk-rehearsal">
    <div className="release-desk-toolbar-meta"><ReleaseStatus tone={qualified ? 'good' : reviewed ? 'neutral' : 'active'}>{qualified ? 'Rehearsal passed' : reviewed ? 'Past rehearsal' : rehearsal.status === 'ready' ? 'Available Week ' + rehearsal.availableWeek : rehearsal.paused ? 'Rehearsal paused' : 'Rehearsal running'}</ReleaseStatus><span>Started Week {rehearsal.startedWeek}</span></div>
    <ReleaseProgress label="Design review" completed={rehearsal.completedStaff} required={rehearsal.requiredStaff} unit="points" />
    <ComparisonTable source={game.slices.models.versions[source.modelId]?.name ?? source.modelId} candidate={game.slices.models.versions[candidate.modelId]?.name ?? candidate.modelId} caption="Rehearsal · both models face the same test" rows={[
      { label: 'Development work', source: formatUnits(source.completedWork) + ' / ' + formatUnits(source.requiredWork) + ' CUw', candidate: formatUnits(candidate.completedWork) + ' / ' + formatUnits(candidate.requiredWork) + ' CUw' },
      { label: 'Memory needed', source: formatUnits(source.memoryMU) + ' MU', candidate: formatUnits(candidate.memoryMU) + ' MU' },
      { label: 'GPU work used', source: formatUnits(source.physicalWork) + ' CUw', candidate: formatUnits(candidate.physicalWork) + ' CUw' },
      { label: 'Estimated share of GPU costs', source: formatMoney(rehearsalTariffEstimateCents(source)), candidate: formatMoney(rehearsalTariffEstimateCents(candidate)) },
      ...(reviewed && source.outcomes && candidate.outcomes ? [
        { label: 'Useful answers / cases', source: source.outcomes.useful + ' / ' + source.outcomes.cases, candidate: candidate.outcomes.useful + ' / ' + candidate.outcomes.cases },
        { label: 'Confident errors', source: String(source.outcomes.confidentError), candidate: String(candidate.outcomes.confidentError) },
        { label: 'False refusals', source: String(source.outcomes.falseRefusal), candidate: String(candidate.outcomes.falseRefusal) },
        { label: 'Clarifications', source: String(source.outcomes.clarification), candidate: String(candidate.outcomes.clarification) },
      ] : []),
    ]} />
    <p className="release-desk-copy">This rehearsal compares answers and compute costs on a fixed set of ordinary requests. Check live capacity, retrieval, routing, conversation history, and response protection separately. The cost estimate is a share of your existing bills, not an extra charge.</p>
    {!reviewed && <ReleaseNotice tone="active">{rehearsal.lastBottleneck}</ReleaseNotice>}
    {rehearsal.status === 'running' && <ActionControl game={game} payload={{ kind: 'set_release_rehearsal_paused', rehearsalId: rehearsal.id, paused: !rehearsal.paused }} label={rehearsal.paused ? 'Resume rehearsal' : 'Pause rehearsal'} canAct={canAct} onQueue={onQueue} />}
  </div>;
}

function PreparedPath({ product, draft, onDraft, ...props }: StudioReleaseDeskProps & { product: ProductOffer; draft: PublicDraft; onDraft: (patch: Partial<PublicDraft>) => void }) {
  const { game, canAct, onQueue, onOpenPanel } = props;
  const view = useMemo(() => getPreparedReleaseView(game, product.id), [game, product.id]);
  const deployment = game.slices.products.deployments[product.deploymentId];
  const source = deployment && game.slices.models.versions[deployment.modelId];
  const candidates = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId && model.id !== source?.id);
  const candidate = candidates.find(model => model.id === draft.candidateId);
  const rehearsal = candidate ? getQualifiedReleaseRehearsal(game, product.id, candidate.id) : undefined;
  const history = Object.values(game.slices.products.releaseRehearsals ?? {}).filter(item => item.productId === product.id).sort((a, b) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id));
  const ongoingRehearsal = history.find(item => item.status !== 'complete');
  const current = view.current, work = view.work;
  const rollback = !!current?.rollback && ['preparing', 'ready', 'scheduled'].includes(current.rollback.status);
  const sourceReport = source ? rehearsalCapabilityReport(game, source.id) : undefined;
  const candidateReport = candidate ? rehearsalCapabilityReport(game, candidate.id) : undefined;
  return <section className="release-desk-card" aria-labelledby="release-preparation-heading" id="release-preparation">
    <header className="release-desk-card-heading"><div><span className="release-desk-kicker"><Layers3 size={13} aria-hidden="true" /> Compare · prepare · hand over</span><h3 id="release-preparation-heading">{rollback ? 'Prepare the previous model' : 'Prepare a model release'}</h3><p>Customers keep using the current model while ML staff and development compute prepare the replacement.</p></div><ReleaseStatus tone={current ? 'active' : view.researched ? 'good' : 'neutral'}>{current && work ? work.status === 'scheduled' ? 'Handover scheduled' : work.status === 'ready' ? 'Ready to switch' : work.paused ? 'Preparation paused' : 'Preparing' : view.researched ? 'R12 discovered' : 'R12 required'}</ReleaseStatus></header>
    <div className="release-desk-card-body">
      {!view.researched && <ReleaseNotice title="Research Enterprise operations (R12)">R12 unlocks rehearsals and release preparation. The new model also needs its own paid tests and must meet the product’s launch requirements.</ReleaseNotice>}
      {current && work ? <>
        <dl className="release-desk-facts"><ReleaseFact label={rollback ? 'Restore model' : 'New model'}>{game.slices.models.versions[rollback ? current.sourceModelId : current.candidateModelId]?.name ?? (rollback ? current.sourceModelId : current.candidateModelId)}</ReleaseFact><ReleaseFact label="Current live model">{source?.name ?? 'Unavailable'}<small>{deployment?.id}</small></ReleaseFact></dl>
        <ReleaseProgress label="Development compute" completed={work.completedWork} required={work.requiredWork} unit="CUw" />
        <ReleaseProgress label="Design preparation" completed={work.completedStaff} required={work.requiredStaff} unit="points" />
        <dl className="release-desk-facts"><ReleaseFact label="Memory for preparation">{formatUnits(work.requiredMemory)} MU</ReleaseFact><ReleaseFact label="GPU work used">{formatUnits(work.physicalWork)} CUw</ReleaseFact></dl>
        <ReleaseNotice tone={work.status === 'ready' ? 'good' : 'active'} title={work.status === 'scheduled' ? 'Handover Week ' + work.cutoverWeek : work.status === 'ready' ? 'Available from Week ' + work.availableWeek : 'Preparation status'}>{work.lastBottleneck}</ReleaseNotice>
        {work.lastGrant && <p className="release-desk-copy">Resources used in Week {work.lastGrant.week}: {formatUnits(work.lastGrant.grantedWork)} / {formatUnits(work.lastGrant.requestedWork)} development CUw, {formatWorkPoints(work.lastGrant.staff)} Design points and {formatUnits(work.lastGrant.memoryMU)} MU in {work.lastGrant.poolId}.</p>}
        {work.status === 'preparing' && <ActionControl game={game} payload={{ kind: 'set_prepared_release_paused', releaseId: current.id, paused: !work.paused }} label={work.paused ? 'Resume preparation' : 'Pause preparation'} canAct={canAct} onQueue={onQueue} />}
        {work.status === 'ready' && <><p className="release-desk-copy">{rollback ? 'The option to switch back still ends in Week ' + current.rollbackExpiresWeek + '.' : 'Try the new model with a small group of customers below, or schedule the full switch. Review checks that both models and the product settings still qualify.'}</p><ActionControl game={game} payload={{ kind: 'promote_prepared_release', releaseId: current.id }} label={rollback ? 'Schedule return to previous model' : 'Schedule model switch'} canAct={canAct} onQueue={onQueue} /></>}
        {['preparing', 'ready'].includes(work.status) && <details className="release-desk-details"><summary>Discard this preparation</summary><p className="release-desk-copy">Work already done is not refunded. Discard this preparation to choose another model or change the product settings.</p><ActionControl game={game} payload={{ kind: 'discard_prepared_release', releaseId: current.id }} label="Discard release preparation" canAct={canAct} onQueue={onQueue} /></details>}
      </> : <>
        {!ongoingRehearsal && <>
          <label className="release-desk-field" htmlFor="release-candidate-model">New model<select id="release-candidate-model" value={draft.candidateId} onChange={event => onDraft({ candidateId: event.target.value })} disabled={!canAct || !candidates.length}><option value="">{candidates.length ? 'Choose the model to release' : 'Train and evaluate a replacement model'}</option>{draft.candidateId && !candidate && <option value={draft.candidateId}>Selected model is no longer available</option>}{candidates.map(model => <option value={model.id} key={model.id}>{model.name}{model.status === 'checkpoint' ? ' · needs evaluation' : ''}</option>)}</select></label>
          {draft.candidateId && !candidate && <ReleaseNotice tone="warning">This model is no longer available for the product. Choose another model to continue.</ReleaseNotice>}
          {source && candidate && <ComparisonTable source={source.name} candidate={candidate.name} caption="Compare models · launch requirements are checked below" rows={[
            { label: 'Model revision', source: source.id, candidate: candidate.id },
            { label: 'Paid capability report', source: sourceReport ? sourceReport.id : 'No matching report', candidate: candidateReport ? candidateReport.id : 'No matching report' },
            { label: 'Model memory', source: formatUnits(source.residentMU) + ' MU', candidate: formatUnits(candidate.residentMU) + ' MU' },
            { label: 'Documents / coding', source: releasePercent(source.capabilityBps.documents) + ' / ' + releasePercent(source.capabilityBps.coding), candidate: releasePercent(candidate.capabilityBps.documents) + ' / ' + releasePercent(candidate.capabilityBps.coding) },
            { label: 'Reliability', source: releasePercent(source.reliabilityBps), candidate: releasePercent(candidate.reliabilityBps) },
          ]} />}
          <ActionControl game={game} payload={candidate ? rehearsal ? { kind: 'start_prepared_release', productId: product.id, candidateModelId: candidate.id } : { kind: 'start_release_rehearsal', productId: product.id, candidateModelId: candidate.id } : null} label={rehearsal ? 'Prepare this model for release' : 'Start a model rehearsal'} canAct={canAct} onQueue={onQueue} emptyReason="Choose a model to check its test results, hosting rights, policy tests, and memory needs." />
        </>}
        {ongoingRehearsal && <RehearsalEvidence {...props} rehearsal={ongoingRehearsal} />}
        {rehearsal && !ongoingRehearsal && <details className="release-desk-details"><summary>View this model’s rehearsal</summary><RehearsalEvidence {...props} rehearsal={rehearsal} /></details>}
        {view.retained && <details className="release-desk-details"><summary>Previous model · switch-back option</summary><p className="release-desk-copy">Restore {game.slices.models.versions[view.retained.sourceModelId]?.name ?? view.retained.sourceModelId}. The option to restore it ends after Week {view.retained.rollbackExpiresWeek}; pausing does not extend that window.</p><ActionControl game={game} payload={{ kind: 'start_release_rollback', releaseId: view.retained.id }} label="Prepare to switch back" canAct={canAct} onQueue={onQueue} /></details>}
      </>}
      <div className="release-desk-links"><ReleaseLink panel={product.kind === 'developer-api' ? 'developer-api' : product.kind === 'business-docs' ? 'business-commitments' : 'product'} onOpenPanel={onOpenPanel}>Product settings</ReleaseLink><ReleaseLink panel="models" onOpenPanel={onOpenPanel}>Model test results</ReleaseLink>{!view.researched && <ReleaseLink panel="research" onOpenPanel={onOpenPanel}>Discover R12</ReleaseLink>}</div>
      {(history.some(item => item.status === 'complete') || view.releases.length > 0) && <details className="release-desk-details"><summary>Preparation and rehearsal history</summary>{view.releases.map(release => <div className="release-desk-history-item" key={release.id}><header><h4>{game.slices.models.versions[release.sourceModelId]?.name ?? release.sourceModelId} <ArrowRight size={12} aria-label="to" /> {game.slices.models.versions[release.candidateModelId]?.name ?? release.candidateModelId}</h4><ReleaseStatus>{release.status}</ReleaseStatus></header><p>Started Week {release.startedWeek}; {formatUnits(release.completedWork)} / {formatUnits(release.requiredWork)} development CUw and {formatWorkPoints(release.completedStaff)} / {formatWorkPoints(release.requiredStaff)} Design points.{release.releasedWeek !== null ? ' Released Week ' + release.releasedWeek + '.' : ''}{release.rollbackExpiresWeek !== null ? ' Switch-back deadline: Week ' + release.rollbackExpiresWeek + '.' : ''}</p><p className="release-desk-id">{release.id}</p></div>)}{history.filter(item => item.status === 'complete' && item.id !== rehearsal?.id).map(item => <details className="release-desk-details" key={item.id}><summary>Week {item.startedWeek} rehearsal · {game.slices.models.versions[item.candidateModelId]?.name ?? item.candidateModelId}</summary><RehearsalEvidence {...props} rehearsal={item} /></details>)}</details>}
    </div>
  </section>;
}

function CanaryStart({ view, draft, onDraft, ...props }: StudioReleaseDeskProps & { view: CanaryView; draft: PublicDraft; onDraft: (patch: Partial<PublicDraft>) => void }) {
  const { game, canAct, onQueue, onOpenPanel } = props;
  const release = view.releases.find(item => item.releaseId === draft.releaseId);
  const sampleFloor = parseWhole(draft.sampleFloor), budgetCUw = parseFixed(draft.budgetCUw, 9);
  const payload = release && sampleFloor !== null && budgetCUw !== null ? { kind: 'start_release_canary' as const, releaseId: release.releaseId, shareBps: draft.shareBps, sampleFloor, budgetCUw } : null;
  return <section className="release-desk-card" aria-labelledby="release-canary-start-heading">
    <header className="release-desk-card-heading"><div><span className="release-desk-kicker"><Radio size={13} aria-hidden="true" /> Gradual release</span><h3 id="release-canary-start-heading">Live test (canary)</h3><p>Try the prepared model on a small share of paying customers’ requests. Trial users keep the current model.</p></div><ReleaseStatus tone={view.researched ? 'good' : 'neutral'}>{view.researched ? 'S3 discovered' : 'S3 required'}</ReleaseStatus></header>
    <div className="release-desk-card-body">
      {!view.researched && <ReleaseNotice title="Release telemetry (S3)">{view.researchReason ?? 'Discover S3 before starting a live test.'}</ReleaseNotice>}
      <label className="release-desk-field" htmlFor="release-canary-bundle">Prepared model<select id="release-canary-bundle" value={draft.releaseId} onChange={event => onDraft({ releaseId: event.target.value })} disabled={!canAct || !view.releases.length}><option value="">{view.releases.length ? 'Choose a prepared model to test' : 'Complete a paid rehearsal and release preparation'}</option>{draft.releaseId && !release && <option value={draft.releaseId}>Selected release is no longer available</option>}{view.releases.map(item => <option value={item.releaseId} key={item.releaseId}>{item.candidateName}{item.eligible ? ' · eligible' : ' · check requirements'}</option>)}</select></label>
      {draft.releaseId && !release && <ReleaseNotice tone="warning">This prepared release is no longer available. Choose another release to continue.</ReleaseNotice>}
      {release && !release.eligible && <ReleaseNotice tone="warning" title="Release requirements">{release.reason}</ReleaseNotice>}
      <div className="release-desk-form-grid form-three">
        <label className="release-desk-field" htmlFor="release-canary-share">New model’s traffic<select id="release-canary-share" value={draft.shareBps} onChange={event => onDraft({ shareBps: Number(event.target.value) as PublicDraft['shareBps'] })} disabled={!canAct}>{view.rules.shares.map(share => <option key={share} value={share}>{releasePercent(share)} of eligible paid requests</option>)}</select><small>All other requests use the current model.</small></label>
        <label className="release-desk-field" htmlFor="release-canary-samples">Minimum requests per model<input id="release-canary-samples" type="text" inputMode="numeric" value={draft.sampleFloor} onChange={event => onDraft({ sampleFloor: event.target.value })} disabled={!canAct} /><small>{releaseCount(view.rules.minimumSample)}–{releaseCount(view.rules.maximumSample)} completed requests for each model.</small></label>
        <label className="release-desk-field" htmlFor="release-canary-budget">New model’s compute limit (CUw)<input id="release-canary-budget" type="text" inputMode="decimal" value={draft.budgetCUw} onChange={event => onDraft({ budgetCUw: event.target.value })} disabled={!canAct} /><small>Total limit for the test; up to {formatUnits(view.rules.maximumBudgetCUw)} CUw.</small></label>
      </div>
      <div><div className="release-desk-cohort-bar" aria-hidden="true"><span style={{ width: (10000 - draft.shareBps) / 100 + '%' }} /><span style={{ width: draft.shareBps / 100 + '%' }} /></div><div className="release-desk-cohort-labels"><span>Current model · {releasePercent(10000 - draft.shareBps)}</span><span>New model · {releasePercent(draft.shareBps)}</span></div></div>
      <ReleaseNotice title={formatMoney(view.rules.setupFeeCents) + ' setup · plus serving costs'}>The CUw limit caps compute used by the new model. Serving costs are paid as the test runs. Both models share serving capacity and appear on the same product invoice. The selected release locks in its model, routing, memory, and protection settings.</ReleaseNotice>
      <p className="release-desk-copy">The test stops if results worsen, a serious incident occurs, compute or budget runs out, or the setup changes. Both models need the minimum number of completed requests to qualify. After the test passes, traffic returns to the current model until you choose to switch.</p>
      <details className="release-desk-details"><summary>What makes a test pass or stop?</summary><p className="release-desk-copy">Once both models reach the minimum sample, a {view.rules.regressionBps / 100}-percentage-point worsening in useful answers, confident errors, or false refusals stops the test. The new model’s compute cost per completed request must stay at or below {releasePercent(view.rules.maximumCostRatioBps)} of the current model’s cost. Each group must receive at least {releasePercent(view.rules.minimumFulfillmentBps)} of its requested service. A serious incident can stop the test before the full sample is ready. After {view.rules.maximumObservations} weeks without enough results, the test still cannot expand.</p></details>
      <ActionControl game={game} payload={payload} label="Start live test" canAct={canAct} onQueue={onQueue} emptyReason="Choose a prepared model, a whole-number sample size, and a valid compute limit to review the test." />
      {!view.researched && <ReleaseLink panel="research" onOpenPanel={onOpenPanel}>Discover S3</ReleaseLink>}
    </div>
  </section>;
}

function cohortRows(incumbent: CanaryCohortReceipt, candidate: CanaryCohortReceipt) {
  const both = (label: string, render: (arm: CanaryCohortReceipt) => ReactNode) => ({ label, source: render(incumbent), candidate: render(candidate) });
  return [
    both('Executed / requested', arm => releaseCount(arm.executedRequests) + ' / ' + releaseCount(arm.requestedRequests)),
    both('Fulfillment', arm => releasePercent(arm.fulfillmentBps)),
    both('Useful answers', arm => releaseCount(arm.outcomes.useful)),
    both('Confident errors', arm => releaseCount(arm.outcomes.confidentError)),
    both('False refusals', arm => releaseCount(arm.outcomes.falseRefusal)),
    both('Clarifications', arm => releaseCount(arm.outcomes.clarification)),
    both('Technical error', arm => releasePercent(arm.errorBps)),
    both('Granted / requested work', arm => formatUnits(arm.effectiveWorkCUw) + ' / ' + formatUnits(arm.requestedWorkCUw) + ' CUw'),
    both('GPU work used', arm => formatUnits(arm.physicalWorkCUw) + ' CUw'),
    both('Granted / required memory', arm => formatUnits(arm.grantedMemoryMU) + ' / ' + formatUnits(arm.requiredMemoryMU) + ' MU'),
    both('Attributed compute cost', arm => formatMoney(arm.attributedComputeCents)),
  ];
}

function CanaryReport({ canary, rules, historical = false, ...props }: StudioReleaseDeskProps & { canary: CanaryViewRecord; rules: CanaryView['rules']; historical?: boolean }) {
  const { game, canAct, onQueue } = props;
  const [chosenWeek, setChosenWeek] = useState<number | null>(null);
  const receipt = chosenWeek === null ? canary.latest : canary.observations.find(item => item.week === chosenWeek) ?? null;
  const samplesReady = canary.assessment.sufficient;
  const invoice = receipt ? game.slices.products.invoices.find(item => item.productId === canary.productId && item.week === receipt.week) : undefined;
  const invoiceId = receipt ? 'invoice:' + canary.productId + ':' + receipt.week : null;
  const invoicePosted = invoiceId !== null && game.slices.company.postedFacts[invoiceId] === true;
  const restorationWeek = canary.incident?.restoredRoutingWeek ?? (canary.status === 'qualified' && canary.qualifiedWeek !== null ? canary.qualifiedWeek + 1 : null);
  const assessmentRate = (value: number, samples: number) => samples > 0 ? releasePercent(value) : 'No completed requests';
  const pools = getComputePools(game, game.playerCompanyId);
  const poolName = (id: string | null) => id ? pools.find(pool => pool.id === id)?.name ?? id : 'No GPU pool assigned';
  return <section className="release-desk-card" aria-labelledby={'canary-report-' + canary.id}>
    <header className="release-desk-card-heading"><div><span className="release-desk-kicker"><Activity size={13} aria-hidden="true" /> Live test results</span><h3 id={'canary-report-' + canary.id}>{canary.sourceName} <ArrowRight size={18} aria-label="to" /> {canary.candidateName}</h3><p>Started Week {canary.startedWeek} · {releasePercent(canary.shareBps)} test traffic · {formatUnits(canary.budgetCUw)} CUw budget</p></div><ReleaseStatus tone={canary.status === 'qualified' || canary.status === 'promoted' ? 'good' : canary.status === 'stopped' ? 'warning' : 'active'}>{canaryLabel(canary.status)}</ReleaseStatus></header>
    <div className="release-desk-card-body">
      <dl className="release-desk-facts facts-three"><ReleaseFact label={canary.status === 'scheduled' ? 'Scheduled test traffic' : canary.status === 'collecting' ? 'Current test traffic' : 'Next week’s test traffic'}>{releasePercent(canary.status === 'scheduled' ? canary.shareBps : canary.activeShareBps)}<small>{canary.status === 'promoted' ? 'Test ended when models switched' : canary.status === 'scheduled' ? 'Available from Week ' + canary.availableWeek : canary.activeShareBps ? 'Of eligible paid requests' : restorationWeek !== null && game.week < restorationWeek ? 'Previous model only from Week ' + restorationWeek : 'Previous model restored'}</small></ReleaseFact><ReleaseFact label="New model’s compute remaining">{formatUnits(canary.remainingBudgetCUw)} CUw<small>{formatUnits(canary.consumedWorkCUw)} CUw used</small></ReleaseFact><ReleaseFact label="Completed test requests">{releaseCount(canary.candidateSamples)} new model<small>{releaseCount(canary.incumbentSamples)} current model · needs {releaseCount(canary.sampleFloor)} each</small></ReleaseFact></dl>
      <ReleaseNotice tone={canary.status === 'stopped' ? 'warning' : canary.status === 'qualified' ? 'good' : 'active'} title={canary.status === 'qualified' ? 'Test passed · choose when to switch' : canary.status === 'stopped' ? 'Live test stopped · Week ' + canary.stoppedWeek : !samplesReady ? 'More test requests needed' : 'Release status'}>{canary.lastMessage}</ReleaseNotice>
      <details className="release-desk-details"><summary>Overall test results · {samplesReady ? 'enough requests completed' : 'more requests needed'}</summary><ComparisonTable source={canary.sourceName} candidate={canary.candidateName} caption="Answer rates · all completed test requests" rows={[
        { label: 'Useful answers', source: assessmentRate(canary.assessment.incumbentUsefulBps, canary.incumbentSamples), candidate: assessmentRate(canary.assessment.candidateUsefulBps, canary.candidateSamples) },
        { label: 'Confident errors', source: assessmentRate(canary.assessment.incumbentConfidentErrorBps, canary.incumbentSamples), candidate: assessmentRate(canary.assessment.candidateConfidentErrorBps, canary.candidateSamples) },
        { label: 'False refusals', source: assessmentRate(canary.assessment.incumbentFalseRefusalBps, canary.incumbentSamples), candidate: assessmentRate(canary.assessment.candidateFalseRefusalBps, canary.candidateSamples) },
      ]} /><p className="release-desk-copy">New model’s compute cost per completed request: <strong>{canary.assessment.costRatioBps === null ? 'No comparable rate yet' : releasePercent(canary.assessment.costRatioBps) + ' of the current model'}</strong>; limit {releasePercent(rules.maximumCostRatioBps)}. A {rules.regressionBps / 100}-percentage-point worsening in results stops the test once enough requests are complete. Review the current release requirements before switching models.</p></details>
      {canary.observations.length > 0 ? <>
        <label className="release-desk-field release-desk-product-select" htmlFor={'canary-observation-' + canary.id}>Test week<select id={'canary-observation-' + canary.id} value={chosenWeek ?? 'latest'} onChange={event => setChosenWeek(event.target.value === 'latest' ? null : Number(event.target.value))}><option value="latest">Latest results{canary.latest ? ' · Week ' + canary.latest.week : ''}</option>{[...canary.observations].sort((a, b) => b.week - a.week).map(item => <option value={item.week} key={item.week}>Week {item.week}</option>)}</select></label>
        {receipt ? <>
          <ComparisonTable source={canary.sourceName} candidate={canary.candidateName} caption={'Week ' + receipt.week + ' · separate groups of paid requests'} rows={cohortRows(receipt.incumbent, receipt.candidate)} />
          <p className="release-desk-copy">Results count completed requests only. The groups differ in size, so compare rates as well as totals. Compute costs come from the GPUs used and are already included in your bills.</p>
          <dl className="release-desk-facts"><ReleaseFact label="Current model’s GPU pool">{poolName(receipt.incumbent.poolId)}</ReleaseFact><ReleaseFact label="New model’s GPU pool">{poolName(receipt.candidate.poolId)}</ReleaseFact><ReleaseFact label="Combined product bill">{formatMoney(receipt.billedCents)}<small>{formatMoney(receipt.grossBillCents)} gross less {formatMoney(receipt.creditsCents)} service credits</small><small>{invoice ? 'Saved invoice · ' + invoice.id : invoicePosted ? 'Payment confirmed; the invoice is older than the visible history.' : receipt.paidAccounts === 0 ? 'No paid accounts; no invoice posted.' : 'Saved bill amount; payment confirmation is unavailable.'}</small></ReleaseFact><ReleaseFact label="Trial use on the current model">{formatUnits(receipt.trialExecutedWorkCUw)} / {formatUnits(receipt.trialRequestedWorkCUw)} CUw</ReleaseFact></dl>
          <details className="release-desk-details"><summary>Token use and customer groups</summary><ComparisonTable source={canary.sourceName} candidate={canary.candidateName} caption="Token use · included in one product bill" rows={[
            { label: 'Input tokens', source: releaseCount(receipt.incumbent.inputTokens), candidate: releaseCount(receipt.candidate.inputTokens) },
            { label: 'Output tokens', source: releaseCount(receipt.incumbent.outputTokens), candidate: releaseCount(receipt.candidate.outputTokens) },
            { label: 'Internal tokens', source: releaseCount(receipt.incumbent.internalTokens), candidate: releaseCount(receipt.candidate.internalTokens) },
          ]} />{(['incumbent', 'candidate'] as const).map(arm => <div key={arm}><h4>{arm === 'incumbent' ? 'Current model' : 'New model'} segments</h4><div className="release-desk-table-scroll"><table className="release-desk-table"><thead><tr><th scope="col">Segment</th><th scope="col">Executed / requested</th><th scope="col">Useful</th><th scope="col">Confident errors</th></tr></thead><tbody>{receipt[arm].segments.map(segment => <tr key={segment.segmentId}><th scope="row">{segment.segmentId}</th><td>{releaseCount(segment.executedRequests)} / {releaseCount(segment.requestedRequests)}</td><td>{releaseCount(segment.outcomes.useful)}</td><td>{releaseCount(segment.outcomes.confidentError)}</td></tr>)}</tbody></table></div></div>)}</details>
        </> : <ReleaseNotice tone="warning">These results are no longer available. Choose the latest test week.</ReleaseNotice>}
      </> : <p className="release-desk-copy">No test results yet. The first requests can run from Week {canary.availableWeek}; the sample size depends on paying customers and available serving compute.</p>}
      {canary.status === 'qualified' && !historical && <><p className="release-desk-copy">{canary.promotionReason ?? 'This live test passed. You can schedule the prepared model switch.'}</p><ActionControl game={game} payload={{ kind: 'promote_prepared_release', releaseId: canary.releaseId }} label="Schedule tested model switch" canAct={canAct} onQueue={onQueue} extraDisabled={!canary.canPromote} /></>}
      {historical && canary.incident && <details className="release-desk-details"><summary>Test stopped · Week {canary.incident.week}</summary><ReleaseNotice tone="warning" title={canary.incident.severity + ' · ' + canary.incident.code}>{canary.incident.message}</ReleaseNotice><p className="release-desk-copy">Affected revision {canary.incident.modelId}, deployment {canary.incident.deploymentId}. Routing restored in Week {canary.incident.restoredRoutingWeek}. Recorded sample: {releaseCount(canary.incident.candidateSamples)} new model / {releaseCount(canary.incident.incumbentSamples)} original model; minimum {releaseCount(canary.incident.sampleFloor)} each.</p></details>}
      <details className="release-desk-details"><summary>Models and settings used</summary>
        <ComparisonTable source={canary.sourceName} candidate={canary.candidateName} caption="Test records from the start of this live test" rows={[
          { label: 'Model revision', source: canary.source.modelId, candidate: canary.candidate.modelId },
          { label: 'Capability report', source: canary.source.capabilityReportId, candidate: canary.candidate.capabilityReportId },
          { label: 'Policy report', source: canary.source.policyReportId ?? 'None captured', candidate: canary.candidate.policyReportId ?? 'None captured' },
          { label: 'Runtime source', source: canary.source.runtimeSourceModelId ?? 'Base runtime', candidate: canary.candidate.runtimeSourceModelId ?? 'Base runtime' },
          { label: 'Hosted commercial rights', source: canary.source.rights.hosted ? 'Permitted' : 'Not permitted', candidate: canary.candidate.rights.hosted ? 'Permitted' : 'Not permitted' },
        ]} />
        <dl className="release-desk-facts"><ReleaseFact label="Fixed product features">{[canary.features.memory && 'Memory', canary.features.extendedContext && 'Extended context', canary.features.deepReasoning && 'Deep reasoning'].filter(Boolean).join(' · ') || 'Standard features'}</ReleaseFact><ReleaseFact label="Runtime guardrail">{canary.configuration.guardrail ? canary.configuration.guardrail.profile + (canary.configuration.guardrail.enabled ? ' · enabled' : ' · disabled') : 'None captured'}</ReleaseFact><ReleaseFact label="Retrieval">{canary.configuration.retrieval ? canary.configuration.retrieval.packetId : 'None captured'}</ReleaseFact><ReleaseFact label="Serving settings">{canary.configuration.efficiency.filter(item => item.enabled).map(item => item.kind).join(' · ') || 'Direct model route'}</ReleaseFact></dl>
        <p className="release-desk-copy">Changing these settings requires a new test before release. Each test week records the memory and compute that both models received.</p>
        <p className="release-desk-id">{canary.id}</p>
      </details>
    </div>
  </section>;
}

function IncidentDesk({ canary, ...props }: StudioReleaseDeskProps & { canary: CanaryViewRecord | undefined }) {
  const { game, canAct, onQueue, onOpenPanel } = props;
  const incident = canary?.incident;
  const investigationPanel = incident?.code === 'headroom' || incident?.code === 'budget' ? 'compute' : incident?.code === 'configuration' ? 'product' : incident?.code === 'arrears' ? 'business' : 'models';
  const investigationLabel = investigationPanel === 'compute' ? 'Review capacity & allocation' : investigationPanel === 'product' ? 'Review product settings' : investigationPanel === 'business' ? 'Inspect unpaid bills' : 'Review model test results';
  return <section className="release-desk-card" aria-labelledby="release-incident-heading"><header className="release-desk-card-heading"><div><h3 id="release-incident-heading">Incident desk</h3><p>See why a test stopped and what needs attention.</p></div>{incident ? <TriangleAlert size={23} aria-hidden="true" /> : <ShieldCheck size={23} aria-hidden="true" />}</header><div className="release-desk-card-body">
    {incident ? <>
      <ReleaseStatus tone={incident.severity === 'notice' ? 'neutral' : 'warning'}>{incident.severity === 'severe' ? 'Severe incident' : incident.severity === 'major' ? 'Major stop' : 'Release notice'} · Week {incident.week}</ReleaseStatus>
      <ReleaseNotice tone="warning" title={game.week < incident.restoredRoutingWeek ? 'Previous model only from Week ' + incident.restoredRoutingWeek : 'Previous model restored'}>Decision recorded in Week {incident.week}: {incident.message}</ReleaseNotice>
      <dl className="release-desk-facts"><ReleaseFact label="Affected model">{game.slices.models.versions[incident.modelId]?.name ?? incident.modelId}<small>{incident.modelId}</small></ReleaseFact><ReleaseFact label="Product">{canary?.productName}<small>Deployment {incident.deploymentId}</small></ReleaseFact><ReleaseFact label="Evidence quality">{incident.candidateSamples >= incident.sampleFloor && incident.incumbentSamples >= incident.sampleFloor ? 'Sample floor reached' : 'Below sample floor'}<small>{releaseCount(incident.candidateSamples)} new model / {releaseCount(incident.incumbentSamples)} incumbent</small></ReleaseFact><ReleaseFact label="Routing restoration">{game.week < incident.restoredRoutingWeek ? 'Scheduled Week ' : 'Completed Week '}{incident.restoredRoutingWeek}</ReleaseFact></dl>
      <p className="release-desk-copy">This live test has ended. Customer service is billed as usual, including any service credits.</p>
      <ReleaseLink panel={investigationPanel} onOpenPanel={onOpenPanel}>{investigationLabel}</ReleaseLink>
    </> : canary && (canary.status === 'scheduled' || canary.status === 'collecting') ? <>
      <ReleaseStatus tone="good">No incidents reported</ReleaseStatus>
      <p className="release-desk-copy">{canary.status === 'scheduled' ? 'The configured ' + releasePercent(canary.shareBps) + ' share of test traffic begins in Week ' + canary.availableWeek + '. No test requests have finished yet.' : 'Only the configured ' + releasePercent(canary.shareBps) + ' share of paid requests uses the new model.'} Stop the test to return all paid requests to the previous model next week. Collected results stay in the history.</p>
      <ActionControl game={game} payload={{ kind: 'stop_release_canary', canaryId: canary.id }} label="Stop test and restore previous model" canAct={canAct} onQueue={onQueue} />
    </> : <>
      <ReleaseStatus tone="good">No live test to stop</ReleaseStatus>
      <p className="release-desk-copy">{canary?.status === 'qualified' ? 'The test passed. All traffic returns to the previous model next week until you schedule the full switch.' : canary?.status === 'promoted' ? 'The new model is live. If the switch-back option is still available, restoring the previous model needs separate preparation.' : 'Live tests report poor results, serious incidents, missing samples, and capacity problems here, along with the week traffic returns to the previous model.'}</p>
    </>}
  </div></section>;
}

function ReleaseCapacity({ game, onOpenPanel }: Pick<StudioReleaseDeskProps, 'game' | 'onOpenPanel'>) {
  const workforce = getWorkforce(game, game.playerCompanyId), fleet = game.slices.compute.fleets[game.playerCompanyId];
  const pools = getComputePools(game, game.playerCompanyId);
  return <section className="release-desk-card" aria-labelledby="release-capacity-heading"><header className="release-desk-card-heading"><div><h3 id="release-capacity-heading">Room to release</h3><p>Staff and compute available for next week’s work.</p></div><Server size={22} aria-hidden="true" /></header><div className="release-desk-card-body">
    <dl className="release-desk-facts"><ReleaseFact label="Team Design output">{formatWorkPoints(workforce.capacity.ml)} points / week</ReleaseFact><ReleaseFact label="Infrastructure staff">{formatWorkPoints(workforce.capacity.infrastructure)} points / week</ReleaseFact><ReleaseFact label="Serving ceiling">{formatUnits(fleet.allocation.serving)} CUw / week</ReleaseFact><ReleaseFact label="Development ceiling">{formatUnits(fleet.allocation.development)} CUw / week</ReleaseFact></dl>
    <p className="release-desk-copy">Preparation uses development compute and ML staff. Live tests use serving compute and memory for both models. Existing customers and signed contracts share these pools, so the test may receive less than the displayed limits.</p>
    <details className="release-desk-details"><summary>Connected pools ({pools.length})</summary>{pools.length ? pools.map(pool => <div className="release-desk-history-item" key={pool.id}><header><h4>{pool.name}</h4><ReleaseStatus>{pool.ownership === 'cloud' ? 'Cloud' : 'Owned'}</ReleaseStatus></header><p>{formatUnits(pool.capacityCU)} usable CU · {formatUnits(pool.memoryMU)} connected MU.</p>{pool.bottleneck && <p>{pool.bottleneck}</p>}</div>) : <p className="release-desk-copy">No connected pool is online.</p>}</details>
    <div className="release-desk-links"><ReleaseLink panel="compute" onOpenPanel={onOpenPanel}>Allocate compute</ReleaseLink><ReleaseLink panel="people" onOpenPanel={onOpenPanel}>View team output</ReleaseLink></div>
  </div></section>;
}

function PublicReleaseWorkspace(props: StudioReleaseDeskProps) {
  const { game, onOpenPanel } = props;
  const products = Object.values(game.slices.products.offers).filter(product => product.companyId === game.playerCompanyId);
  const [productId, setProductId] = useState(() => products.find(product => product.status === 'active')?.id ?? products[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, PublicDraft>>({});
  const selectedProduct = products.find(product => product.id === productId);
  const view = useMemo(() => getCanaryView(game, selectedProduct?.id), [game, selectedProduct?.id]);
  const draft = drafts[productId] ?? { candidateId: '', releaseId: '', shareBps: 1000, sampleFloor: String(view.rules.minimumSample), budgetCUw: '1' };
  const onDraft = (patch: Partial<PublicDraft>) => setDrafts(previous => ({ ...previous, [productId]: { ...draft, ...patch } }));
  const canaries = [...view.canaries].sort((a, b) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id));
  const current = canaries[0];
  return <div id="public-release">
    <div className="release-desk-toolbar"><label className="release-desk-field release-desk-product-select" htmlFor="release-product">Public product<select id="release-product" value={productId} onChange={event => setProductId(event.target.value)} disabled={!products.length}><option value="">{products.length ? 'Choose a public product' : 'Deploy a product to begin'}</option>{productId && !selectedProduct && <option value={productId}>Saved product is no longer available</option>}{products.map(product => <option value={product.id} key={product.id}>{product.name} · {productKind(product.kind)}</option>)}</select></label><div className="release-desk-toolbar-meta">{selectedProduct && <ReleaseStatus tone={selectedProduct.status === 'active' ? 'good' : 'neutral'}>{selectedProduct.status === 'active' ? 'Product active' : selectedProduct.status === 'paused' ? 'Product paused' : 'Deploying'}</ReleaseStatus>}<span>Week {game.week}</span></div></div>
    {!selectedProduct ? <div className="release-desk-empty"><Rocket size={32} aria-hidden="true" /><h3>{products.length ? 'Choose a product to review' : 'Start with a deployed product'}</h3><p>{productId ? 'This product is no longer available. Choose another product to continue; its settings will not replace your other drafts.' : 'Compare the live model with a tested replacement. Manage the product’s pricing, features, and protection from its settings.'}</p><div className="release-desk-links"><ReleaseLink panel="product" onOpenPanel={onOpenPanel}>Set up a chat product</ReleaseLink><ReleaseLink panel="developer-api" onOpenPanel={onOpenPanel}>Set up developer API</ReleaseLink></div></div> : <>
      <div className="release-desk-layout"><div className="release-desk-stack">
        {current && <CanaryReport key={current.id} {...props} canary={current} rules={view.rules} />}
        <PreparedPath {...props} product={selectedProduct} draft={draft} onDraft={onDraft} />
        {(!current || !['scheduled', 'collecting'].includes(current.status)) && <CanaryStart {...props} view={view} draft={draft} onDraft={onDraft} />}
      </div><aside className="release-desk-stack release-desk-side" aria-label="Release incidents and capacity"><IncidentDesk {...props} canary={current} /><ReleaseCapacity game={game} onOpenPanel={onOpenPanel} /></aside></div>
      {canaries.length > 1 && <details className="release-desk-details release-desk-history"><summary>Past live tests ({canaries.length - 1})</summary><div className="release-desk-stack">{canaries.slice(1).map(canary => <details className="release-desk-details" key={canary.id}><summary>Week {canary.startedWeek} · {canary.candidateName} · {canaryLabel(canary.status)}</summary><CanaryReport {...props} canary={canary} rules={view.rules} historical /></details>)}</div></details>}
    </>}
  </div>;
}

const RetainedPublicReleaseWorkspace = memo(function RetainedPublicReleaseWorkspace(props: StudioReleaseDeskProps) {
  return props.active === false ? null : <PublicReleaseWorkspace {...props} />;
}, retainedReleasePropsEqual);

function ReleaseDeskContent(props: StudioReleaseDeskProps) {
  const [mode, setMode] = useState<'public' | 'appliance'>('public');
  return <section id="release-desk" className="release-desk" aria-label="Release desk">
    <div className="release-desk-intro"><div><h2>Get your next model ready to launch.</h2><p>Test a prepared model with real customers, or build a model-and-hardware package for a private buyer. Review the costs and requirements before committing.</p></div><div className="release-desk-modes" role="group" aria-label="Release workspace"><button type="button" aria-pressed={mode === 'public'} aria-controls="release-public-panel" onClick={() => setMode('public')}><FlaskConical size={15} aria-hidden="true" /> Public rollout</button><button type="button" aria-pressed={mode === 'appliance'} aria-controls="release-appliance-panel" onClick={() => setMode('appliance')}><ClipboardCheck size={15} aria-hidden="true" /> Private appliance</button></div></div>
    <div id="release-public-panel" hidden={mode !== 'public'}><RetainedPublicReleaseWorkspace {...props} active={mode === 'public'} /></div>
    <div id="release-appliance-panel" hidden={mode !== 'appliance'}><StudioPrivateAppliance {...props} active={mode === 'appliance'} /></div>
  </section>;
}

/** Keep visited drafts mounted, while an unseen or hidden desk performs no new selectors or quotes. */
export const StudioReleaseDesk = memo(function StudioReleaseDesk(props: StudioReleaseDeskProps) {
  return props.active === false ? <section id="release-desk" className="release-desk" aria-label="Release desk" /> : <ReleaseDeskContent {...props} />;
}, retainedReleasePropsEqual);
