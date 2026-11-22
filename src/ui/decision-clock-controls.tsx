import type { GameState } from '../contracts/types';
import type { DecisionClockPolicy, DecisionStop } from '../core/decision-clock';
import { decisionRunPreview } from '../core/decision-clock';

export function DecisionClockControls({ game, policy, active, canAct, stop, onStart, onChange }: {
  game: GameState; policy: DecisionClockPolicy; active: boolean; canAct: boolean; stop: DecisionStop | null;
  onStart: () => void; onChange: (policy: DecisionClockPolicy) => void;
}) {
  return <div className="decision-clock-controls" aria-label="Advance to a decision">
    <button type="button" className="decision-clock-start" disabled={!canAct} onClick={onStart}>{active ? 'Pause decision run' : 'Next decision'}</button>
    <span className="decision-clock-summary">{active ? 'Watching for your next decision' : `Up to ${policy.maxWeeks} weeks · $${(policy.cashReserveCents / 100).toLocaleString()} reserve`}</span>
    <details className="decision-clock-options"><summary>Stop rules</summary><div className="decision-clock-settings">
      <p>{decisionRunPreview(game, policy)}</p>
      <div className="decision-clock-limits"><label>Keep cash reserve ($)<input type="number" min="0" max="1000000000" step="100" value={policy.cashReserveCents / 100} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= 1e9) onChange({ ...policy, cashReserveCents: Math.round(value * 100) }); }} /></label>
        <label>Maximum weeks<select value={policy.maxWeeks} onChange={e => onChange({ ...policy, maxWeeks: Number(e.target.value) })}>{[4, 12, 24, 52].map(n => <option key={n} value={n}>{n} weeks</option>)}</select></label></div>
      {([['projects','Data, training or evaluation finishes'],['research','Research becomes available'],['deadlines','A customer or project deadline approaches'],['opportunities','A market or customer window changes'],['service','Paid service falls below 95%']] as const).map(([key,label]) => <label className="decision-clock-rule" key={key}><input type="checkbox" checked={policy[key]} onChange={e => onChange({ ...policy, [key]: e.target.checked })} />{label}</label>)}
      <p className="small-note">The cash guard checks queued fees and known weekly bills before advancing. Metered work can add costs. A blocked delegated plan or finished customer commission always pauses for review.</p>
    </div></details>
    {stop && <a className="decision-clock-result" href={stop.target}>Review decision</a>}
  </div>;
}
