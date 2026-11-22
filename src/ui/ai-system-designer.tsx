'use client';

import { useId } from 'react';
import { Brain, Cpu, Layers, LockKeyhole, Network } from 'lucide-react';
import type { GameState } from '../contracts/types';
import type { AISystemSpec, AISystemMetrics } from '../contracts/ai-systems';
import { AI_SYSTEM_DEFAULTS, AI_SYSTEM_OPTIONS } from '../content/ai-systems';
import { CONTENT } from '../content/catalog';
import { getAISystemResearchIds } from '../modules/ai-systems';
import { hasResearch } from '../modules/research';
import { formatUnits } from '../core/math';
import { useStudioTaskActions } from './studio-interaction-context';

const SYSTEM_ICONS = { experts: Network, stateful: Layers, adaptive: Brain };
const SKILLS = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use', reasoning: 'Reasoning', longContext: 'Long context', multimodal: 'Multimodal' };
const researchName = (id: string) => CONTENT.research.find(item => item.id === id)?.name ?? id;
export const aiSystemName = (spec?: AISystemSpec) => spec ? AI_SYSTEM_OPTIONS.find(item => item.kind === spec.kind)?.name ?? 'AI system' : 'Standard model';
export function aiSystemChoiceSummary(spec: AISystemSpec): string {
  if (spec.kind === 'experts') return `${spec.experts} experts · ${spec.activeExperts} active per request · ${{ uniform: 'Uniform routing', learned: 'Learned routing', balanced: 'Load-balanced routing' }[spec.routing]} · ${SKILLS[spec.specialization]} specialty`;
  if (spec.kind === 'stateful') return `${spec.stateSlots} state slots · ${{ fixed: 'Fixed state', compressed: 'Compressed state', selective: 'Selective recall' }[spec.memory]} · ${spec.repair ? 'Contradiction repair' : 'No contradiction repair'}`;
  return `Up to ${spec.maxPasses} passes · ${spec.search === 'branching' ? 'Branching candidates' : 'One reasoning path'} · ${spec.verifier === 'independent' ? 'Independent verifier' : 'Self-check'} · ${spec.stopping === 'confidence' ? 'Stop when confident' : 'Use the fixed budget'}`;
}

/** Choices only change the training draft. Locked discoveries remain visible and
 * previewable; the authoritative training quote still gates paid work. */
