'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { memo, useMemo, useState } from 'react';
import { ArrowUpRight, Cpu, Layers3, MemoryStick, TriangleAlert } from 'lucide-react';
import type { ChipFoundry, ChipSpecification, ChipSuccessorImprovement, FastFabricProject } from '../contracts/wave4-hardware';
import { CONTENT } from '../content/catalog';
import { CHIP_FOUNDRIES, chipProductionTerms } from '../content/silicon-market';
import { availableFoundrySlots } from '../modules/hardware-sales';
import { HardwareSalesPanel } from './hardware-sales-panel';
import { CHIP_RULES, chipPrototypeValues, chipSpecificationValues } from '../content/wave4-hardware';
import { GEN2_SILICON_RULES } from '../content/wave28-silicon';
import { getWorkforce } from '../modules/workforce';
import { formatMoney, formatUnits } from '../core/index';
import { chipPaybackForecast, getChipView } from '../modules/chips';
import { ActionControl, Metric, Metrics, parseFixed, Section } from './components';
import type { PanelProps } from './panels';

type ChipView = ReturnType<typeof getChipView>;
type ChipControlProps = Pick<PanelProps, 'game' | 'canAct' | 'onQueue'> & { idPrefix?: string };
type DesignView = ChipView['designs'][number];
const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const specificationName = (spec: ChipSpecification) => (spec.architecture === 'sparse' ? 'Sparse' : 'Dense') + ' · ' + (spec.target === 'inference' ? 'Inference' : 'Training') + ' · ' + (spec.memory === 'wide' ? 'Wide memory' : 'Balanced memory');

function DesignForm({ game, canAct, onQueue, chips }: ChipControlProps & { chips: ChipView }) {
  const [name, setName] = useState('FL-1');
  const [spec, setSpec] = useState<ChipSpecification>({ architecture: 'dense', target: 'inference', memory: 'balanced' });
  const values = chipSpecificationValues(spec);
  return <div>
    <label className="line-control wide-input" htmlFor="chip-name">Design name<input id="chip-name" value={name} maxLength={48} onChange={event => setName(event.target.value)} disabled={!canAct} /></label>
    <label className="line-control wide-select" htmlFor="chip-architecture">Model architecture<select id="chip-architecture" value={spec.architecture} onChange={event => setSpec(current => ({ ...current, architecture: event.target.value as ChipSpecification['architecture'] }))} disabled={!canAct}><option value="dense">Dense</option><option value="sparse" disabled={!chips.canInstallFabric}>Sparse{chips.canInstallFabric ? '' : ' · research required'}</option></select></label>
    <label className="line-control wide-select" htmlFor="chip-workload">Supported workload<select id="chip-workload" value={spec.target} onChange={event => setSpec(current => ({ ...current, target: event.target.value as ChipSpecification['target'] }))} disabled={!canAct}><option value="inference">Inference</option><option value="training">Training</option></select></label>
    <label className="line-control wide-select" htmlFor="chip-memory">Memory design<select id="chip-memory" value={spec.memory} onChange={event => setSpec(current => ({ ...current, memory: event.target.value as ChipSpecification['memory'] }))} disabled={!canAct}><option value="balanced">Balanced memory</option><option value="wide">Wide memory</option></select></label>
    <Metrics><Metric label="Memory per useful CU">{formatUnits(values.memoryMUPerCU)} MU</Metric><Metric label={spec.target === 'inference' ? 'Compatible inference efficiency' : 'Compatible training efficiency'}>{(spec.target === 'inference' ? values.servingBps : values.trainingBps) / 10000}×</Metric><Metric label="Power per useful CU">{values.powerPerCU}</Metric><Metric label="GPU use cost / CUw">{formatMoney(values.variableCentsPerCUw)}</Metric><Metric label="Design effort">{formatWorkPoints(values.designHardwareStaff)} Hardware points</Metric><Metric label="Design simulation">{formatUnits(values.designWorkCUw)} research CUw</Metric></Metrics>
    <ActionControl game={game} payload={{ kind: 'start_chip_design', name, spec }} label="Fund chip design" canAct={canAct} onQueue={onQueue} />
    <p className="small-note">Choose which models and jobs the chip supports. Wide memory handles larger jobs but runs them more slowly. Test a prototype to learn its yield, then pay for production and installation. Running the racks also needs staff.</p>
  </div>;
}

