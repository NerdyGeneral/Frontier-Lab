'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Brain, Cpu, Database, FlaskConical, Layers, LockKeyhole, SlidersHorizontal, Sparkles } from 'lucide-react';
import { RESOURCE_SCALE as U, type GameState, type ModelVersion } from '../contracts/types';
import type { ModelDesignSpec } from '../contracts/model-design';
import type { ModelCustomization } from '../contracts/model-customization';
import { DEFAULT_MODEL_CUSTOMIZATION, MODEL_CUSTOMIZATION_OPTIONS } from '../content/model-customization';
import { CONTENT } from '../content/catalog';
import { MODEL_DESIGN_FAMILIES, getModelDesignForecast, getAISystemForecastModel } from '../modules/model-design';
import { BASE_BEHAVIOR, getTrainingPreview } from '../modules/lab-planner';
import { getAISystemMetrics } from '../modules/ai-systems';
import { hasResearch } from '../modules/research';
import { formatMoney, formatUnits } from '../core/math';
import { formatWorkPoints } from '../modules/workforce-points';
import { MODEL_CUSTOMIZATION_KEYS, MODEL_DESIGN_PURPOSES, applyModelDesignPurpose, customizationOptionName, inheritModelDesignDraft, type ModelCustomizationKey } from './model-design-draft';
import { canonicalStateHash } from '../core/canonical';
import { useStudioTaskActions } from './studio-interaction-context';
import { copyModelDesignCandidate, forecastSkill, getComputeBenefitHint, getDesignCandidateForecast, humanizeDesignRequirement, rememberModelDesign, type ModelDesignCandidate } from './model-design-insights';
import { ModelDesignComparison } from './model-design-comparison';
import { StudioDecisionLayout } from './studio-decision-layout';
import { useModelWorkspace } from './model-workspace-context';
import { developmentGoalChecks, developmentGoalName } from './development-goals';
import { DevelopmentGoalSummary } from './development-workspace';
import { AISystemDesigner, AISystemMetricsView, aiSystemName } from './ai-system-designer';

type DesignDomain = keyof ModelDesignSpec['dataMix'];
type Family = ModelDesignSpec['family'];
const DOMAINS: readonly { id: DesignDomain; label: string; description: string; color: string }[] = [
  { id: 'conversation', label: 'Conversation', description: 'Helpful, natural dialogue.', color: '#79c9ac' },
  { id: 'documents', label: 'Documents', description: 'Read and extract information.', color: '#7fbfdf' },
  { id: 'coding', label: 'Coding', description: 'Write and understand code.', color: '#9dacf3' },
  { id: 'tools', label: 'Tool use', description: 'Choose and use functions.', color: '#c2a1df' },
  { id: 'reasoning', label: 'Reasoning', description: 'Solve problems over multiple steps.', color: '#e3bd7e' },
  { id: 'longContext', label: 'Long context', description: 'Connect information across long inputs.', color: '#db9eaa' },
  { id: 'multimodal', label: 'Multimodal', description: 'Understand images alongside text.', color: '#a9c88b' },
];
const CORE_DOMAINS = ['conversation', 'documents', 'coding', 'tools'] as const;
const isCore = (id: DesignDomain): id is typeof CORE_DOMAINS[number] => (CORE_DOMAINS as readonly string[]).includes(id);
const score = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 1 });
const width = (bps: number) => `${Math.max(0, Math.min(10000, bps)) / 100}%`;
const billions = (millions: number) => (millions / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 });
const prettyFamily = (family: Family) => MODEL_DESIGN_FAMILIES[family].name;
const mixTotal = (spec: ModelDesignSpec) => DOMAINS.reduce((sum, domain) => sum + spec.dataMix[domain.id], 0);
const mixShare = (spec: ModelDesignSpec, domain: DesignDomain) => mixTotal(spec) > 0 ? spec.dataMix[domain] / mixTotal(spec) : 0;

/** Round the visible shares together, so their labels still total 100%. */
function displayedShares(spec: ModelDesignSpec): Record<DesignDomain, number> {
  const exact = DOMAINS.map(({ id }) => ({ id, percent: mixShare(spec, id) * 100 }));
  const values = Object.fromEntries(exact.map(item => [item.id, Math.floor(item.percent)])) as Record<DesignDomain, number>;
  if (mixTotal(spec) === 0) return values;
  let remainder = 100 - Object.values(values).reduce((sum, value) => sum + value, 0);
  for (const item of [...exact].sort((a, b) => (b.percent % 1) - (a.percent % 1))) {
    if (remainder-- <= 0) break;
    values[item.id]++;
  }
  return values;
}

function selectedPackets(game: GameState, packetIds: readonly string[]) {
  return [...new Set(packetIds)].map(id => game.slices.data.packets[id])
    .filter(packet => packet && packet.prepared && (packet.companyId ?? game.playerCompanyId) === game.playerCompanyId);
}

