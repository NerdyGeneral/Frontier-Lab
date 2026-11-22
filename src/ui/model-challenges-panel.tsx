'use client';

import { useId, useState } from 'react';
import type { EvaluationReport, ModelVersion } from '../contracts/types';
import { CHALLENGE_SKILLS, CHALLENGE_SKILL_NAMES, MODEL_CHALLENGES, modelChallengeDefinition } from '../content/model-challenges';
import type { SystemsChallengeSuiteId } from '../contracts/model-challenges';
import { getModelChallengeAchievements, getModelChallengeCaseViews, validateModelChallengeAdmission } from '../modules/model-challenges';
import { getAISystemMetrics } from '../modules/ai-systems';
import { formatUnits } from '../core/math';
import { formatWorkPoints } from '../modules/workforce-points';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';
import { AISystemMetricsView, aiSystemName } from './ai-system-designer';
import { DevelopForGoalButton } from './development-workspace';

export function ModelChallengeReportDetails({ report, model }: { report: EvaluationReport; model: ModelVersion }) {
  const tier = modelChallengeDefinition(report.suiteId), receipt = report.challenge;
  if (!tier || !receipt) return null;
  const checks = getModelChallengeCaseViews(model, tier.id);
  return <section className="model-challenge-report" aria-label={tier.name + ' result'}>
    <h3>{receipt.passed ? `Achievement earned: ${receipt.earnedTitle}` : `${tier.name}: target not reached`}</h3>
    <p className="small-note">{receipt.passedCases} / {receipt.totalCases} cases passed. The title requires at least {receipt.requiredPasses} passes overall{tier.format ? ', including the operating limit in each passed workload' : ` and ${receipt.minimumPassesPerSkill} of 3 in every skill`}. Earned titles remain in this campaign’s save.</p>
    {!tier.format && <Metrics>{CHALLENGE_SKILLS.map(domain => <Metric key={domain} label={CHALLENGE_SKILL_NAMES[domain]}>{receipt.skills[domain].passed} / {receipt.skills[domain].total}</Metric>)}</Metrics>}
    <details className="inline-details"><summary>Challenge tasks and exact requirements</summary>
      <p className="small-note">Every case combines 70% of its main skill and 30% of its supporting skill, then checks execution reliability{tier.format ? ' and the stated operating constraint' : ''}. These are fixed game-authored tasks. Renaming or retesting unchanged ability cannot reroll them.</p>
      <ol className="case-list">{report.cases.map((item, index) => {
        const task = checks[index];
        return <li key={item.id}><div><strong>{task.title}</strong><p className="small-note">Required: {task.requirementText}.</p><p className="small-note">Measured: {task.measurementText}.</p></div><span>{item.passed ? 'Passed' : 'Failed'}</span></li>;
      })}</ol>
    </details>
  </section>;
}

