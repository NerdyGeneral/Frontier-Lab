import type { EvaluationReport } from '../contracts/types';
import { AGENT_ORDERS } from '../content/wave3-agents';
import { Metric, Metrics } from './components';

const OUTCOMES = { useful: 'Correct', 'confident-error': 'Confident error', 'false-refusal': 'False refusal', clarification: 'Clarification' };
const fraction = (numerator: number, denominator: number) => denominator ? `${numerator} / ${denominator}` : 'No applicable cases';

export function IndependentHoldoutDetails({ report }: { report: EvaluationReport }) {
  if (!report.holdout) return null;
  const totals = report.holdout.totals;
  const rows = [
    { label: 'Model claims', accepted: totals.claimedCompletions, falseAccepts: totals.claimedCompletions - totals.actualSuccesses },
    { label: 'Basic checker', accepted: totals.basicAccepted, falseAccepts: totals.basicFalseAccepts },
    { label: 'Independent checker', accepted: totals.independentAccepted, falseAccepts: totals.independentFalseAccepts },
  ];
  return <div className="evaluation-report">
    <p className="small-heading">Independent test report · Week {report.week}</p>
    <Metrics>
      <Metric label="Actually correct">{totals.actualSuccesses} / {totals.cases}</Metric>
      <Metric label="Claimed complete">{totals.claimedCompletions} / {totals.cases}</Metric>
      <Metric label="Unsuccessful cases">{totals.unsuccessfulCases} / {totals.cases}</Metric>
    </Metrics>
    <div className="table-scroll"><table className="compact-table">
      <caption>Same model and test cases · what the checkers accepted versus what was correct</caption>
      <thead><tr><th>Decision</th><th>Accepted</th><th>Incorrect among accepted</th><th>Failures accepted</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.accepted}</td>
        <td>{fraction(row.falseAccepts, row.accepted)}</td><td>{fraction(row.falseAccepts, totals.unsuccessfulCases)}</td></tr>)}</tbody>
    </table></div>
    <p className="small-note">“Accepted” means the model or checker said the task was complete. “Incorrect among accepted” shows how often those approvals were wrong. “Failures accepted” shows how many failed tasks slipped through. Even the independent checker can miss a confident mistake.</p>
    <Metrics>
      <Metric label="Necessary read-tool calls">{totals.necessaryLookups}</Metric>
      <Metric label="Planned read-tool calls">{totals.plannedLookups}</Metric>
      <Metric label="Avoidable repeat lookups">{totals.repeatedLookups}</Metric>
      <Metric label="Out-of-scope proposals">{totals.outOfScopeProposals}</Metric>
    </Metrics>
    <p className="small-note">Each case gets one attempt with set limits. Repeated lookups would cost extra compute, and actions outside the allowed scope would be blocked. Compare models here before choosing an agent’s checker and compute budget.</p>
    <details className="inline-details"><summary>Reserved case outcomes · {totals.cases}</summary>
      <div className="table-scroll"><table className="compact-table"><thead><tr><th>Case / task</th><th>Outcome</th><th>Claim</th><th>Basic</th><th>Independent</th><th>Repeats</th><th>Outside scope</th></tr></thead>
        <tbody>{report.cases.map((item, index) => {
          const entry = item.holdout!;
          return <tr key={item.id}><td>{index + 1}<span className="table-subline">{AGENT_ORDERS.find(order => order.id === entry.templateId)?.name ?? entry.templateId}</span></td>
            <td>{OUTCOMES[entry.outcome]}</td><td>{entry.claimedComplete ? 'Complete' : 'Incomplete'}</td>
            <td>{entry.basicAccepted ? 'Accept' : 'Reject'}</td><td>{entry.independentAccepted ? 'Accept' : 'Reject'}</td>
            <td>{entry.repeatedLookups}</td><td>{entry.outOfScopeProposals}</td></tr>;
        })}</tbody></table></div>
    </details>
    <p className="small-note">Every model faces the same 100 test cases, kept out of training. Results show how this version performed on those cases; future orders may differ. The test costs 4 development CUw and 20 Research points. It only measures performance: it does not improve the model or checker, unlock products, carry out customer work, or earn revenue.</p>
  </div>;
}