function PrototypeForm({ game, canAct, onQueue, design, idPrefix = '' }: ChipControlProps & { design: DesignView }) {
  const models = design.compatibleModels;
  const [modelId, setModelId] = useState(models[models.length - 1]?.id ?? '');
  const model = models.find(item => item.id === modelId);
  const prototype = chipPrototypeValues(design);
  return <div>
    <label className="line-control wide-select" htmlFor={idPrefix + design.id + '-prototype-model'}>Model for testing<select id={idPrefix + design.id + '-prototype-model'} value={modelId} onChange={event => setModelId(event.target.value)} disabled={!canAct || !models.length}><option value="">{models.length ? 'Choose an evaluated model' : 'Evaluate a compatible model first'}</option>{modelId && !model && <option value={modelId}>Saved model is no longer eligible</option>}{models.map(item => <option key={item.id} value={item.id}>{item.name} · {item.family}, {item.architecture}</option>)}</select></label>
    {design.successor && <Metrics><Metric label="Separate prototype fee">{formatMoney(prototype.feeCents)}</Metric><Metric label="Hardware testing work">{formatWorkPoints(prototype.hardwareStaff)} points</Metric><Metric label="Design testing work">{formatWorkPoints(prototype.mlStaff)} points</Metric><Metric label="Compute for testing">{formatUnits(prototype.workCUw)} CUw</Metric></Metrics>}
    <ActionControl game={game} payload={model ? { kind: 'start_chip_prototype', designId: design.id, modelId: model.id } : null} label={'Validate prototype · ' + design.name} canAct={canAct} onQueue={onQueue} emptyReason={'Evaluate an owned ' + design.spec.architecture + ' model before validating this prototype.'} />
    <p className="small-note">The prototype uses your chosen model and its test report. Once it passes, you can order production and install the finished racks.</p>
  </div>;
}