export function ModelChallengesPanel({ game, canAct, onQueue }: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'>) {
  const id = useId().replaceAll(':', ''), owner = game.playerCompanyId;
  const models = Object.values(game.slices.models.versions).filter(model => model.companyId === owner).sort((a, b) => (b.createdWeek ?? 0) - (a.createdWeek ?? 0) || a.id.localeCompare(b.id));
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [collection, setCollection] = useState<'all' | 'systems' | 'skills'>('all');
  const selected = models.find(model => model.id === modelId) ?? models[0];
  const achievements = getModelChallengeAchievements(game, owner);
  return <Section title="Research challenges & achievements" id="model-challenges">
    <p className="small-note">Choose four systems challenges with practical cost, memory, retention and verification limits, or three harder combined-skill tiers. Tests use development compute and Research points. They measure your saved model and earn a lasting title; they never add skill points or replace its release test.</p>
    <div className="model-achievement-shelf" aria-label="Earned challenge titles">
      {achievements.length ? <ul>{achievements.map(achievement => <li key={achievement.tierId}><strong>{achievement.title}</strong> · Week {achievement.week} · {game.slices.models.versions[achievement.modelId]?.name ?? 'Saved model'}</li>)}</ul>
        : <p className="small-note">No titles earned yet. Start with the Applied challenge after a paid capability test.</p>}
    </div>
    <label className="line-control wide-select" htmlFor={'challenge-model-' + id}>Challenge model<select id={'challenge-model-' + id} value={selected?.id ?? ''} disabled={!canAct || !models.length} onChange={event => setModelId(event.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    {selected && <details className="inline-details"><summary>{selected.name} · {aiSystemName(selected.modelDesign?.spec.system)} · operating profile</summary><AISystemMetricsView metrics={getAISystemMetrics(selected)} label="Saved model performance" /></details>}
    <div className="systems-challenge-filter" role="group" aria-label="Challenge collection">
      {([{ id: 'all', name: 'All challenges', count: 7 }, { id: 'systems', name: 'Systems workloads', count: 4 }, { id: 'skills', name: 'Skill progression', count: 3 }] as const).map(item => <button type="button" key={item.id} aria-pressed={collection === item.id} onClick={() => setCollection(item.id)}>{item.name}<span>{item.count}</span></button>)}
    </div>
    {[...MODEL_CHALLENGES.filter(tier => tier.format), ...MODEL_CHALLENGES.filter(tier => !tier.format)].filter(tier => collection === 'all' || (collection === 'systems' ? tier.format : !tier.format)).map(tier => {
      const report = Object.values(game.slices.models.reports).find(item => item.companyId === owner && item.modelId === selected?.id && item.suiteId === tier.id);
      const run = Object.values(game.slices.models.evaluationRuns).find(item => item.companyId === owner && item.modelId === selected?.id && item.suiteId === tier.id && item.status !== 'complete');
      const reason = selected ? validateModelChallengeAdmission(game, owner, selected.id, tier.id)?.message : 'Choose an owned model.';
      const earned = achievements.find(item => item.tierId === tier.tierId);
      const checks = selected ? getModelChallengeCaseViews(selected, tier.id) : [];
      return <article key={tier.id} className="project-row model-challenge-card" aria-label={tier.name}>
        <div className="project-heading"><h3>{tier.name}</h3><span>{earned ? `${tier.title} earned` : tier.title}</span></div>
        <p className="small-note">{tier.description}</p>
        <Metrics><Metric label="Development compute">{formatUnits(tier.workCUw)} CUw</Metric><Metric label="Research points">{formatWorkPoints(tier.researchStaff)}</Metric>{tier.format ? <Metric label="Required workloads">{tier.requiredPasses} / {tier.cases}</Metric> : <><Metric label="Combined skill checks">{tier.difficulty.map(value => value / 100).join(' / ')}</Metric><Metric label="Reliability checks">{tier.reliability.map(value => value / 100).join(' / ')}%</Metric></>}</Metrics>
        {tier.format && <><DevelopForGoalButton canAct={canAct} goal={{ kind: 'system-challenge', id: tier.id as SystemsChallengeSuiteId }} />{!report && checks.length > 0 && <details className="inline-details"><summary>Requirements · {checks.filter(item => item.passed).length} / {checks.length} met by {selected?.name}</summary><ol className="systems-case-preview">{checks.map((check, index) => <li key={index} data-met={check.passed}><strong>{check.title}</strong><p>Required: {check.requirementText}.</p><p>Current model: {check.measurementText}.</p><span>{check.passed ? 'Meets this workload' : 'Needs improvement'}</span></li>)}</ol><p className="small-note">This planning comparison does not award evidence. Run the paid challenge to earn a report.</p></details>}</>}
        {report && selected ? <ModelChallengeReportDetails report={report} model={selected} /> : run ? <>
          <p className="small-note">{run.status === 'paused' ? 'Paused' : 'Evaluation in progress'} · {formatUnits(run.completedWork)} / {formatUnits(run.requiredWork)} CUw · {formatWorkPoints(run.completedStaff)} / {formatWorkPoints(run.requiredStaff)} Research points.</p>
          {run.lastBottleneck && <p className="bottleneck">{run.lastBottleneck}</p>}
          <ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: run.id, paused: run.status !== 'paused' }} label={run.status === 'paused' ? 'Resume challenge' : 'Pause challenge'} canAct={canAct} onQueue={onQueue} compact />
        </> : <>
          {reason && <p className="bottleneck">{reason}</p>}
          <ActionControl game={game} payload={selected ? { kind: 'evaluate_model', modelId: selected.id, suiteId: tier.id } : null} label={'Run ' + tier.name.toLowerCase()} canAct={canAct} onQueue={onQueue} taskAction="evaluate-model" emptyReason="Choose an owned model." />
        </>}
      </article>;
    })}
    <p className="small-note">One paid report per model and tier. Improve the model before attempting a failed tier again. Titles persist when you train another model, export the save, or reload this campaign.</p>
  </Section>;
}