export function AISystemDesigner({ game, value, inherited, onChange, onNewFoundation }: {
  game: GameState; value?: AISystemSpec; inherited: boolean;
  onChange: (value: AISystemSpec | undefined) => void; onNewFoundation: () => void;
}) {
  const id = useId(), actions = useStudioTaskActions();
  const missing = value ? getAISystemResearchIds(value).filter(research => !hasResearch(game, game.playerCompanyId, research)) : [];
  const optionLabel = (name: string, research?: string) => name + (research && !hasResearch(game, game.playerCompanyId, research) ? ' · research needed' : '');
  return <section className="model-design-section ai-system-designer" aria-labelledby={id + '-title'}>
    <header><Network size={18} aria-hidden="true" /><h4 id={id + '-title'}>Operating design{inherited && <small> · inherited</small>}</h4></header>
    <p className="model-design-help">Choose how this AI uses experts, remembers a case, or checks its work. Size and training data still determine what it can learn.</p>
    <div className="ai-system-options" role="group" aria-label="AI operating design">
      <button type="button" aria-pressed={!value} disabled={inherited} onClick={() => onChange(undefined)}><Cpu size={18} aria-hidden="true" /><strong>Standard model</strong><span>One direct pass. Simple operation and no extra system controls.</span></button>
      {AI_SYSTEM_OPTIONS.map(option => {
        const Icon = SYSTEM_ICONS[option.kind], locked = !hasResearch(game, game.playerCompanyId, option.researchId);
        return <button type="button" key={option.kind} aria-pressed={value?.kind === option.kind} disabled={inherited} data-locked={locked}
          onClick={() => onChange(structuredClone(AI_SYSTEM_DEFAULTS[option.kind]))}>
          <Icon size={18} aria-hidden="true" /><strong>{option.name}{locked && <LockKeyhole size={13} aria-label="Research needed" />}</strong><span>{option.description}</span>
          {locked && <small>Unlock: {researchName(option.researchId)}</small>}
        </button>;
      })}
    </div>
    {inherited && <p className="ai-system-inherited">This version keeps its operating design when you improve it. <button type="button" className="training-text-action" onClick={onNewFoundation}>Design a new foundation</button> to choose another system.</p>}
    {value?.kind === 'experts' && <fieldset className="ai-system-controls" disabled={inherited}><legend>Expert network controls</legend>
      <label htmlFor={id + '-experts'}>Expert count<select id={id + '-experts'} value={value.experts} onChange={event => onChange({ ...value, experts: Number(event.target.value) as 4 | 8 | 16 })}>
        <option value={4}>4 experts</option><option value={8}>{optionLabel('8 experts', 'A4')}</option><option value={16}>{optionLabel('16 experts', 'A4')}</option>
      </select><small>More specialists increase the full memory footprint.</small></label>
      <label htmlFor={id + '-active'}>Experts used per request<select id={id + '-active'} value={value.activeExperts} onChange={event => onChange({ ...value, activeExperts: Number(event.target.value) as 1 | 2 | 4 })}>
        <option value={1}>1 expert</option><option value={2}>2 experts</option><option value={4}>{optionLabel('4 experts', 'A4')}</option>
      </select><small>Activating more experts uses more compute for each answer.</small></label>
      <label htmlFor={id + '-routing'}>Expert routing<select id={id + '-routing'} value={value.routing} onChange={event => onChange({ ...value, routing: event.target.value as typeof value.routing })}>
        <option value="uniform">Uniform</option><option value="learned">{optionLabel('Learned routing', 'A2')}</option><option value="balanced">{optionLabel('Load-balanced routing', 'A3')}</option>
      </select><small>Route requests to the right experts and reduce uneven loads.</small></label>
      <label htmlFor={id + '-specialization'}>Expert specialization<select id={id + '-specialization'} value={value.specialization} onChange={event => onChange({ ...value, specialization: event.target.value as typeof value.specialization })}>
        {Object.entries(SKILLS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select><small>Choose the skill your specialists concentrate on.</small></label>
    </fieldset>}
    {value?.kind === 'stateful' && <fieldset className="ai-system-controls" disabled={inherited}><legend>Persistent-state controls</legend>
      <label htmlFor={id + '-slots'}>Memory slots<select id={id + '-slots'} value={value.stateSlots} onChange={event => onChange({ ...value, stateSlots: Number(event.target.value) as 16 | 64 | 256 })}>
        <option value={16}>16 slots</option><option value={64}>{optionLabel('64 slots', 'A6')}</option><option value={256}>{optionLabel('256 slots', 'A7')}</option>
      </select><small>More slots retain more case history but need more session memory.</small></label>
      <label htmlFor={id + '-memory'}>Memory management<select id={id + '-memory'} value={value.memory} onChange={event => onChange({ ...value, memory: event.target.value as typeof value.memory })}>
        <option value="fixed">Fixed state</option><option value="compressed">{optionLabel('Compressed state', 'A6')}</option><option value="selective">{optionLabel('Selective recall', 'A7')}</option>
      </select><small>Compression and selection make a bounded state more useful.</small></label>
      <label htmlFor={id + '-repair'}>Conflicting memories<select id={id + '-repair'} value={value.repair ? 'repair' : 'keep'} onChange={event => onChange({ ...value, repair: event.target.value === 'repair' })}>
        <option value="keep">Keep the current state</option><option value="repair">{optionLabel('Repair contradictions', 'A8')}</option>
      </select><small>Repair uses additional work to reconcile conflicting updates.</small></label>
    </fieldset>}
    {value?.kind === 'adaptive' && <fieldset className="ai-system-controls" disabled={inherited}><legend>Adaptive reasoning controls</legend>
      <label htmlFor={id + '-passes'}>Maximum reasoning passes<select id={id + '-passes'} value={value.maxPasses} onChange={event => onChange({ ...value, maxPasses: Number(event.target.value) as 2 | 4 | 8 })}>
        <option value={2}>2 passes</option><option value={4}>{optionLabel('4 passes', 'A10')}</option><option value={8}>{optionLabel('8 passes', 'A10')}</option>
      </select><small>A larger budget gives hard requests more attempts and raises latency.</small></label>
      <label htmlFor={id + '-search'}>Candidate search<select id={id + '-search'} value={value.search} onChange={event => onChange({ ...value, search: event.target.value as typeof value.search })}>
        <option value="single">One reasoning path</option><option value="branching">{optionLabel('Branching candidates', 'A10')}</option>
      </select><small>Compare alternatives at an additional serving cost.</small></label>
      <label htmlFor={id + '-verifier'}>Answer checking<select id={id + '-verifier'} value={value.verifier} onChange={event => onChange({ ...value, verifier: event.target.value as typeof value.verifier })}>
        <option value="self">Self-check</option><option value="independent">{optionLabel('Independent verifier', 'A11')}</option>
      </select><small>An independent checker improves verified completion and needs memory.</small></label>
      <label htmlFor={id + '-stopping'}>Stopping rule<select id={id + '-stopping'} value={value.stopping} onChange={event => onChange({ ...value, stopping: event.target.value as typeof value.stopping })}>
        <option value="fixed">Use the fixed budget</option><option value="confidence">{optionLabel('Stop when confident', 'A12')}</option>
      </select><small>Confidence stopping saves expected work on easier requests.</small></label>
    </fieldset>}
    {missing.length > 0 && <div className="ai-system-research-needed"><strong>Research needed for these choices</strong><ul>{missing.map(research => <li key={research}>
      {actions?.openResearch ? <button type="button" className="training-text-action" onClick={() => actions.openResearch?.(research)}>{researchName(research)}</button> : <a href="#research">{researchName(research)}</a>}
    </li>)}</ul></div>}
  </section>;
}

export function AISystemMetricsView({ metrics, label = 'Operating forecast' }: { metrics: AISystemMetrics; label?: string }) {
  return <section className="ai-system-metrics" aria-label={label}><h4>{label}</h4><dl>
    <div><dt>Serving work / 1,000 requests</dt><dd>{metrics.servingCUwPer1000.toLocaleString('en-US', { maximumFractionDigits: 4 })} CUw</dd></div>
    <div><dt>Model memory</dt><dd>{formatUnits(metrics.residentMU)} MU</dd></div>
    <div><dt>Memory per account</dt><dd>{formatUnits(metrics.sessionMemoryMU)} MU</dd></div>
    <div><dt>Case retention</dt><dd>{(metrics.retentionBps / 100).toFixed(1)}%</dd></div>
    <div><dt>Verified completion</dt><dd>{(metrics.verifiedCompletionBps / 100).toFixed(1)}%</dd></div>
    <div><dt>Relative latency</dt><dd>{(metrics.latencyBps / 10000).toFixed(2)}×</dd></div>
    {metrics.kind === 'experts' && <><div><dt>Active parameters per request</dt><dd>{(metrics.activeParameterMillions / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })}B</dd></div><div><dt>Expert routing quality</dt><dd>{(metrics.routingQualityBps / 100).toFixed(1)}%</dd></div></>}
    {metrics.kind === 'stateful' && <div><dt>Retained state capacity</dt><dd>{metrics.stateCapacity} facts</dd></div>}
  </dl><p className="model-design-help">Fixed game workloads compare operating tradeoffs. Run a paid systems challenge on the finished model to earn evidence.</p></section>;
}