function ProductionPlan({ game, canAct, onQueue, design, chips, idPrefix = '' }: ChipControlProps & { design: DesignView; chips: ChipView }) {
  const [racks, setRacks] = useState<1 | 2 | 4>(1);
  const [location, setLocation] = useState('colocation');
  const [foundry, setFoundry] = useState<ChipFoundry>('standard');
  const terms = design.qualifiedYieldBps === null ? null : chipProductionTerms(design, racks, CONTENT.infrastructure.rackCU, foundry);
  const [utilization, setUtilization] = useState('75');
  const destination = chips.locations.find(item => item.id === location) ?? chips.locations[0];
  const utilizationBps = parseFixed(utilization, 2);
  const forecast = utilizationBps !== null && utilizationBps <= 10000 ? chipPaybackForecast(game, design, racks, destination.id, utilizationBps, CONTENT, foundry) : null;
  return <div>
    <label className="line-control" htmlFor={idPrefix + design.id + '-batch-size'}>Production batch<select id={idPrefix + design.id + '-batch-size'} value={racks} onChange={event => setRacks(Number(event.target.value) as 1 | 2 | 4)} disabled={!canAct}>{([1, 2, 4] as const).map(value => <option key={value} value={value}>{value} rack{value === 1 ? '' : 's'}</option>)}</select></label>
    <label className="line-control wide-select" htmlFor={idPrefix + design.id + '-batch-location'}>Destination<select id={idPrefix + design.id + '-batch-location'} value={destination.id} onChange={event => setLocation(event.target.value)} disabled={!canAct}>{chips.locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="line-control wide-select" htmlFor={idPrefix + design.id + '-foundry'}>Foundry<select id={idPrefix + design.id + '-foundry'} value={foundry} onChange={event => setFoundry(event.target.value as ChipFoundry)} disabled={!canAct}>{(Object.keys(CHIP_FOUNDRIES) as ChipFoundry[]).map(route => <option key={route} value={route}>{CHIP_FOUNDRIES[route].name}</option>)}</select></label>
    {terms && <details className="inline-details"><summary>Compare foundries</summary>
      <table className="compact-table"><caption>Production for {racks} rack{racks === 1 ? '' : 's'}</caption><thead><tr><th scope="col">Foundry</th><th scope="col">Price</th><th scope="col">Weeks</th><th scope="col">Useful CU</th></tr></thead>
      <tbody>{(Object.keys(CHIP_FOUNDRIES) as ChipFoundry[]).map(route => {
        const option = chipProductionTerms(design, racks, CONTENT.infrastructure.rackCU, route), slots = availableFoundrySlots(game, route);
        return <tr key={route}><th scope="row">{CHIP_FOUNDRIES[route].name}{slots !== null && <span className="table-subline">{slots} rack slots open</span>}</th><td>{formatMoney(option.costCents)}</td><td>{option.leadWeeks}</td><td>{formatUnits(option.usableCU)}</td></tr>;
      })}</tbody></table>
      <p className="small-note">Your own racks and customer orders share the same specialty foundry slots. Better yield gives you more usable compute from each rack.</p>
    </details>}
    <Metrics><Metric label="Batch production yield">{terms ? percent(terms.yieldBps) : 'Awaiting prototype'}</Metric><Metric label="Manufacturing lead time">{terms?.leadWeeks ?? design.values.deliveryWeeks} weeks</Metric><Metric label="Installation per rack">{formatWorkPoints(CONTENT.infrastructure.installationStaffWeeks)} Operations points</Metric></Metrics>
    <ActionControl game={game} payload={{ kind: 'order_chip_batch', designId: design.id, racks, location: destination.id, ...(foundry === 'standard' ? {} : { foundry }) }} label={'Order production · ' + design.name} canAct={canAct} onQueue={onQueue} />
    <p className="small-note">You pay for the full batch. Yield determines how much compute works, while each rack still takes the same amount of space. Install delivered inventory under <a href="#infrastructure">Infrastructure</a>.</p>
    <details className="inline-details"><summary>When could this hardware pay for itself?</summary>
      <label className="line-control" htmlFor={idPrefix + design.id + '-utilization'}>Average use<span className="unit-input"><input id={idPrefix + design.id + '-utilization'} type="number" min="0" max="100" step="5" value={utilization} onChange={event => setUtilization(event.target.value)} /><span>%</span></span></label>
      {forecast ? <><Metrics><Metric label="Useful capacity in this batch">{formatUnits(forecast.usefulCU)} CU</Metric><Metric label="Work at this level of use">{formatUnits(forecast.weeklyEffectiveWorkCUw)} CUw / week</Metric><Metric label="Design and production estimate">{formatMoney(forecast.entryAndProductionCents)}</Metric><Metric label="Equivalent reserved cloud">{formatMoney(forecast.equivalentCloudCentsPerWeek)} / week</Metric><Metric label="Owned variable work cost">{formatMoney(forecast.ownedVariableCentsPerWeek)} / week</Metric><Metric label="Fixed costs and operations staff">{formatMoney(forecast.ownedFixedAndStaffCentsPerWeek)} / week</Metric><Metric label="Estimated weekly savings">{formatMoney(forecast.weeklySavingsCents)}</Metric><Metric label="Simple payback">{forecast.simplePaybackWeeks !== null ? forecast.simplePaybackWeeks + ' weeks of operation' : 'No payback at this level of use'}</Metric></Metrics><ul className="forecast-assumptions">{forecast.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></> : <p className="small-note">Enter expected use from 0 to 100% to estimate savings.</p>}
    </details>
  </div>;
}

function DesignRow(props: ChipControlProps & { design: DesignView; chips: ChipView }) {
  const { game, design, canAct, onQueue } = props;
  const meter = design.currentMeters;
  const proof = meter.grantProof, latest = proof?.latest;
  const pending = meter.readyWeek !== null && meter.readyWeek > game.week;
  const status = design.paused ? 'Paused' : pending ? 'Available Week ' + meter.readyWeek : design.status === 'designing' ? 'Designing' : design.status === 'design-ready' ? 'Ready for prototype' : design.status === 'prototyping' ? 'Validating prototype' : 'Qualified';
  const active = design.status === 'designing' || design.status === 'prototyping';
  return <article className="project-row chip-design" aria-label={design.name + ' chip design'}>
    <div className="project-heading"><strong>{design.successor && <span className="chip-generation-label">Gen 2</span>}{design.name}</strong><span>{status}</span></div>
    <p className="small-note">{specificationName(design.spec)}{design.successor ? ' · ' + (design.successor.improvement === 'memory' ? 'Memory upgrade' : 'Speed upgrade') : ' · First generation'}</p>
    {active && <><progress value={design.progressBps} max={10000} aria-label={design.name + ' current stage'} /><Metrics><Metric label="Hardware effort">{formatWorkPoints(meter.completedHardwareStaff)} / {formatWorkPoints(meter.requiredHardwareStaff)} points</Metric>{meter.requiredMlStaff > 0 && <Metric label="Design testing effort">{formatWorkPoints(meter.completedMlStaff)} / {formatWorkPoints(meter.requiredMlStaff)} points</Metric>}<Metric label={design.status === 'designing' ? 'Compute for design' : 'Compute for testing'}>{formatUnits(meter.completedWorkCUw)} / {formatUnits(meter.requiredWorkCUw)} CUw</Metric></Metrics>{meter.lastBottleneck && <p className="bottleneck">{meter.lastBottleneck}</p>}<ActionControl game={game} payload={{ kind: 'set_chip_project_paused', designId: design.id, paused: !design.paused }} label={(design.paused ? 'Resume ' : 'Pause ') + design.name} canAct={canAct} onQueue={onQueue} compact /></>}
    {proof && <details className="inline-details"><summary>Work completed: {design.status === 'designing' || design.status === 'design-ready' ? 'design' : 'prototype'}{latest ? ' · Week ' + latest.week : ''}</summary><Metrics><Metric label="GPU work completed">{formatUnits(proof.physicalWorkCUw)} CUw</Metric><Metric label="Weeks with GPU work">{proof.grantWeeks}</Metric><Metric label="Weeks with Hardware / ML work">{proof.hardwareGrantWeeks} / {proof.mlGrantWeeks}</Metric>{latest && <><Metric label="Latest Hardware work">{formatWorkPoints(latest.hardwareStaff)} points</Metric><Metric label="Latest ML work">{formatWorkPoints(latest.mlStaff)} points</Metric><Metric label="Latest useful / GPU work">{formatUnits(latest.effectiveCUw)} / {formatUnits(latest.physicalCUw)} CUw</Metric><Metric label="Latest memory supplied">{formatUnits(latest.memoryMU)} MU</Metric><Metric label="Latest connected pool">{props.chips.pools.find(pool => pool.id === latest.poolId)?.name ?? latest.poolId ?? 'No hardware pool assigned'}</Metric><Metric label="Work left before that week">{formatUnits(latest.remainingWorkCUw)} CUw</Metric></>}</Metrics><p className="small-note">This is work completed on the new chip. The original design’s work does not count toward it.</p></details>}
    {design.status === 'design-ready' && <PrototypeForm {...props} />}
    {design.status === 'validated' && <Metrics><Metric label="Production yield">{percent(design.qualifiedYieldBps!)}</Metric><Metric label="Supported work">{design.spec.architecture} {design.spec.target}</Metric></Metrics>}
    <details className="inline-details"><summary>Specifications and test results</summary><Metrics><Metric label="Memory / useful CU">{formatUnits(design.values.memoryMUPerCU)} MU</Metric><Metric label="Compatible work efficiency">{(design.spec.target === 'inference' ? design.values.servingBps : design.values.trainingBps) / 10000}×</Metric><Metric label="GPU use cost / CUw">{formatMoney(design.values.variableCentsPerCUw)}</Metric><Metric label="Design fee paid">{formatMoney(design.designFeeCents)}</Metric>{design.prototypeRun && <><Metric label="Prototype model">{game.slices.models.versions[design.prototypeRun.modelId]?.name ?? 'Original test model'}</Metric><Metric label="Prototype model family">{design.prototypeRun.modelFamily}</Metric><Metric label="Prototype fee paid">{formatMoney(design.prototypeRun.feeCents)}</Metric></>}</Metrics><p className="small-note">Specifications and tested yield are fixed for this design. Renaming it or ordering another batch will not improve its yield.</p></details>
    <details className="inline-details"><summary>Production and payback</summary><ProductionPlan {...props} /></details>
  </article>;
}

function FabricRow({ game, canAct, onQueue, fabric, chips }: ChipControlProps & { fabric: FastFabricProject; chips: ChipView }) {
  const name = chips.locations.find(item => item.id === fabric.location)?.name ?? 'Original location';
  return <article className="project-row" aria-label={'Fast fabric at ' + name}>
    <div className="project-heading"><strong>{name} fast fabric</strong><span>{fabric.paused ? 'Paused' : fabric.status === 'active' ? 'Operational' : fabric.status === 'ready' ? 'Available Week ' + fabric.readyWeek : 'Installing'}</span></div>
    {fabric.status !== 'active' ? <><Metrics><Metric label="Installation time">{fabric.elapsedWeeks} / {fabric.requiredWeeks} weeks</Metric><Metric label="Infrastructure effort">{formatWorkPoints(fabric.completedStaff)} / {formatWorkPoints(fabric.requiredStaff)} points</Metric><Metric label="Compute for testing">{formatUnits(fabric.completedWorkCUw)} / {formatUnits(fabric.requiredWorkCUw)} CUw</Metric></Metrics>{fabric.lastBottleneck && <p className="bottleneck">{fabric.lastBottleneck}</p>}{fabric.status === 'installing' && <ActionControl game={game} payload={{ kind: 'set_fabric_paused', fabricId: fabric.id, paused: !fabric.paused }} label={(fabric.paused ? 'Resume fabric · ' : 'Pause fabric · ') + name} canAct={canAct} onQueue={onQueue} compact />}</> : <Metrics><Metric label="Network upkeep">{formatMoney(CHIP_RULES.fabricFixedCentsPerWeek)} / week</Metric><Metric label="Operations staff">{formatWorkPoints(CHIP_RULES.fabricOperatingStaff)} points / week</Metric></Metrics>}
  </article>;
}

function FabricForm({ game, canAct, onQueue, chips }: ChipControlProps & { chips: ChipView }) {
  const [location, setLocation] = useState(chips.locations.find(item => !chips.fabricProjects.some(project => project.location === item.id))?.id ?? 'colocation');
  const chosen = chips.locations.find(item => item.id === location) ?? chips.locations[0];
  return <div>
    <label className="line-control wide-select" htmlFor="fast-fabric-location">Network location<select id="fast-fabric-location" value={chosen.id} disabled={!canAct} onChange={event => setLocation(event.target.value)}>{chips.locations.map(item => <option key={item.id} value={item.id}>{item.name}{chips.fabricProjects.some(project => project.location === item.id) ? ' · already planned or installed' : ''}</option>)}</select></label>
    <ActionControl game={game} payload={{ kind: 'install_fast_fabric', location: chosen.id }} label="Install fast fabric" canAct={canAct} onQueue={onQueue} />
    <p className="small-note">Fast fabric connects compatible racks at one location, improving training across racks and enabling sparse models. Separate sites, hardware types, and cloud memory stay separate.</p>
  </div>;
}


interface SuccessorWorkbenchProps extends ChipControlProps {
  chips?: ChipView;
  onOpenPanel?: (panel: string) => void;
  active?: boolean;
}

function SiliconLink({ panel, children, onOpenPanel }: { panel: string; children: string; onOpenPanel?: (panel: string) => void }) {
  return <a className="campus-link" href={'#' + panel} onClick={event => { if (onOpenPanel) { event.preventDefault(); onOpenPanel(panel); } }}>{children}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}

function SuccessorWorkbenchContent({ game, canAct, onQueue, chips: supplied, idPrefix = 'chips', onOpenPanel }: SuccessorWorkbenchProps) {
  const chips = useMemo(() => supplied ?? getChipView(game, game.playerCompanyId, CONTENT), [supplied, game]);
  const successor = chips.successor;
  const [parentId, setParentId] = useState(() => successor.parents.find(parent => parent.eligible)?.id ?? successor.parents[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, { name: string; improvement: ChipSuccessorImprovement }>>({});
  const [projectId, setProjectId] = useState<string | null>(null);
  const parent = successor.parents.find(item => item.id === parentId);
  const draft = drafts[parentId] ?? { name: parent ? (parent.name + ' Gen 2').slice(0, 48) : 'FL-2', improvement: 'memory' as ChipSuccessorImprovement };
  const updateDraft = (patch: Partial<typeof draft>) => setDrafts(previous => ({ ...previous, [parentId]: { ...draft, ...patch } }));
  const proposal = parent?.choices[draft.improvement];
  const completed = game.slices.research.completedByCompany[game.playerCompanyId] ?? [];
  const designs = chips.designs.filter(design => !!design.successor);
  const selected = projectId === null ? designs.at(-1) : designs.find(design => design.id === projectId);
  const workforce = getWorkforce(game, game.playerCompanyId);
  const allocation = game.slices.compute.fleets[game.playerCompanyId].allocation;
  const payload = parent ? { kind: 'start_chip_successor' as const, parentDesignId: parent.id, name: draft.name, improvement: draft.improvement } : null;
  return <div className="chip-successor-workbench" id={idPrefix + '-successor-workbench'}>
    <div className="campus-toolbar"><span className={'campus-status' + (completed.includes('S6') ? ' is-good' : '')}>{completed.includes('S6') ? 'S6 researched' : 'S6 required'}</span><span className="campus-copy">{successor.remaining} of {GEN2_SILICON_RULES.maxSuccessorsPerCompany} successor slots remain</span></div>
    {!successor.unlocked && <div className="campus-notice"><Layers3 size={17} aria-hidden="true" /><div><strong>Requirements for your next chip</strong><p>{successor.reason}</p><SiliconLink panel="research" onOpenPanel={onOpenPanel}>Open research</SiliconLink></div></div>}
    <div className="campus-layout"><div className="campus-stack">
      <section className="campus-card" aria-labelledby={idPrefix + '-silicon-heading'}><header className="campus-card-heading"><div><span className="campus-kicker">One upgrade per original design</span><h3 id={idPrefix + '-silicon-heading'}>Design your next chip.</h3><p>Build on a tested first-generation chip. The new design and prototype each have their own cost.</p></div><Cpu size={22} aria-hidden="true" /></header><div className="campus-card-body">
        <div className="campus-form-fields"><label className="campus-field" htmlFor={idPrefix + '-successor-parent'}>Qualified parent design<select id={idPrefix + '-successor-parent'} value={parentId} onChange={event => setParentId(event.target.value)} disabled={!canAct || !successor.parents.length}><option value="">{successor.parents.length ? 'Choose a parent design' : 'Qualify a first-generation prototype'}</option>{parentId && !parent && <option value={parentId}>Saved parent is no longer present</option>}{successor.parents.map(item => <option key={item.id} value={item.id}>{item.name}{item.existingSuccessorId ? ' · successor already funded' : item.eligible ? ' · qualified parent' : ' · check requirements'}</option>)}</select></label>
        <label className="campus-field" htmlFor={idPrefix + '-successor-name'}>Successor name<input id={idPrefix + '-successor-name'} value={draft.name} maxLength={48} disabled={!canAct} onChange={event => updateDraft({ name: event.target.value })} /></label></div>
        <fieldset className="campus-choices"><legend>Choose one improvement</legend>
          <label className={'campus-choice' + (draft.improvement === 'memory' ? ' is-selected' : '')}><input type="radio" name={idPrefix + '-successor-improvement'} checked={draft.improvement === 'memory'} onChange={() => updateDraft({ improvement: 'memory' })} disabled={!canAct} /><span><strong>More connected memory</strong><span className="campus-choice-benefit">Add {formatUnits(GEN2_SILICON_RULES.memoryBonusMUPerCU)} MU per useful CU, keeping the same rack footprint.</span><span className="campus-choice-tradeoff"><b>Tradeoff</b> Speed stays the same as the original design. Fabrication costs 10% more.</span></span><MemoryStick size={20} aria-hidden="true" /></label>
          <label className={'campus-choice' + (draft.improvement === 'throughput' ? ' is-selected' : '')}><input type="radio" name={idPrefix + '-successor-improvement'} checked={draft.improvement === 'throughput'} onChange={() => updateDraft({ improvement: 'throughput' })} disabled={!canAct} /><span><strong>More speed</strong><span className="campus-choice-benefit">Run the original design’s supported jobs 10% faster.</span><span className="campus-choice-tradeoff"><b>Tradeoff</b> Memory stays the same as the original design. Fabrication costs 10% more.</span></span><Cpu size={20} aria-hidden="true" /></label>
        </fieldset>
        {parent && proposal && <div className="campus-table-scroll"><table className="campus-table"><caption>{parent.name}: original design and planned upgrade</caption><thead><tr><th scope="col">Specification</th><th scope="col">Parent</th><th scope="col">Gen 2 target</th></tr></thead><tbody>
          <tr><th scope="row">Memory / useful CU</th><td>{formatUnits(parent.values.memoryMUPerCU)} MU</td><td>{formatUnits(proposal.memoryMUPerCU)} MU</td></tr>
          <tr><th scope="row">Compatible inference efficiency</th><td>{parent.values.servingBps ? parent.values.servingBps / 10000 + '×' : 'Unsupported'}</td><td>{proposal.servingBps ? proposal.servingBps / 10000 + '×' : 'Unsupported'}</td></tr>
          <tr><th scope="row">Compatible training efficiency</th><td>{parent.values.trainingBps ? parent.values.trainingBps / 10000 + '×' : 'Unsupported'}</td><td>{proposal.trainingBps ? proposal.trainingBps / 10000 + '×' : 'Unsupported'}</td></tr>
          <tr><th scope="row">Fabrication / attempted CU<span>foundry fees are separate</span></th><td>{formatMoney(parent.values.purchaseCentsPerCU)}</td><td>{formatMoney(proposal.purchaseCentsPerCU)}</td></tr>
          <tr><th scope="row">Power / useful CU</th><td>{parent.values.powerPerCU}</td><td>{proposal.powerPerCU}</td></tr>
          <tr><th scope="row">GPU use cost / CUw</th><td>{formatMoney(parent.values.variableCentsPerCUw)}</td><td>{formatMoney(proposal.variableCentsPerCUw)}</td></tr>
        </tbody></table></div>}
        {parent && parent.reasons.length > 0 && <div className="campus-notice is-warning"><TriangleAlert size={17} aria-hidden="true" /><div><strong>Design requirements</strong><p>{parent.reasons.join(' ')}</p></div></div>}
        {parentId && !parent && <p className="campus-copy">The original chip design is no longer available. Choose another design to continue.</p>}
        <ActionControl game={game} payload={payload} label="Fund Gen 2 design" canAct={canAct} onQueue={onQueue} emptyReason="Choose a tested first-generation chip and an upgrade to see the requirements." />
        <p className="campus-copy">Starting the project locks in the original chip and chosen upgrade. Each first-generation design can have one successor, even if renamed. Gen 2 chips cannot have successors. You need the research, a qualifying customer shipment, and your own tested first-generation design.</p>
        <div className="campus-links"><SiliconLink panel="chips" onOpenPanel={onOpenPanel}>First-generation designs & buyer orders</SiliconLink><SiliconLink panel="infrastructure" onOpenPanel={onOpenPanel}>Installed infrastructure</SiliconLink></div>
      </div></section>
      {designs.length > 0 && <section className="campus-card" aria-labelledby={idPrefix + '-successor-project-heading'}><header className="campus-card-heading"><div><span className="campus-kicker">Prototype and production</span><h3 id={idPrefix + '-successor-project-heading'}>Get your new chip into production.</h3><p>Test the prototype, then make chips for your own racks or a customer.</p></div></header><div className="campus-card-body">
        <label className="campus-field" htmlFor={idPrefix + '-successor-project'}>Successor project<select id={idPrefix + '-successor-project'} value={selected?.id ?? projectId ?? ''} onChange={event => setProjectId(event.target.value)}><option value="">Choose a saved project</option>{projectId && !selected && <option value={projectId}>Saved project is no longer present</option>}{designs.map(design => <option key={design.id} value={design.id}>{design.name} · {design.status === 'validated' ? 'Qualified' : design.status === 'design-ready' ? 'Prototype needed' : design.paused ? 'Paused' : design.status === 'designing' ? 'Designing' : 'Prototype work'}</option>)}</select></label>
        {selected && <DesignRow key={selected.id} game={game} canAct={canAct} onQueue={onQueue} design={selected} chips={chips} idPrefix={idPrefix + '-successor-'} />}
        <div className="campus-links"><SiliconLink panel="chips" onOpenPanel={onOpenPanel}>Fabrication, foundry slots & hardware buyers</SiliconLink><SiliconLink panel="infrastructure" onOpenPanel={onOpenPanel}>Install delivered racks</SiliconLink></div>
        <p className="campus-copy">Production and installation each have their own cost and requirements. Sold hardware goes directly to the buyer. Sales earn cash; ambitions that require a live frontier model still need that model.</p>
      </div></section>}
    </div><aside className="campus-stack" aria-label="Successor investment and staffing">
      <section className="campus-card"><header className="campus-card-heading"><div><span className="campus-kicker">Before fabrication</span><h3>Plan the engineering costs.</h3><p>The new chip needs its own budget and engineering work.</p></div></header><div className="campus-card-body">
        <dl className="campus-facts">
          <div className="campus-fact"><dt>Successor design fee</dt><dd>{formatMoney(GEN2_SILICON_RULES.designFeeCents)}</dd></div><div className="campus-fact"><dt>Later prototype fee</dt><dd>{formatMoney(GEN2_SILICON_RULES.prototypeFeeCents)}</dd></div>
          <div className="campus-fact"><dt>Design effort</dt><dd>{formatWorkPoints(GEN2_SILICON_RULES.designHardwareStaff)} Hardware points</dd></div><div className="campus-fact"><dt>Design simulation</dt><dd>{formatUnits(GEN2_SILICON_RULES.designWorkCUw)} research CUw</dd></div>
          <div className="campus-fact"><dt>Prototype review</dt><dd>{formatWorkPoints(GEN2_SILICON_RULES.prototypeHardwareStaff)} Hardware + {formatWorkPoints(GEN2_SILICON_RULES.prototypeMlStaff)} Design points</dd></div><div className="campus-fact"><dt>Prototype validation</dt><dd>{formatUnits(GEN2_SILICON_RULES.prototypeWorkCUw)} development CUw</dd></div>
          <div className="campus-fact"><dt>Team Hardware output</dt><dd>{formatWorkPoints(workforce.capacity.hardware)} points / week</dd></div><div className="campus-fact"><dt>Team Design output</dt><dd>{formatWorkPoints(workforce.capacity.ml)} points / week</dd></div>
          <div className="campus-fact"><dt>Research limit</dt><dd>{formatUnits(allocation.research)} CUw / week</dd></div><div className="campus-fact"><dt>Development limit</dt><dd>{formatUnits(allocation.development)} CUw / week</dd></div>
        </dl>
        <p className="campus-copy">Budget separately for staff, compute, production, installation, and running the site. Progress needs available staff and GPUs. The prototype must fit in one compatible hardware pool’s memory.</p>
        <div className="campus-links"><SiliconLink panel="people" onOpenPanel={onOpenPanel}>View team output</SiliconLink><SiliconLink panel="compute" onOpenPanel={onOpenPanel}>Allocate research & development</SiliconLink></div>
      </div></section>
    </aside></div>
  </div>;
}

export const ChipSuccessorWorkbench = memo(function ChipSuccessorWorkbench(props: SuccessorWorkbenchProps) {
  return props.active === false ? null : <SuccessorWorkbenchContent {...props} />;
}, (previous, next) => next.active === false || previous.active !== false && previous.game === next.game
  && previous.canAct === next.canAct && previous.onQueue === next.onQueue && previous.onOpenPanel === next.onOpenPanel
  && previous.idPrefix === next.idPrefix && previous.chips === next.chips);

export function ChipsPanel(props: PanelProps) {
  const { game } = props;
  const [successorOpen, setSuccessorOpen] = useState(false);
  const chips = getChipView(game, game.playerCompanyId, CONTENT);
  const known = game.slices.research.completedByCompany[game.playerCompanyId] ?? [];
  const entered = Object.values(game.slices.research.projects).some(project => project.companyId === game.playerCompanyId && project.researchId === 'R16');
  if (!chips.canDesign && !chips.canInstallFabric && !chips.designs.length && !chips.fabricProjects.length && !entered && !(known.includes('R7') && known.includes('R12'))) return null;
  const incoming = chips.batches.filter(batch => batch.status === 'fabricating');
  const delivered = chips.batches.filter(batch => batch.status === 'delivered');
  return <Section title="Chips and networking" id="chips">
    <p className="small-note">Design a chip, test a prototype, then make and install your racks. Their usable capacity depends on chip yield, compatible jobs, memory, staff, power, and cooling.</p>
    <Metrics><Metric label="Recorded customer-serving weeks">{chips.servingHistoryWeeks} / {chips.requiredServingWeeks}</Metric><Metric label="Qualified chip designs">{chips.designs.filter(design => design.status === 'validated').length}</Metric></Metrics>
    {chips.canDesign ? <details className="inline-details"><summary>Specify a custom chip</summary><DesignForm {...props} chips={chips} /></details> : <p className="small-note">Complete Chip feasibility to fund a design. Starting that research opens hardware-specialist hiring under People.</p>}
    <details className="inline-details" onToggle={event => setSuccessorOpen(event.currentTarget.open)}><summary>Second-generation silicon · S6</summary><ChipSuccessorWorkbench {...props} chips={chips} idPrefix="chips" active={successorOpen} /></details>
    {chips.designs.length > 0 && <div className="project-list">{chips.designs.map(design => <DesignRow key={design.id} {...props} design={design} chips={chips} />)}</div>}
    {incoming.map(batch => <div className="project-row" key={batch.id}><div className="project-heading"><strong>{chips.designs.find(design => design.id === batch.designId)?.name ?? 'Custom chip'} production</strong><span>Arrival Week {batch.arrivalWeek}</span></div><Metrics><Metric label="Foundry">{CHIP_FOUNDRIES[batch.foundry ?? 'standard'].name}</Metric><Metric label="Racks in fabrication">{batch.racks}</Metric><Metric label="Useful capacity / attempted slots">{formatUnits(batch.usableCU)} / {formatUnits(batch.attemptedCU)} CU</Metric><Metric label="Production payment">{formatMoney(batch.purchaseCents)}</Metric><Metric label="Destination">{chips.locations.find(location => location.id === batch.location)?.name ?? 'Original location'}</Metric></Metrics><p className="small-note">Your chips are being made. Install the racks after delivery to start using them.</p></div>)}
    {delivered.length > 0 && <details className="inline-details"><summary>Delivered production · {delivered.length}</summary>{delivered.slice(-8).reverse().map(batch => <div className="receipt-row" key={batch.id}><strong>{chips.designs.find(design => design.id === batch.designId)?.name ?? 'Custom chip'} · Week {batch.deliveredWeek}</strong><p className="small-note">{batch.racks} rack{batch.racks === 1 ? '' : 's'} with {formatUnits(batch.usableCU)} useful CU, at {percent(batch.yieldBps)} yield. Production paid {formatMoney(batch.purchaseCents)}.</p></div>)}<p className="small-note">Install or park the delivered racks under <a href="#infrastructure">Infrastructure</a>.</p></details>}
    {chips.designs.some(design => design.status === 'validated') && <HardwareSalesPanel {...props} designs={chips.designs.filter(design => design.status === 'validated')} />}
    {chips.fabricProjects.map(fabric => <FabricRow key={fabric.id} {...props} fabric={fabric} chips={chips} />)}
    {chips.canInstallFabric ? <details className="inline-details"><summary>Install fast fabric at a location</summary><FabricForm {...props} chips={chips} /></details> : <p className="small-note">Sparse architecture research opens fast-fabric installation.</p>}
  </Section>;
}
