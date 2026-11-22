'use client';

import { useId, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import type { CommandPayload, GameState } from '../contracts/types';
import { SYSTEMS_BRIEFS, SYSTEMS_BRIEF_WINDOW_WEEKS } from '../content/systems-briefs';
import { getSystemsBriefOffers, getSystemsBriefOrders, systemsBriefRequirements, systemsBriefWorkRequest } from '../modules/systems-briefs';
import { getSystemsModelMeasures } from '../modules/model-challenges';
import { formatMoney, formatUnits } from '../core/math';
import { ActionControl, Metric, Metrics } from './components';
import { DevelopForGoalButton } from './development-workspace';
import { useStudioTaskActions } from './studio-interaction-context';

export function SystemsBriefsPanel({ game, canAct, onQueue }: { game: GameState; canAct: boolean; onQueue: (payload: CommandPayload) => void }) {
  const id = useId(), actions = useStudioTaskActions();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const models = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId && !model.scenarioStart)
    .sort((a, b) => (b.createdWeek ?? 0) - (a.createdWeek ?? 0) || a.id.localeCompare(b.id));
  const offers = getSystemsBriefOffers(game), orders = getSystemsBriefOrders(game);
  const active = orders.find(order => order.status === 'active');
  const history = orders.filter(order => order !== active);
  const request = active ? systemsBriefWorkRequest(game, active) : null;
  return <section className="systems-briefs" aria-label="Renewable customer briefs">
    <header className="systems-section-heading"><RefreshCw size={20} aria-hidden="true" /><div><h3>Renewable customer briefs</h3><p>New clients every {SYSTEMS_BRIEF_WINDOW_WEEKS} weeks. Choose one commission per window and deliver two consecutive service weeks. Different customers reward different operating designs.</p></div></header>
    <p className="systems-window"><CalendarDays size={16} aria-hidden="true" />Accept by Week {offers[0]?.acceptUntilWeek ?? '—'} · next offers Week {offers[0]?.nextOpensWeek ?? '—'}.</p>
    {active && <article className="systems-active-order" aria-label="Active systems commission">
      <div className="project-heading"><h4>{SYSTEMS_BRIEFS.find(item => item.id === active.briefId)?.title}</h4><strong>Due Week {active.deadlineWeek}</strong></div>
      <p>{active.terms.client} · {formatMoney(active.terms.feeCents)} on delivery · {game.slices.models.versions[active.modelId]?.name ?? 'Saved model'}</p>
      <progress value={active.qualifyingWeeks} max={active.terms.qualifyingWeeks} aria-label="Systems commission consecutive delivery weeks" />
      <p>{active.qualifyingWeeks} / {active.terms.qualifyingWeeks} consecutive service weeks</p>
      <p role="status" className="small-note">{active.feedback}</p>
      {request && <Metrics><Metric label="Client serving work">{formatUnits(request.normalizedWorkCUw)} CUw / week</Metric><Metric label="Model and sessions">{formatUnits(request.memoryMU)} MU</Metric><Metric label="Requests each week">{active.terms.requestsPerWeek.toLocaleString()}</Metric></Metrics>}
      <div className="systems-offer-actions"><a href="#compute">Reserve serving capacity</a>{actions?.reviewReport && <button type="button" className="training-text-action" onClick={() => actions.reviewReport?.(active.reportId)}>Inspect accepted model evidence</button>}</div>
      <p className="small-note">This capacity is needed alongside your existing products. Payment arrives after successful delivery; missed deadlines do not pay.</p>
    </article>}
    <div className="systems-offer-grid">{offers.map(offer => {
      const selectedId = selections[offer.briefId] ?? offer.candidateModelId ?? models[0]?.id;
      const model = models.find(item => item.id === selectedId);
      const missing = model ? systemsBriefRequirements(model, offer) : [];
      const measures = model ? getSystemsModelMeasures(model) : null;
      return <article key={offer.id} className="systems-offer-card" aria-label={offer.title}>
        <div className="project-heading"><h4>{offer.title}</h4><strong>{formatMoney(offer.feeCents)}</strong></div><p className="systems-client">{offer.client}</p><p>{offer.description}</p>
        <ul className="systems-offer-requirements">{offer.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul>
        <label htmlFor={id + '-' + offer.briefId}>Delivery model<select id={id + '-' + offer.briefId} value={model?.id ?? ''} disabled={!canAct || !models.length} onChange={event => setSelections(current => ({ ...current, [offer.briefId]: event.target.value }))}>
          {!model && <option value="">Choose an owned model</option>}{models.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select></label>
        {model && <p className="systems-candidate" data-ready={!missing.length}>{missing.length ? `${model.name} still needs ${missing.join(', ')}.` : `${model.name} meets the operating thresholds. Its paid challenge evidence and rights are checked before acceptance.`}</p>}
        {measures && <p className="small-note">Client load: {formatUnits(Math.ceil(measures.servingCUwPer1000 * offer.requestsPerWeek / 1000))} serving CUw / week · {formatUnits(measures.residentMU + measures.sessionMemoryMU * offer.concurrentSessions)} MU · {offer.requestsPerWeek.toLocaleString()} requests / week.</p>}
        {offer.missing && <p className="small-note">{offer.missing}</p>}
        <div className="systems-offer-actions"><DevelopForGoalButton goal={{ kind: 'renewable-brief', id: offer.briefId }} canAct={canAct} /><a href="#model-challenges">View systems challenges</a></div>
        <ActionControl game={game} payload={model ? { kind: 'accept_systems_brief', offerId: offer.id, modelId: model.id } : null} label={'Accept ' + offer.title.toLowerCase()} canAct={canAct} onQueue={onQueue} emptyReason="Choose an owned delivery model." compact />
      </article>;
    })}</div>
    {history.length > 0 && <details className="inline-details"><summary>Systems delivery history · {history.length}</summary><ul className="systems-delivery-history">{history.map(order => <li key={order.id}><strong>{order.terms.client}</strong><span>{SYSTEMS_BRIEFS.find(item => item.id === order.briefId)?.title} · Week {order.finishedWeek} · {order.status === 'completed' ? formatMoney(order.terms.feeCents) + ' earned' : 'Expired without payment'}</span><p>{order.feedback}</p></li>)}</ul></details>}
  </section>;
}
