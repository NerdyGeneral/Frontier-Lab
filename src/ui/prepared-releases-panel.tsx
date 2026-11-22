'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import type { PreparedRelease, ReleasePreparationWork } from '../contracts/wave9-releases';
import { PREPARED_RELEASE_RULES as RULES } from '../content/wave9-releases';
import { formatUnits } from '../core/math';
import { getPreparedReleaseView, releaseRollbackReason } from '../modules/prepared-releases';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

function PaidWork({ work, label }: { work: ReleasePreparationWork; label: string }) {
  return <>
    <progress value={Math.min(work.completedWork / work.requiredWork, work.completedStaff / work.requiredStaff) * 10000} max={10000} aria-label={label + ' progress'} />
    <Metrics>
      <Metric label="Development work">{formatUnits(work.completedWork)} / {formatUnits(work.requiredWork)} CUw</Metric>
      <Metric label="Design preparation">{formatWorkPoints(work.completedStaff)} / {formatWorkPoints(work.requiredStaff)} points</Metric>
      <Metric label="GPU work used">{formatUnits(work.physicalWork)} CUw</Metric>
      <Metric label="Memory needed while working">{formatUnits(work.requiredMemory)} MU</Metric>
    </Metrics>
    {work.lastBottleneck && <p className="bottleneck">{work.lastBottleneck}</p>}
  </>;
}

function ReleaseHistory({ release, props }: { release: PreparedRelease; props: PanelProps }) {
  const name = (id: string) => props.game.slices.models.versions[id]?.name ?? id;
  return <div className="receipt-row">
    <p className="small-heading">{name(release.sourceModelId)} → {name(release.candidateModelId)} · {release.status}</p>
    <p className="small-note">Started Week {release.startedWeek}; {formatUnits(release.completedWork)} development CUw and {formatWorkPoints(release.completedStaff)} Design points spent.
      {release.releasedWeek !== null && <> Handover Week {release.releasedWeek}; rollback is available until Week {release.rollbackExpiresWeek}.</>}
    </p>
    {release.rollback && <p className="small-note">Rollback {release.rollback.status}: {formatUnits(release.rollback.completedWork)} / {formatUnits(release.rollback.requiredWork)} CUw and {formatWorkPoints(release.rollback.completedStaff)} / {formatWorkPoints(release.rollback.requiredStaff)} Design points.
      {release.rollback.restoredWeek !== null && <> Restored Week {release.rollback.restoredWeek}.</>}
    </p>}
  </div>;
}

/** Embedded next to the rehearsal of one public product, preserving the plain interface. */
export function PreparedReleasesPanel(props: PanelProps & { productId: string }) {
  const { game, productId, canAct } = props, view = getPreparedReleaseView(game, productId);
  const [selected, setSelected] = useState('');
  const candidate = view.candidates.find(model => model.id === selected) ?? view.candidates[0];
  const release = view.current, work = view.work, rollback = !!release && work !== release;
  const latestReleased = view.releases.find(item => item.status === 'released');
  return <div className="release-preparation">
    <p className="small-heading">Prepared handover</p>
    <p className="small-note">Keep the current model serving customers while ML staff and development GPUs prepare its replacement. Once preparation is complete, you choose when to switch.</p>
    {!view.researched ? <p className="planned-note">Research Enterprise operations (R12) to prepare a replacement model and keep a limited-time option to switch back.</p>
      : release && work ? <div className="project-row">
        <div className="project-heading"><strong>{rollback ? 'Prepare the previous model' : 'Prepare the new model'}</strong><span>{work.paused ? 'Paused' : work.status === 'scheduled' ? 'Handover scheduled' : work.status === 'ready' ? 'Ready to switch' : 'Preparing'}</span></div>
        <p className="small-note">{game.slices.models.versions[rollback ? release.candidateModelId : release.sourceModelId].name} → {game.slices.models.versions[rollback ? release.sourceModelId : release.candidateModelId].name}. The current offer, customer accounts, and billing contract stay in place.</p>
        <PaidWork work={work} label={rollback ? 'Rollback preparation' : 'Release preparation'} />
        {work.status === 'preparing' && <ActionControl {...props} payload={{ kind: 'set_prepared_release_paused', releaseId: release.id, paused: !work.paused }} label={work.paused ? 'Resume preparation' : 'Pause preparation'} compact />}
        {work.status === 'ready' && <>
          <p className="small-note">Available from Week {work.availableWeek}. {work.availableWeek !== null && work.availableWeek > game.week ? 'Wait until that week to choose the handover.' : <>Choosing handover now schedules the model switch for Week {game.week + 2}.</>}</p>
          <ActionControl {...props} payload={{ kind: 'promote_prepared_release', releaseId: release.id }} label={rollback ? 'Schedule return to previous model' : 'Schedule model switch'} />
        </>}
        {work.status === 'scheduled' && <p className="small-heading">Handover at Week {work.cutoverWeek}. The product will stay live or paused, as it is now.</p>}
        {['preparing', 'ready'].includes(work.status) && <ActionControl {...props} payload={{ kind: 'discard_prepared_release', releaseId: release.id }} label="Discard this preparation" compact />}
        {rollback && <p className="small-note">The option to restore the previous model ends in Week {release.rollbackExpiresWeek}. Pausing and preparation never extend this deadline.</p>}
      </div> : <>
        {candidate ? <>
          <label className="line-control wide-select" htmlFor={'prepared-candidate-' + productId}>Model tested in a rehearsal<select id={'prepared-candidate-' + productId} value={candidate.id} onChange={event => setSelected(event.target.value)} disabled={!canAct}>{view.candidates.map(model => <option key={model.id} value={model.id}>{model.name} · {model.family}</option>)}</select></label>
          <p className="small-note">Preparation needs 2 development CUw and 40 Design points, using up to 1 CUw and 20 Design points per week. It also needs its own memory, shared with the lab’s other work.</p>
          <ActionControl {...props} payload={{ kind: 'start_prepared_release', productId, candidateModelId: candidate.id }} label="Prepare rehearsed release" />
        </> : <p className="small-note">Compare the current and replacement models above before preparing a release. Changing either model or the product settings requires a new comparison.</p>}
        {view.retained ? <div className="receipt-row">
          <p className="small-heading">Previous model: {game.slices.models.versions[view.retained.sourceModelId].name}</p>
          <p className="small-note">You can switch back once, through Week {view.retained.rollbackExpiresWeek}. This needs 1 development CUw and 20 Design points. Once ready, wait for the next week, then schedule the switch.</p>
          <ActionControl {...props} payload={{ kind: 'start_release_rollback', releaseId: view.retained.id }} label="Prepare to switch back" />
        </div> : latestReleased && <p className="small-note">Rollback: {latestReleased.rollback ? latestReleased.rollback.status === 'complete' ? 'the previous model was restored; the one-use option has been used.' : 'the one-use rollback preparation has already been used.' : releaseRollbackReason(game, latestReleased)?.message}</p>}
      </>}
    <p className="small-note">Ready means preparation is complete. Make sure a compatible GPU pool has enough serving compute and memory when you switch. Routing and evidence-checking setups belong to each model, and prefix caches start empty.</p>
    <p className="small-note">Preparation and rehearsals cost work points and compute. They test and prepare the release; you still need to switch models to put it live.</p>
    {view.releases.length > 0 && <details className="inline-details"><summary>Saved release history · {view.releases.length} / {RULES.maximumRecordsPerProduct}</summary>{view.releases.map(item => <ReleaseHistory key={item.id} release={item} props={props} />)}</details>}
  </div>;
}
