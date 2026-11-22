'use client';

import type { CapabilityDomain, DataPacket } from '../contracts/types';
import type { ReplayTrainingChoice, TrainingReplayReceipt } from '../contracts/wave15-replay';
import { formatUnits } from '../core/math';
import { Metric, Metrics } from './components';

const LABELS: Record<CapabilityDomain, string> = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use' };

export function ReplayTrainingControls({ enabled, available, value, domains, packets, canAct, onEnabled, onChange, showToggle = true }: {
  enabled: boolean; available: boolean; value: ReplayTrainingChoice; domains: CapabilityDomain[];
  packets: DataPacket[]; canAct: boolean; onEnabled: (enabled: boolean) => void;
  onChange: (choice: ReplayTrainingChoice) => void;
  showToggle?: boolean;
}) {
  return <div className="training-preview">
    {showToggle ? <label className="checkbox-control"><input type="checkbox" checked={enabled && available} disabled={!canAct || !available} onChange={event => onEnabled(event.target.checked)} /><span>Preserve an existing skill</span></label> : <p className="small-heading">Preserve one existing skill</p>}
    <p className="small-note">Replay helps a model keep an existing skill while learning another. It needs separate training data and extra compute. Choose a standard adaptation and a base model with a paid capability test.</p>
    {!available && <p className="small-note">Replay is available for conversation, document, and coding/tool adaptations. Turn off adapter training to use it.</p>}
    {enabled && available && <>
      <label className="line-control" htmlFor="replay-domain">Skill to preserve<select id="replay-domain" value={value.domain} disabled={!canAct} onChange={event => onChange({ ...value, domain: event.target.value as CapabilityDomain })}>{domains.map(domain => <option key={domain} value={domain}>{LABELS[domain]}</option>)}</select></label>
      <label className="line-control" htmlFor="replay-share">Replay budget<select id="replay-share" value={value.shareBps} disabled={!canAct} onChange={event => onChange({ ...value, shareBps: Number(event.target.value) as 2500 | 5000 })}><option value={2500}>25% · lighter retention</option><option value={5000}>50% · stronger retention</option></select></label>
      <p className="small-note">This is the share of training spent on replay, before cleanup savings. A 25% budget adds one-third to normal training work; 50% doubles it. Each dataset gets its own cleanup saving.</p>
      {packets.length > 0 ? <details className="inline-details"><summary>Replay data · {value.packetIds.length} selected</summary><fieldset className="plain-fieldset"><legend>Separate prepared replay data</legend>{packets.map(packet => <label className="checkbox-control" key={packet.id}><input type="checkbox" checked={value.packetIds.includes(packet.id)} disabled={!canAct} onChange={event => onChange({ ...value, packetIds: event.target.checked ? [...value.packetIds, packet.id] : value.packetIds.filter(id => id !== packet.id) })} /><span>{packet.name} · {packet.qualityBps / 100}% quality · {packet.coverageBps[value.domain] / 100}% coverage</span></label>)}</fieldset></details> : <p className="small-note">Prepare a different source for replay. You cannot reuse the main training data or another version of the same source.</p>}
      <p className="small-note">Better, more relevant data preserves more of the original skill, up to the base model’s score. Test each new model afterward. Repeating the same plan cannot stack gains or change the result at random.</p>
    </>}
  </div>;
}

export function ReplayReceiptDetails({ replay, title = 'Replay curriculum' }: { replay: TrainingReplayReceipt; title?: string }) {
  return <details className="inline-details"><summary>{title} · {LABELS[replay.domain]}</summary>
    <Metrics>
      <Metric label="Base model’s tested skill">{replay.baselineScoreBps / 100}</Metric>
      <Metric label="Minimum skill after full training">{replay.preservationFloorBps / 100}</Metric>
      <Metric label="Replay budget before cleanup">{replay.shareBps / 100}%</Metric>
      <Metric label="Ordinary update work">{formatUnits(replay.focusWorkCUw)} CUw</Metric>
      <Metric label="Additional replay work">{formatUnits(replay.replayWorkCUw)} CUw</Metric>
      <Metric label="Replay data coverage">{replay.coverageBps / 100}%</Metric>
      <Metric label="Replay data quality">{replay.qualityBps / 100}%</Metric>
      <Metric label="Replay hosted rights">{replay.corpus.rights.hosted ? 'Allowed' : 'Unavailable'}</Metric>
      <Metric label="Replay weight rights">{replay.corpus.rights.weights ? 'Allowed' : 'Unavailable'}</Metric>
      {replay.deduplication && <Metric label="Replay work saved by cleanup">{formatUnits(replay.deduplication.savedWorkCUw)} CUw</Metric>}
    </Metrics>
    <p className="small-note">Training progress gradually earns this minimum score. If normal adaptation gives a better result, you keep that instead. The base model and both datasets must allow the intended use. Capability and policy tests cost extra.</p>
  </details>;
}
