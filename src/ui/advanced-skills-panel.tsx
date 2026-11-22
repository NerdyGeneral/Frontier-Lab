import type { EvaluationReport, ModelVersion } from '../contracts/types';
import type { AdvancedScores } from '../contracts/advanced-skills';
import { ADVANCED_DOMAINS, ADVANCED_EVALUATION_SUITE, ADVANCED_SKILL_DESCRIPTIONS, ADVANCED_SKILL_LABELS } from '../content/advanced-skills';
import { advancedScores } from '../modules/advanced-skills';

export interface AdvancedSkillsPanelProps {
  model: ModelVersion;
  report?: EvaluationReport | null;
  baseline?: ModelVersion;
  forecast?: { minimum: AdvancedScores; maximum: AdvancedScores };
  title?: string;
}

const score = (value: number) => Number((value / 100).toFixed(1));

/** Separate earned scores and held-out results so a forecast never looks like a completed test. */
export function AdvancedSkillsPanel({ model, report, baseline, forecast, title = 'Advanced capabilities' }: AdvancedSkillsPanelProps) {
  const current = advancedScores(model), before = baseline ? advancedScores(baseline) : null;
  const tested = report?.suiteId === ADVANCED_EVALUATION_SUITE.id && report.modelId === model.id ? report : null;
  return <section className="advanced-skills-panel" aria-label={title}>
    <h3>{title}</h3>
    <p className="small-note">{forecast ? 'Expected training results. Prepare relevant data and complete the run to earn these skills.'
      : model.advancedCapabilities ? 'Skills earned by this saved model. A held-out test measures how it handles unfamiliar examples.'
      : 'This model has no advanced training yet. Design a model with reasoning, long-context or multimodal data to develop these skills.'}</p>
    <div className="advanced-skill-readings">
      {ADVANCED_DOMAINS.map(domain => {
        const minimum = forecast?.minimum[domain] ?? current[domain], maximum = forecast?.maximum[domain] ?? minimum;
        const cases = tested?.cases.filter(item => item.domain === domain);
        const change = before ? current[domain] - before[domain] : null;
        return <div className="advanced-skill-reading" key={domain}>
          <div className="asset-summary"><strong>{ADVANCED_SKILL_LABELS[domain]}</strong><span>{score(minimum)}{maximum !== minimum ? `–${score(maximum)}` : ''} / 100</span></div>
          <progress value={minimum} max={10000} aria-label={`${ADVANCED_SKILL_LABELS[domain]} ${forecast ? 'forecast' : 'score'}`} style={{ width: '100%', accentColor: 'var(--accent, #55c49d)' }} />
          <p className="small-note">{ADVANCED_SKILL_DESCRIPTIONS[domain]}{change !== null && change !== 0 ? ` ${change > 0 ? '+' : ''}${score(change)} since the selected parent.` : ''}</p>
          {cases && <p className="small-note"><strong>{cases.filter(item => item.passed).length} / {cases.length} held-out cases passed</strong> · Week {tested!.week}</p>}
        </div>;
      })}
    </div>
    {!forecast && !tested && <p className="small-note">Run “Reasoning, context &amp; multimodal” in Evaluate for an independent result on each skill.</p>}
  </section>;
}
