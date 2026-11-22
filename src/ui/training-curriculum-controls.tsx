'use client';

import type { CapabilityDomain, DataPacket } from '../contracts/types';
import type { CurriculumTrackChoice, TrainingCurriculumChoice, TrainingCurriculumReceipt } from '../contracts/wave17-curriculum';
import { formatUnits } from '../core/math';
import { packetSources } from '../modules/lab-planner';
import { Metric, Metrics } from './components';

const LABELS: Record<CapabilityDomain, string> = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use' };

export function TrainingCurriculumControls({ value, domains, packets, canAct, onChange }: {
  value: TrainingCurriculumChoice;
  domains: CapabilityDomain[];
  packets: DataPacket[];
  canAct: boolean;
  onChange: (choice: TrainingCurriculumChoice) => void;
}) {
  const updateTrack = (index: number, track: CurriculumTrackChoice) => {
    const tracks = value.tracks.map((current, position) => position === index ? track : current) as TrainingCurriculumChoice['tracks'];
    onChange({ ...value, tracks });
  };
  return <div className="training-preview">
    <p className="small-heading">Preserve two existing skills</p>
    <p className="small-note">Start with a base model that has a paid Expanded capabilities report, plus two prepared replay datasets. The main training data and both replay datasets must come from different sources. Different versions of one source still count as the same source.</p>
    <label className="line-control" htmlFor="curriculum-share">Total replay budget<select id="curriculum-share" value={value.shareBps} disabled={!canAct} onChange={event => onChange({ ...value, shareBps: Number(event.target.value) as 5000 | 7500 })}><option value={5000}>50% · twice the ordinary updates</option><option value={7500}>75% · four times the ordinary updates</option></select></label>
    <p className="small-note">Replay work is split equally between the two skills. Each dataset gets its own cleanup saving. Your new skill still gets the full normal training budget.</p>
    {value.tracks.map((track, index) => {
      const other = value.tracks[index === 0 ? 1 : 0];
      const otherSources = new Set(other.packetIds.flatMap(id => {
        const packet = packets.find(item => item.id === id);
        return packet ? packetSources(packet) : [];
      }));
      const availablePackets = packets.filter(packet => !packetSources(packet).some(source => otherSources.has(source)));
      return <fieldset className="plain-fieldset" key={index}>
        <legend>Replay track {index + 1}</legend>
        <label className="line-control" htmlFor={`curriculum-domain-${index}`}>Skill {index + 1} to preserve<select id={`curriculum-domain-${index}`} value={track.domain} disabled={!canAct} onChange={event => updateTrack(index, { ...track, domain: event.target.value as CapabilityDomain })}>{domains.filter(domain => domain !== other.domain).map(domain => <option key={domain} value={domain}>{LABELS[domain]}</option>)}</select></label>
        {availablePackets.length > 0 ? <details className="inline-details"><summary>{LABELS[track.domain]} replay data · {track.packetIds.length} selected</summary><fieldset className="plain-fieldset"><legend>Separate prepared data for {LABELS[track.domain].toLowerCase()}</legend>{availablePackets.map(packet => <label className="checkbox-control" key={packet.id}><input type="checkbox" checked={track.packetIds.includes(packet.id)} disabled={!canAct} onChange={event => updateTrack(index, { ...track, packetIds: event.target.checked ? [...track.packetIds, packet.id] : track.packetIds.filter(id => id !== packet.id) })} /><span>{packet.name} · {packet.qualityBps / 100}% quality · {packet.coverageBps[track.domain] / 100}% coverage</span></label>)}</fieldset></details> : <p className="small-note">Prepare another source for this skill. You cannot use the main training sources or the other replay skill’s sources.</p>}
      </fieldset>;
    })}
    <p className="small-note">The minimum skill you keep depends on the base model’s tested score, your replay budget, and the quality and coverage of the replay data. You earn it through training, and it cannot exceed the original skill. Test the new model afterward; capability and policy tests are separate projects.</p>
  </div>;
}

export function TrainingCurriculumDetails({ curriculum, title = 'Two-skill curriculum' }: {
  curriculum: TrainingCurriculumReceipt;
  title?: string;
}) {
  return <details className="inline-details"><summary>{title} · {curriculum.tracks.map(track => LABELS[track.domain]).join(' + ')}</summary>
    <Metrics>
      <Metric label="Total replay share before cleanup">{curriculum.shareBps / 100}%</Metric>
      <Metric label="Primary update work">{formatUnits(curriculum.focusWorkCUw)} CUw</Metric>
      <Metric label="Combined replay update work">{formatUnits(curriculum.replayWorkCUw)} CUw</Metric>
      <Metric label="All training updates">{formatUnits(curriculum.focusWorkCUw + curriculum.replayWorkCUw)} CUw</Metric>
    </Metrics>
    {curriculum.tracks.map(track => <div key={track.domain}>
      <p className="small-heading">{LABELS[track.domain]}</p>
      <Metrics>
        <Metric label="Base model’s tested skill">{track.baselineScoreBps / 100}</Metric>
        <Metric label="Minimum skill after full training">{track.preservationFloorBps / 100}</Metric>
        <Metric label="Share of updates before cleanup">{track.shareBps / 100}%</Metric>
        <Metric label="Track update work">{formatUnits(track.replayWorkCUw)} CUw</Metric>
        <Metric label="Relevant data coverage">{track.coverageBps / 100}%</Metric>
        <Metric label="Data quality">{track.qualityBps / 100}%</Metric>
        <Metric label="Hosted use">{track.corpus.rights.hosted ? 'Allowed' : 'Unavailable'}</Metric>
        <Metric label="Weight distribution">{track.corpus.rights.weights ? 'Allowed' : 'Unavailable'}</Metric>
        {track.deduplication && <Metric label="Work saved by cleanup">{formatUnits(track.deduplication.savedWorkCUw)} CUw</Metric>}
      </Metrics>
    </div>)}
    <p className="small-note">These targets are set when training starts. Progress gradually earns each minimum score; if normal adaptation gives a better result, you keep that instead. The base model and all three datasets must allow the intended use. Repeating the same plan cannot stack gains or change the result at random.</p>
  </details>;
}
