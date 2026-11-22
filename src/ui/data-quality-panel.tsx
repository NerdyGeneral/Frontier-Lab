'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import type { CommandPayload, DataPacket, GameState } from '../contracts/types';
import { formatUnits } from '../core/math';
import { getDataQualityView } from '../modules/data-quality';
import { ActionControl, Metric, Metrics } from './components';

export function DataQualityPanel({ game, packet, canAct, onQueue }: {
  game: GameState; packet: DataPacket; canAct: boolean; onQueue: (payload: CommandPayload) => void;
}) {
  const view = getDataQualityView(game, packet);
  if (!view.researched && !view.rollout && !view.receipt) return <details className="inline-details"><summary>Deduplication · research required</summary><p className="small-note">Research Deduplication (R2A), then install its system to reduce repeated processing in future training.</p><a href="#research">Open research pathways</a></details>;
  return <details className="inline-details"><summary>Deduplication and processing cost</summary>
    <p className="small-note">Remove repeated processing to make future training cheaper. You keep the same data, quality, skill targets, and licenses. Training already in progress keeps its original costs.</p>
    <Metrics>
      <Metric label="Unique source data">{view.sourceUnits} units</Metric>
      <Metric label="Repeated processing">{view.duplicateProcessingUnits} units</Metric>
      <Metric label="Processing passes before cleanup">{view.processedUnits} units</Metric>
      <Metric label="Future training-work saving">{view.reductionBps / 100}% for this source</Metric>
      <Metric label="Cleanup effort">{formatWorkPoints(view.requiredStaff)} Data points</Metric>
    </Metrics>
    <p className="small-note">{view.explanation} The saving is capped at 10%. It depends on how much cleaned data you use in training. Teacher models, checkpoints, testing, and memory still have their own costs.</p>
    {!view.rollout && <ActionControl game={game} payload={{ kind: 'start_system_rollout', method: 'deduplication' }} label="Install deduplication system" canAct={canAct} onQueue={onQueue} />}
    {view.rollout && view.rollout.status !== 'active' && <>
      <p className="small-heading">System installation · {view.rollout.status === 'ready' ? `available Week ${view.rollout.readyWeek}` : 'in progress'}</p>
      <Metrics><Metric label="Design work">{formatWorkPoints(view.rollout.completedStaff)} / {formatWorkPoints(view.rollout.requiredStaff)} points</Metric><Metric label="Development work">{formatUnits(view.rollout.completedWork)} / {formatUnits(view.rollout.requiredWork)} CUw</Metric></Metrics>
      {view.rollout.lastBottleneck && <p className="bottleneck">{view.rollout.lastBottleneck}</p>}
    </>}
    {view.cleaned ? <p className="small-note">Cleanup finished. Choose this version in a new training plan to get the saving. Combining it with another copy of the same source still counts that source only once.</p>
      : view.pending ? <>
        <p className="small-note">This data revision is {view.job?.status === 'paused' ? 'paused' : 'in progress'}. You can use it once the data team finishes.</p>
        {view.job && <><progress value={view.job.completedStaff} max={view.job.requiredStaff} aria-label="Data revision preparation progress" /><ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: view.job.id, paused: view.job.status !== 'paused' }} label={view.job.status === 'paused' ? 'Resume data preparation' : 'Pause data preparation'} canAct={canAct} onQueue={onQueue} compact /></>}
      </> : <ActionControl game={game} payload={{ kind: 'deduplicate_data', packetId: packet.id }} label="Clean repeated processing" canAct={canAct} onQueue={onQueue} />}
    {view.receipt && <p className="small-note">Original source: {game.slices.data.packets[view.receipt.sourcePacketId]?.name ?? view.receipt.sourcePacketId}. Curation keeps this cleanup, but still needs its own staff work.</p>}
  </details>;
}
