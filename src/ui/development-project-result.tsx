'use client';

import type { DevelopmentPlan } from '../contracts/development-plans';
import type { CommandPayload, GameState } from '../contracts/types';
import { ActionControl, Metric, Metrics } from './components';
import { useContinueTraining, useStudioTaskActions } from './studio-interaction-context';
import { DevelopmentGoalSummary } from './development-workspace';
import { ModelProfile } from './model-profile';

/** Every next action uses this project's saved model and objective, never the
 * currently edited workbench goal. No commercial commitment is automatic. */
export function DevelopmentProjectResult({ plan, game, canAct, onQueue }: {
  plan: DevelopmentPlan; game: GameState; canAct: boolean; onQueue: (payload: CommandPayload) => void;
}) {
  const actions = useStudioTaskActions(), improve = useContinueTraining();
  const report = plan.reportId ? game.slices.models.reports[plan.reportId] : undefined;
  if (!report) return null;
  const challenge = plan.challengeReportId ? game.slices.models.reports[plan.challengeReportId] : undefined;
  const objective = plan.objective, model = game.slices.models.versions[report.modelId];
  const result = challenge ?? report;
  const purposeDestination = objective?.kind === 'purpose' && objective.id === 'coding' ? '#developer-api'
    : objective?.kind === 'purpose' && ['analyst', 'visual'].includes(objective.id) ? '#business-commitments' : null;
  return <>
    <div className="development-result"><h4>{model?.name}</h4>
      <p>{report.passedCases} / {report.cases.length} held-out cases passed · Reliability {(report.reliabilityBps / 100).toFixed(1)}%.</p>
      {challenge && <p><strong>{challenge.challenge?.passed ? 'Paid systems challenge passed' : 'Paid systems challenge needs improvement'}</strong> · {challenge.passedCases} / {challenge.cases.length} operating workloads passed.</p>}
      {report.advancedCapabilities && <Metrics>{Object.entries(report.advancedCapabilities).map(([skill, value]) => <Metric key={skill} label={skill === 'longContext' ? 'Long context' : skill === 'multimodal' ? 'Multimodal' : 'Reasoning'}>{(value / 100).toFixed(1)}%</Metric>)}</Metrics>}
      {report.outcomes && <Metrics><Metric label="Useful answers">{report.outcomes.usefulAnswers}</Metric><Metric label="Confident errors">{report.outcomes.confidentErrors}</Metric><Metric label="Unnecessary refusals">{report.outcomes.falseRefusals}</Metric></Metrics>}
      <div className="strategy-actions">
        {actions?.reviewReport ? <button type="button" onClick={() => actions.reviewReport?.(result.id)}>Review model and report</button> : <a href="#models">Review model and report</a>}
        {objective?.kind === 'renewable-brief' ? <ActionControl game={game} payload={{ kind: 'accept_systems_brief', offerId: objective.terms.id, terms: objective.terms, modelId: report.modelId }}
          label={`Deliver to ${objective.terms.client}`} canAct={canAct} onQueue={onQueue} compact />
          : objective?.kind === 'system-challenge' ? <a href="#model-challenges">View earned challenge evidence</a>
          : purposeDestination ? actions?.openProductForModel ? <button type="button" onClick={() => actions.openProductForModel?.(purposeDestination === '#developer-api' ? 'developer-api' : 'business-docs', report.modelId, report.id)}>{purposeDestination === '#developer-api' ? 'Plan the developer release' : 'Review business delivery options'}</button>
            : <a href={purposeDestination}>{purposeDestination === '#developer-api' ? 'Plan the developer release' : 'Review business delivery options'}</a>
          : report.basicChatEligible && actions ? <button type="button" onClick={() => actions.launchBasicChat(report.modelId, report.id)}>Choose a release</button>
          : report.basicChatEligible ? <a href="#product">Choose a release</a> : null}
        {improve ? <button type="button" onClick={() => improve(report.modelId)}>Plan an improvement</button> : <a href="#lab-projects">Plan an improvement</a>}
      </div>
    </div>
    {model && <><ModelProfile model={model} compact /><DevelopmentGoalSummary game={game} goal={objective ?? null} model={model} /></>}
  </>;
}