function hasExamples(game: GameState, packetIds: readonly string[], domain: DesignDomain) {
  return selectedPackets(game, packetIds).some(packet => packet.readyUnits > 0 &&
    (isCore(domain) ? packet.coverageBps[domain] : packet.advancedCoverageBps?.[domain] ?? 0) > 0);
}

function startingScore(base: ModelVersion | undefined, domain: DesignDomain) {
  return base ? isCore(domain) ? base.capabilityBps[domain] : base.advancedCapabilities?.[domain] ?? 0 : 0;
}

const CUSTOMIZATION_LABELS: Record<ModelCustomizationKey, string> = {
  attention: 'Attention design', contextWindow: 'Context capacity', precision: 'Weight precision',
  objective: 'Training focus', behavior: 'Response style',
};
const researchName = (id: string) => CONTENT.research.find(item => item.id === id)?.name ?? id;

function lockedCustomizationResearch(game: GameState, choices: ModelCustomization) {
  return MODEL_CUSTOMIZATION_KEYS.flatMap(key => {
    const selected = MODEL_CUSTOMIZATION_OPTIONS[key].find(option => option.value === choices[key]);
    return selected?.requiredResearch && !hasResearch(game, game.playerCompanyId, selected.requiredResearch) ? [selected.requiredResearch] : [];
  });
}

export function ModelDesignResearchRequirement({ game, id, onOpenResearch }: { game: GameState; id: string; onOpenResearch?: (id: string) => void }) {
  const definition = CONTENT.research.find(item => item.id === id);
  const prerequisites = (definition?.requires ?? []).filter(required => !hasResearch(game, game.playerCompanyId, required));
  return <li><a href={onOpenResearch ? '#research-method-' + id : '#research'} onClick={event => {
    if (onOpenResearch) { event.preventDefault(); onOpenResearch(id); }
  }}>{researchName(id)}</a>{prerequisites.length > 0 && <small>First: {prerequisites.map(researchName).join(', ')}.</small>}</li>;
}

function DesignResearchRequirements({ game, ids }: { game: GameState; ids: readonly string[] }) {
  const actions = useStudioTaskActions();
  return <ul className="model-design-requirement-links">{[...new Set(ids)].map(id => <ModelDesignResearchRequirement key={id} game={game} id={id} onOpenResearch={actions?.openResearch} />)}</ul>;
}

