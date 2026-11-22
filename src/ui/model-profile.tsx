import type { ModelVersion } from '../contracts/types';
import { formatUnits } from '../core/math';
import { AISystemMetricsView, aiSystemName, aiSystemChoiceSummary } from './ai-system-designer';
import { getAISystemMetrics } from '../modules/ai-systems';
import { customizationOptionName } from './model-design-draft';

const SKILL_NAMES = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use',
  reasoning: 'Reasoning', longContext: 'Long context', multimodal: 'Multimodal' };

export function modelProfileLabel(model: ModelVersion): string {
  const choices = model.modelDesign?.spec.customization;
  return choices ? [customizationOptionName('objective', choices.objective), customizationOptionName('behavior', choices.behavior)].join(' · ')
    : model.modelDesign ? 'Custom design' : 'Standard training';
}

/** Render saved choices directly. Later research never rewrites this profile. */
export function ModelProfile({ model, compact = false }: { model: ModelVersion; compact?: boolean }) {
  const receipt = model.modelDesign;
  if (!receipt) return null;
  const { spec } = receipt, choices = spec.customization;
  return <section className={'model-profile' + (compact ? ' model-profile-compact' : '')} aria-label={'Model profile for ' + model.name}>
    <header><h3>Model profile</h3><span>{spec.mode === 'foundation' ? 'Foundation design' : 'Adaptation design'}</span></header>
    <p className="model-profile-purpose">{modelProfileLabel(model)}</p>
    {spec.system && <p className="model-profile-note">{aiSystemChoiceSummary(spec.system)}</p>}
    <dl className="model-profile-grid">
      <div><dt>Operating design</dt><dd>{aiSystemName(spec.system)}</dd></div>
      <div><dt>Size</dt><dd>{(spec.parameterMillions / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })}B parameters</dd></div>
      <div><dt>Sparsity</dt><dd>{spec.sparsityBps / 100}% inactive per token</dd></div>
      {choices && <>
        <div><dt>Attention</dt><dd>{customizationOptionName('attention', choices.attention)}</dd></div>
        <div><dt>Context capacity</dt><dd>{customizationOptionName('contextWindow', choices.contextWindow)}</dd></div>
        <div><dt>Weight precision</dt><dd>{customizationOptionName('precision', choices.precision)}</dd></div>
        <div><dt>Training focus</dt><dd>{customizationOptionName('objective', choices.objective)}</dd></div>
        <div><dt>Response style</dt><dd>{customizationOptionName('behavior', choices.behavior)}</dd></div>
      </>}
      <div><dt>Model memory</dt><dd>{formatUnits(model.residentMU)} MU</dd></div>
      <div><dt>Design run budget</dt><dd>{formatUnits(spec.computeBudgetCUw)} CUw</dd></div>
    </dl>
    {spec.system && <AISystemMetricsView metrics={getAISystemMetrics(model)} label="Saved operating profile" />}
    {!compact && <>
      <p className="model-profile-mix"><strong>Training priorities</strong> {Object.entries(spec.dataMix).filter(([, weight]) => weight > 0)
        .map(([domain, weight]) => SKILL_NAMES[domain as keyof typeof SKILL_NAMES] + ' ' + weight).join(' · ')}. Relative weights.</p>
      <p className="model-profile-note">Architecture research level {receipt.researchLevel} · Design frontier rating {receipt.frontierRating.toLocaleString()}.
        {' '}These choices were saved with the design run and inherited by later versions. Skill scores and paid tests show what this version can do.</p>
    </>}
  </section>;
}