function CustomizationChoices({ game, field, value, inherited = false, onChange }: {
  game: GameState; field: ModelCustomizationKey; value: ModelCustomization; inherited?: boolean;
  onChange: (key: ModelCustomizationKey, value: string) => void;
}) {
  const id = useId();
  const options = MODEL_CUSTOMIZATION_OPTIONS[field];
  const selected = options.find(option => option.value === value[field]);
  const required = selected?.requiredResearch;
  const needsResearch = required && !hasResearch(game, game.playerCompanyId, required);
  return <div className="model-customization-group" role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`}>
    <div className="model-customization-label"><h5 id={`${id}-label`}>{CUSTOMIZATION_LABELS[field]}</h5>{inherited && <span>Inherited from starting model</span>}</div>
    <div className="model-customization-options">
      {options.map(option => {
        const locked = !!option.requiredResearch && !hasResearch(game, game.playerCompanyId, option.requiredResearch);
        return <button key={option.value} type="button" disabled={inherited} aria-pressed={value[field] === option.value}
          data-locked={locked} onClick={() => onChange(field, option.value)}
          aria-label={option.name + (locked ? ' · Requires ' + researchName(option.requiredResearch!) : '')}>
          <span>{option.name}{locked && <LockKeyhole size={12} aria-hidden="true" />}</span>
          {locked && <small>Research needed</small>}
        </button>;
      })}
    </div>
    <p id={`${id}-help`} className="model-design-help">{selected?.description}</p>
    {needsResearch && <div className="model-customization-unlock"><span>Research needed</span><DesignResearchRequirements game={game} ids={[required]} /></div>}
  </div>;
}

export interface ModelDesignerProps {
  game: GameState;
  baseModelId: string;
  packetIds: string[];
  value: ModelDesignSpec;
  onChange: (spec: ModelDesignSpec) => void;
  canAct: boolean;
  showForecast?: boolean;
}

/** Inputs are a draft owned by the training task. Nothing here changes campaign state. */
export function ModelDesigner({ game, baseModelId, packetIds, value, onChange, canAct, showForecast = true }: ModelDesignerProps) {
  const id = useId();
  const base = game.slices.models.versions[baseModelId];
  const family = MODEL_DESIGN_FAMILIES[value.family];
  const foundations = value.mode === 'foundation';
  const dataTotal = mixTotal(value);
  const visibleShares = displayedShares(value);
  const prepared = selectedPackets(game, packetIds);
  const [openSection, setOpenSection] = useState<'learning' | 'architecture' | 'mix' | null>(value.mode === 'foundation' ? 'architecture' : null);
  const [undo, setUndo] = useState<ModelDesignSpec[]>([]);
  const [comparison, setComparison] = useState<ModelDesignCandidate | null>(null);
  const expectedValue = useRef(canonicalStateHash(value)), editGroup = useRef<string | null>(null);
  const applyChange = (next: ModelDesignSpec, group?: string) => {
    if (canonicalStateHash(next) === canonicalStateHash(value)) return;
    if (!group || editGroup.current !== group) setUndo(history => rememberModelDesign(history, value));
    editGroup.current = group ?? null; expectedValue.current = canonicalStateHash(next); onChange(next);
  };
  const changed = (patch: Partial<ModelDesignSpec>, group?: string) => applyChange({ ...value, ...patch }, group);
  const candidate = useMemo(() => ({ spec: value, baseModelId, packetIds }), [value, baseModelId, packetIds]);
  const choice = getModelDesignForecast(game, game.playerCompanyId, baseModelId, packetIds, value);
  const researchLevel = choice.researchLevel;
  const customization = value.customization ?? DEFAULT_MODEL_CUSTOMIZATION;
  const focusSummary = DOMAINS.filter(domain => visibleShares[domain.id] > 0).sort((a, b) => visibleShares[b.id] - visibleShares[a.id])
    .slice(0, 3).map(domain => `${domain.label} ${visibleShares[domain.id]}%`).join(' · ');
  const missingData = DOMAINS.filter(domain => value.dataMix[domain.id] > 0 && !hasExamples(game, packetIds, domain.id));
  useEffect(() => {
    const key = canonicalStateHash(value);
    if (key !== expectedValue.current) { setUndo([]); editGroup.current = null; expectedValue.current = key; }
  }, [value]);
  useEffect(() => { if (value.mode === 'foundation') setOpenSection('architecture'); }, [value.mode]);
  const toggleSection = (section: NonNullable<typeof openSection>, open: boolean) => setOpenSection(current => open ? section : current === section ? null : current);
  const undoChange = () => {
    const previous = undo.at(-1); if (!previous) return;
    expectedValue.current = canonicalStateHash(previous); editGroup.current = null;
    setUndo(history => history.slice(0, -1)); onChange(structuredClone(previous));
  };

  // Changing the selected starting model must also change an adaptation's
  // inherited hardware design, rather than silently train with a stale family.
  useEffect(() => {
    if (value.mode !== 'adaptation' || !base) return;
    const inherited = inheritModelDesignDraft(value, base);
    if (value.family !== inherited.family || value.parameterMillions !== inherited.parameterMillions || value.sparsityBps !== inherited.sparsityBps
      || JSON.stringify(value.customization) !== JSON.stringify(inherited.customization)
      || JSON.stringify(value.system) !== JSON.stringify(inherited.system)) onChange(inherited);
  }, [base, value, onChange]);

  const setMode = (mode: ModelDesignSpec['mode']) => {
    const next = { ...value, mode };
    applyChange(mode === 'adaptation' && base ? inheritModelDesignDraft(next, base) : next);
  };
  const selectFamily = (next: Family) => {
    const config = MODEL_DESIGN_FAMILIES[next];
    changed({ family: next, parameterMillions: config.defaultMillions, computeBudgetCUw: config.defaultComputeCUw });
  };
  const setSize = (next: number) => {
    if (!Number.isFinite(next)) return;
    changed({ parameterMillions: Math.max(family.minMillions, Math.min(family.maxMillions, Math.round(next / 250) * 250)) }, 'size');
  };
  const setBudget = (next: number) => {
    if (!Number.isFinite(next)) return;
    changed({ computeBudgetCUw: Math.max(U, Math.min(50000 * U, Math.round(next) * U)) }, 'budget');
  };
  const setCustomization = (key: ModelCustomizationKey, next: string) => changed({ customization: { ...customization, [key]: next } });

  const controls = <section className="model-designer" aria-labelledby={`${id}-title`}>
    <header className="model-designer-heading"><span className="model-designer-eyebrow"><SlidersHorizontal size={16} aria-hidden="true" />Custom model design</span>
      <h3 id={`${id}-title`}>Design your next model</h3>
    </header>
    <div className="model-design-draft-tools"><button type="button" disabled={!canAct || !undo.length} onClick={undoChange}>Undo last change</button>
      <button type="button" onClick={() => setComparison(copyModelDesignCandidate(candidate))}>{comparison ? 'Replace comparison' : 'Keep for comparison'}</button>
      {comparison && <span>Comparison kept: {comparison.spec.name}</span>}
    </div>
    {comparison && <ModelDesignComparison game={game} saved={comparison} current={candidate} canAct={canAct} onClear={() => setComparison(null)} onRestore={() => applyChange(structuredClone(comparison.spec))} />}

    <fieldset className="model-design-fieldset" disabled={!canAct} onBlur={() => { editGroup.current = null; }}>
      <legend className="visually-hidden">Model design controls</legend>
      <div className="model-design-mode" role="group" aria-label="Custom training approach">
        <button type="button" aria-pressed={!foundations} onClick={() => setMode('adaptation')}><Brain size={18} aria-hidden="true" /><span>Improve this model<small>Keep its size and architecture</small></span></button>
        <button type="button" aria-pressed={foundations} onClick={() => setMode('foundation')}><Layers size={18} aria-hidden="true" /><span>Build a new foundation<small>Choose a new size and architecture</small></span></button>
      </div>
      <label className="model-design-name" htmlFor={`${id}-name`}>New version name
        <input id={`${id}-name`} value={value.name} onChange={event => changed({ name: event.target.value }, 'name')} maxLength={48} autoComplete="off" placeholder="Name your model" />
      </label>

      <section className="model-design-section" aria-labelledby={`${id}-purpose`}>
        <header><Sparkles size={18} aria-hidden="true" /><h4 id={`${id}-purpose`}>Purpose</h4></header>
        <div className="model-design-purpose-presets" role="group" aria-label="Model purpose starting points">
          {MODEL_DESIGN_PURPOSES.map(purpose => {
            const next = applyModelDesignPurpose(value, purpose, base);
            const locked = lockedCustomizationResearch(game, next.customization!);
            const selected = value.computeBudgetCUw === next.computeBudgetCUw && DOMAINS.every(domain => value.dataMix[domain.id] === next.dataMix[domain.id])
              && MODEL_CUSTOMIZATION_KEYS.every(key => customization[key] === next.customization![key]);
            return <button type="button" key={purpose.id} title={purpose.description} aria-pressed={selected} onClick={() => applyChange(next)}>
              <strong>{purpose.name}</strong>
              {locked.length > 0 && <small><LockKeyhole size={12} aria-hidden="true" />{locked.length} to research</small>}
            </button>;
          })}
        </div>
        <p className="model-design-help">Starting points change the settings below. Inherited hardware stays fixed; Undo restores the previous design.</p>
        <details className="model-design-section-disclosure" open={openSection === 'learning'} onToggle={event => toggleSection('learning', event.currentTarget.open)}>
          <summary><span>Learning & responses<small>{customizationOptionName('objective', customization.objective)} · {customizationOptionName('behavior', customization.behavior)}</small></span><b>8 choices</b></summary>
          <CustomizationChoices game={game} field="objective" value={customization} onChange={setCustomization} />
          <CustomizationChoices game={game} field="behavior" value={customization} onChange={setCustomization} />
        </details>
      </section>

      <AISystemDesigner game={game} value={value.system} inherited={!foundations}
        onChange={system => { const next = { ...value }; if (system) next.system = system; else delete next.system; if (system?.kind === 'experts') next.sparsityBps = 0; applyChange(next); }}
        onNewFoundation={() => setMode('foundation')} />

      <section className="model-design-section" aria-labelledby={`${id}-architecture`}>
        <header><Cpu size={18} aria-hidden="true" /><h4 id={`${id}-architecture`}>Architecture{!foundations && <small> · inherited</small>}</h4></header>
        {foundations ? <details className="model-design-section-disclosure" open={openSection === 'architecture'} onToggle={event => toggleSection('architecture', event.currentTarget.open)}>
          <summary><span>Size, attention, context & precision<small>{prettyFamily(value.family)} · {billions(value.parameterMillions)}B · {customizationOptionName('attention', customization.attention)} · {customizationOptionName('precision', customization.precision)}</small></span><b>Change</b></summary>
          <div className="model-design-families" role="group" aria-label="Model family">
            {(Object.keys(MODEL_DESIGN_FAMILIES) as Family[]).map(key => {
              const config = MODEL_DESIGN_FAMILIES[key];
              const unlockLevel = key === 'edge' ? 1 : key === 'frontier' ? 3 : 0;
              const locked = researchLevel < unlockLevel;
              return <button type="button" key={key} aria-pressed={value.family === key} title={config.description}
                onClick={() => selectFamily(key)} data-locked={locked}>
                <strong>{config.name}{locked && <LockKeyhole size={13} aria-hidden="true" />}</strong>
                <span>{billions(config.minMillions)}–{billions(config.maxMillions)}B</span>
                <small>{locked ? `Research level ${unlockLevel}` : key === 'edge' ? 'Low memory' : key === 'frontier' ? 'Highest capacity' : key === 'compact' ? 'Focused skills' : 'Broad skills'}</small>
              </button>;
            })}
          </div>
          <p className="model-design-help">{family.description}</p>
        <div className="model-design-knobs">
          <div className="model-design-control">
            <div className="model-design-control-heading"><label htmlFor={`${id}-size`}>Model size</label><span><input id={`${id}-size-number`} aria-label="Model size in billions of parameters" type="number" min={family.minMillions / 1000} max={family.maxMillions / 1000} step={0.25} value={value.parameterMillions / 1000} disabled={!foundations} onChange={event => setSize(event.target.valueAsNumber * 1000)} /> B</span></div>
            <input id={`${id}-size`} type="range" min={family.minMillions} max={family.maxMillions} step={250} value={value.parameterMillions} disabled={!foundations} aria-valuetext={`${billions(value.parameterMillions)} billion parameters`} onChange={event => setSize(event.target.valueAsNumber)} />
            <p className="model-design-help">More parameters raise potential and memory needs. They also need more training work.</p>
          </div>
          <div className="model-design-control">
            <div className="model-design-control-heading"><label htmlFor={`${id}-sparsity`}>Sparsity</label><output htmlFor={`${id}-sparsity`}>{value.sparsityBps / 100}% skipped per token</output></div>
            {value.system?.kind === 'experts' && <p className="model-design-help">Expert routing chooses the active parameter share. Use the experts-per-request control above. Expert networks also need fast fabric and at least 16 CU in one compatible pool.</p>}
            <input id={`${id}-sparsity`} type="range" min={0} max={8000} step={500} value={value.sparsityBps} disabled={!foundations || value.system?.kind === 'experts'} aria-valuetext={`${value.sparsityBps / 100}% of parameters inactive per token`} onChange={event => changed({ sparsityBps: event.target.valueAsNumber }, 'sparsity')} />
            <p className="model-design-help">Use less of the model per token. The forecast includes the compute, memory and skill tradeoffs.</p>
          </div>
        </div>
        {(['attention', 'contextWindow', 'precision'] as const).map(field => <CustomizationChoices key={field} game={game} field={field} value={customization} inherited={!foundations} onChange={setCustomization} />)}
        <p className="model-design-help">Locked choices remain visible for planning. Select one to preview its tradeoffs; complete the named research before starting the run.</p>
        </details> : <div className="model-design-inherited-profile">
          <p>{base?.name ?? 'Selected model'} keeps its {prettyFamily(value.family).toLowerCase()} architecture.</p>
          <dl><div><dt>Size</dt><dd>{billions(value.parameterMillions)}B · {value.sparsityBps / 100}% sparse</dd></div>
            {(['attention', 'contextWindow', 'precision'] as const).map(field => <div key={field}><dt>{CUSTOMIZATION_LABELS[field]}</dt><dd>{customizationOptionName(field, customization[field])}</dd></div>)}</dl>
          <p className="model-design-help">Choose Build a new foundation above to change the hardware.</p>
        </div>}
      </section>

      <details className="model-design-section model-design-section-disclosure" open={openSection === 'mix'} onToggle={event => toggleSection('mix', event.currentTarget.open)}>
        <summary><span><span className="model-design-section-title"><Database size={18} aria-hidden="true" />Training mix</span><small>{focusSummary || 'Choose at least one priority'} · {prepared.length} prepared datasets</small>{missingData.length > 0 && <small className="model-design-missing-summary">Missing examples: {missingData.map(domain => domain.label).join(', ')}</small>}</span><b>7 skills</b></summary>
        <p className="model-design-help">Set relative priorities. Their shares always add up to 100% when at least one is above zero. A priority needs matching prepared examples to improve.</p>
        <div className="model-design-mix-bar" aria-hidden="true">{DOMAINS.map(domain => <span key={domain.id} style={{ width: `${mixShare(value, domain.id) * 100}%`, background: domain.color }} />)}</div>
        <div className="model-design-mix-controls">
          {DOMAINS.map(domain => {
            const covered = hasExamples(game, packetIds, domain.id), share = mixShare(value, domain.id);
            return <div key={domain.id} className="model-design-mix-row" style={{ '--skill-color': domain.color } as CSSProperties}>
              <div className="model-design-mix-label"><label htmlFor={`${id}-mix-${domain.id}`}><i aria-hidden="true" />{domain.label}</label>
                <output htmlFor={`${id}-mix-${domain.id}`}>{visibleShares[domain.id]}% <span>of mix</span></output></div>
              <input id={`${id}-mix-${domain.id}`} type="range" min={0} max={100} step={1} value={value.dataMix[domain.id]} aria-label={`${domain.label} priority`} aria-valuetext={`${value.dataMix[domain.id]} priority, ${visibleShares[domain.id]}% of training mix`} aria-describedby={`${id}-help-${domain.id}`} onChange={event => changed({ dataMix: { ...value.dataMix, [domain.id]: event.target.valueAsNumber } }, 'mix-' + domain.id)} />
              <p id={`${id}-help-${domain.id}`} className="model-design-data-status" data-missing={!covered && share > 0}>{share === 0 ? 'Not targeted in this run' : covered ? domain.description : 'No matching prepared data selected'}</p>
            </div>;
          })}
        </div>
        {dataTotal === 0 && <p className="model-design-warning" role="status">Choose at least one training priority.</p>}
        <p className="model-design-selection"><strong>{prepared.length} prepared {prepared.length === 1 ? 'dataset' : 'datasets'} selected</strong>{prepared.length ? <span>{prepared.map(packet => packet.name).join(' · ')}</span> : <span>Choose prepared training data above, or acquire and prepare a specialist pack.</span>}</p>
      </details>

      <section className="model-design-section" aria-labelledby={`${id}-budget-heading`}>
        <header><FlaskConical size={18} aria-hidden="true" /><h4 id={`${id}-budget-heading`}>Training budget</h4></header>
        <label className="model-design-budget" htmlFor={`${id}-budget`}>Training compute budget <span><input id={`${id}-budget`} type="number" min={1} max={50000} step={1} inputMode="numeric" value={value.computeBudgetCUw / U} onChange={event => setBudget(event.target.valueAsNumber)} /> CUw</span></label>
        <div className="model-design-presets" role="group" aria-label="Training budget starting points">
          {([{ label: 'Short run', multiplier: .5 }, { label: 'Standard run', multiplier: 1 }, { label: 'Long run', multiplier: 2 }] as const).map(preset => {
            const budget = Math.max(1, Math.round(family.defaultComputeCUw * preset.multiplier / U));
            return <button key={preset.label} type="button" onClick={() => setBudget(budget)}>{preset.label}<span>{budget.toLocaleString()} CUw</span></button>;
          })}
        </div>
        <p className="model-design-help">This is work the run must actually complete. Larger budgets can improve learning, with diminishing returns. More work takes more time and operating cash.</p>
      </section>
    </fieldset>
  </section>;
  return showForecast ? <StudioDecisionLayout className="model-design-workspace" decisionSummary={<ModelDesignDecisionSummary game={game} baseModelId={baseModelId} packetIds={packetIds} value={value} />}
    summaryLabel="Custom model forecast" summary={<ModelDesignForecast game={game} baseModelId={baseModelId} packetIds={packetIds} value={value} />}>{controls}</StudioDecisionLayout> : controls;
}

export function ModelDesignDecisionSummary({ game, baseModelId, packetIds, value }: Pick<ModelDesignerProps, 'game' | 'baseModelId' | 'packetIds' | 'value'>) {
  const forecast = useMemo(() => getDesignCandidateForecast(game, { spec: value, baseModelId, packetIds }), [game, baseModelId, packetIds, value]);
  const focused = DOMAINS.filter(domain => value.dataMix[domain.id] > 0).sort((a, b) => value.dataMix[b.id] - value.dataMix[a.id]).slice(0, 2);
  const goal = useModelWorkspace()?.developmentGoal;
  const goalModel = forecast.hasPrepared && forecast.preview ? getAISystemForecastModel(value, forecast.design, { capabilityBps: forecast.preview.capabilityRange.minimum, advancedCapabilities: forecast.preview.advancedCapabilityRange?.minimum, reliabilityBps: forecast.preview.reliabilityRange.minimum }) : undefined;
  const checks = goal && goalModel ? developmentGoalChecks(game, goal, goalModel).checks : [];
  const allocated = game.slices.compute.fleets[game.playerCompanyId]?.allocation.development ?? 0;
  const weeks = allocated > 0 ? Math.max(1, Math.ceil(forecast.design.workCUw / allocated)) : null;
  return <div className="model-design-decision-reading">
    {goal && <span className="model-design-goal-reading">{developmentGoalName(goal)}{checks.length > 0 ? ` · ${checks.filter(check => check.passed).length}/${checks.length} challenge workloads forecast to pass` : ''}</span>}
    <strong>{forecast.hasPrepared && forecast.preview ? focused.map(domain => `${domain.label} ${score(forecastSkill(forecast.preview!, domain.id))}`).join(' · ') : 'Choose prepared data for the skill forecast'}</strong>
    <span>{formatMoney(forecast.design.feeCents)} setup · {formatUnits(forecast.design.workCUw)} CUw · {formatUnits(forecast.design.requiredMemory)} MU training memory · {weeks === null ? 'assign development compute' : `${weeks} nominal GPU ${weeks === 1 ? 'week' : 'weeks'}`}</span>
    {forecast.reason && <small title={humanizeDesignRequirement(forecast.reason.message)}>{humanizeDesignRequirement(forecast.reason.message)}</small>}
  </div>;
}

export function ModelDesignForecast({ game, baseModelId, packetIds, value }: Pick<ModelDesignerProps, 'game' | 'baseModelId' | 'packetIds' | 'value'>) {
  const id = useId();
  const design = getModelDesignForecast(game, game.playerCompanyId, baseModelId, packetIds, value);
  const base = game.slices.models.versions[baseModelId];
  const preview = useMemo(() => base && packetIds.length ? getTrainingPreview(game, game.playerCompanyId, {
    baseModelId, packetId: packetIds[0], packetIds, modelDesign: value,
    recipeId: value.mode === 'foundation' ? 'custom-model-foundation' : 'custom-model-adaptation',
  }) : null, [game, base, baseModelId, packetIds, value]);
  const allocation = game.slices.compute.fleets[game.playerCompanyId]?.allocation.development ?? 0;
  const nominalWeeks = allocation > 0 ? Math.max(1, Math.ceil(design.workCUw / allocation)) : null;
  const reason = design.reason ?? preview?.reason;
  const anyPrepared = selectedPackets(game, packetIds).length > 0;
  const visiblePreview = !!preview && anyPrepared;
  const customization = value.customization ?? DEFAULT_MODEL_CUSTOMIZATION;
  const requiredResearch = [...new Set(lockedCustomizationResearch(game, customization))];
  const computeHint = useMemo(() => getComputeBenefitHint(game, { spec: value, baseModelId, packetIds }), [game, value, baseModelId, packetIds]);
  const behaviorRows = [
    { label: 'Reliability', current: base?.reliabilityBps, minimum: preview?.reliabilityRange.minimum, maximum: preview?.reliabilityRange.maximum, lower: false },
    { label: 'Confident errors', current: base?.behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps, minimum: preview?.behavior?.confidentErrorBps, maximum: preview?.behavior?.confidentErrorBps, lower: true },
    { label: 'Unnecessary refusals', current: base?.behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps, minimum: preview?.behavior?.falseRefusalBps, maximum: preview?.behavior?.falseRefusalBps, lower: true },
  ];

  return <section className="model-design-forecast" aria-labelledby={`${id}-forecast-title`}>
    <header className="model-design-forecast-header"><div><span className="model-designer-eyebrow">Live forecast</span><h3 id={`${id}-forecast-title`}>{value.name.trim() || 'Your next model'}</h3></div><span className="model-design-family-tag">{prettyFamily(value.family)} · {billions(value.parameterMillions)}B</span></header>
    <p className="model-design-forecast-profile">{aiSystemName(value.system)} · {customizationOptionName('objective', customization.objective)} · {customizationOptionName('behavior', customization.behavior)}</p>
    {requiredResearch.length > 0 && <div className="model-design-research-needed"><LockKeyhole size={14} aria-hidden="true" /><div><strong>Research needed for this design</strong><DesignResearchRequirements game={game} ids={requiredResearch} /></div></div>}
    <p className="model-design-forecast-caption">{visiblePreview ? 'Expected skills after this training run, using the selected data.' : 'Choose prepared data to calculate expected skills.'}</p>
    <div className="model-design-forecast-legend"><span><i />Expected score</span><span><b />{value.mode === 'foundation' ? 'Reference model' : 'Starting score'}</span><span>0–100</span></div>
    <dl className="model-design-scores">
      {DOMAINS.map(domain => {
        const min = preview ? isCore(domain.id) ? preview.capabilityRange.minimum[domain.id] : preview.advancedCapabilityRange?.minimum[domain.id] ?? startingScore(base, domain.id) : 0;
        const max = preview ? isCore(domain.id) ? preview.capabilityRange.maximum[domain.id] : preview.advancedCapabilityRange?.maximum[domain.id] ?? min : 0;
        const start = startingScore(base, domain.id);
        return <div key={domain.id} className="model-design-score-row">
          <dt>{domain.label}</dt><dd><strong>{visiblePreview ? min === max ? score(min) : `${score(min)}–${score(max)}` : '—'}</strong>
            <div className="model-design-score-track" aria-hidden="true" style={{ '--reference-score': width(start), '--forecast-score': visiblePreview ? width(max) : '0%' } as CSSProperties}><i /><b /></div>
            <span className="visually-hidden">{visiblePreview ? ` out of 100. ${value.mode === 'foundation' ? 'Reference' : 'Starting'} score ${score(start)}.` : 'Waiting for prepared data.'}</span>
          </dd>
        </div>;
      })}
    </dl>
    <p className="model-design-help">{value.mode === 'foundation' ? 'A foundation creates a separate model lineage. Its marker compares the selected reference model.' : 'Further training starts from the selected version. Your data mix can improve one skill while leaving another behind.'} Run a paid evaluation to measure the finished version.</p>

    <section className="model-design-behavior" aria-labelledby={`${id}-behavior`}>
      <h4 id={`${id}-behavior`}>Reliability and responses</h4>
      <dl>{behaviorRows.map(row => <div key={row.label}>
        <dt>{row.label}{row.lower && <small>Lower is better</small>}</dt>
        <dd>{row.current !== undefined && <span>{score(row.current)}% <span aria-hidden="true">→</span><span className="visually-hidden"> to </span></span>}
          <b>{visiblePreview && row.minimum !== undefined && row.maximum !== undefined ? (row.minimum === row.maximum ? score(row.minimum) : `${score(row.minimum)}–${score(row.maximum)}`) + '%' : '—'}</b>
        </dd>
      </div>)}</dl>
      <p className="model-design-help">Projected tendencies after the paid run. Response training needs suitable behavior examples; a paid behavior test measures unfamiliar cases.</p>
    </section>

    {design.systemMetrics && <AISystemMetricsView metrics={visiblePreview ? getAISystemMetrics(getAISystemForecastModel(value, design, {
      capabilityBps: preview!.capabilityRange.minimum, advancedCapabilities: preview!.advancedCapabilityRange?.minimum, reliabilityBps: preview!.reliabilityRange.minimum,
    })) : design.systemMetrics} label={visiblePreview ? 'Expected operating performance' : 'Operating potential · data needed'} />}
    <DevelopmentGoalSummary game={game} projected model={visiblePreview ? getAISystemForecastModel(value, design, {
      capabilityBps: preview!.capabilityRange.minimum, advancedCapabilities: preview!.advancedCapabilityRange?.minimum, reliabilityBps: preview!.reliabilityRange.minimum,
    }) : undefined} />

    <dl className="model-design-costs">
      <div><dt>Setup fee</dt><dd>{formatMoney(design.feeCents)}</dd></div>
      <div><dt>Training compute</dt><dd>{formatUnits(design.workCUw)} <span>CUw</span></dd></div>
      <div><dt>Training memory</dt><dd>{formatUnits(design.requiredMemory)} <span>MU</span></dd></div>
      <div><dt>Deployed model memory</dt><dd>{formatUnits(design.residentMU)} <span>MU</span></dd></div>
      <div><dt>Architecture design</dt><dd>{formatWorkPoints(design.preparationStaff)} <span>Research points</span></dd></div>
      <div><dt>Serving vs family reference</dt><dd>{(design.servingWorkBps / 10000).toFixed(2)}<span>× compute</span></dd></div>
      <div><dt>Evidence target / skill</dt><dd>{formatUnits(design.requiredEvidence)} <span>matching units</span></dd></div>
      <div><dt>Distinct prepared data</dt><dd>{visiblePreview ? preview.corpus.distinctUnits.toLocaleString() : '—'} <span>units</span></dd></div>
      <div><dt>Nominal GPU training</dt><dd>{nominalWeeks === null ? 'No compute assigned' : `${nominalWeeks} ${nominalWeeks === 1 ? 'week' : 'weeks'}`}</dd></div>
    </dl>
    <p className="model-design-help">Evidence demand affects how much potential each skill earns. Sources count once. GPU time uses the current development allocation; staff, hardware and other jobs also affect completion.</p>
    {computeHint && <p className="model-design-compute-hint" role="status"><strong>Compute benefit check</strong>{computeHint}</p>}
    <div className="model-design-research-summary"><span>Architecture research <strong>Level {design.researchLevel}</strong></span><span>Design frontier rating <strong>{design.frontierRating.toLocaleString('en-US', { maximumFractionDigits: 1 })}</strong></span></div>
    <details className="model-design-details"><summary>Training plan and tradeoffs</summary>
      <ol className="model-design-timeline">
        <li><strong>Design</strong><span>{design.preparationStaff ? `${formatWorkPoints(design.preparationStaff)} Research points before GPU training.` : 'No architecture design work for this adaptation.'}</span></li>
        <li><strong>Train</strong><span>{nominalWeeks === null ? 'Assign development compute to begin GPU work.' : `${nominalWeeks} nominal ${nominalWeeks === 1 ? 'week' : 'weeks'} at ${formatUnits(allocation)} assigned development CU. Actual progress also depends on hardware, staff and other projects.`}</span></li>
        <li><strong>Evaluate</strong><span>Pay for capability and advanced skill tests on the completed version before judging its results.</span></li>
      </ol>
      {design.notes.length > 0 && <ul className="model-design-notes">{design.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    </details>
    {reason && <p className="model-design-warning" role="status"><strong>Before this run can start</strong>{humanizeDesignRequirement(reason.message)}</p>}
  </section>;
}
