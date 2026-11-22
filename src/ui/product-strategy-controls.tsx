'use client';

import { useState } from 'react';
import type { ProductAudience, RoutingPolicy } from '../contracts/strategic-variety';
import { PRODUCT_AUDIENCES, ROUTING_POLICIES } from '../content/strategic-variety';
import { CONTENT } from '../content/catalog';
import { formatUnits } from '../core/math';
import { activeEfficiency } from '../modules/product-efficiency';
import { audienceAcquisitionBps, productAudience, productRoutingPolicy } from '../modules/product-strategy';
import { productDemand, segmentForProduct, taskScore } from '../modules/products';
import { expectedProductBill } from '../modules/markets';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

const score = (value: number) => (value / 100).toLocaleString('en-US', { maximumFractionDigits: 1 });
const appeal = (bps: number) => bps === 10000 ? 'Neutral' : `${bps > 10000 ? '+' : ''}${score(bps - 10000)}%`;

/** One saved choice, with the real serving and acquisition calculations beside it. */
export function ProductStrategyControls({ game, canAct, onQueue, productId }: PanelProps & { productId: string }) {
  const product = game.slices.products.offers[productId];
  const [audience, setAudience] = useState<ProductAudience>(productAudience(product));
  const [routingPolicy, setRoutingPolicy] = useState<RoutingPolicy>(productRoutingPolicy(product));
  const routing = activeEfficiency(game, productId, 'routing');
  const plannedProduct = { ...product, strategy: { audience, routingPolicy, updatedWeek: game.week, commandId: product.strategy?.commandId ?? 'strategy-preview' } };
  const plannedState = { ...game, slices: { ...game.slices, products: { ...game.slices.products, offers: { ...game.slices.products.offers, [productId]: plannedProduct } } } };
  const current = productDemand(game, product, CONTENT, game.week);
  const forecast = productDemand(plannedState, plannedProduct, CONTENT, game.week);
  const segments = segmentForProduct(product.kind);
  const relevant = segments.find(segment => segment.id === 'professional') ?? segments[0];
  const currentScore = taskScore(current.model, relevant, current.features, current.documentBonusBps);
  const plannedScore = taskScore(forecast.model, relevant, forecast.features, forecast.documentBonusBps);
  const fulfillmentBps = game.slices.products.lastUsage[productId]?.fulfillmentBps ?? 10000;
  const changed = productAudience(product) !== audience || productRoutingPolicy(product) !== routingPolicy || !product.strategy;
  const pending = game.queuedCommands.some(command => command.companyId === game.playerCompanyId && command.payload.kind === 'set_product_strategy' && command.payload.productId === productId);
  return <section className="product-strategy-panel" aria-labelledby={productId + '-strategy-heading'}>
    <h3 id={productId + '-strategy-heading'}>Product strategy</h3>
    <p className="small-note">Choose who this offer is for and how to serve them. Apply once; the strategy continues each week.</p>
    <label className="line-control wide-select" htmlFor={productId + '-audience'}>Audience<select id={productId + '-audience'} value={audience} disabled={!canAct || pending} onChange={event => setAudience(event.target.value as ProductAudience)}>
      {(Object.keys(PRODUCT_AUDIENCES) as ProductAudience[]).map(id => <option key={id} value={id}>{PRODUCT_AUDIENCES[id].name}</option>)}
    </select></label>
    <p className="small-note">{PRODUCT_AUDIENCES[audience].description}</p>
    <label className="line-control wide-select" htmlFor={productId + '-serving-policy'}>Serving policy<select id={productId + '-serving-policy'} value={routingPolicy} disabled={!canAct || pending} onChange={event => setRoutingPolicy(event.target.value as RoutingPolicy)}>
      {(Object.keys(ROUTING_POLICIES) as RoutingPolicy[]).map(id => <option key={id} value={id} disabled={!routing && id !== 'balanced'}>{ROUTING_POLICIES[id].name}{!routing && id !== 'balanced' ? ' · requires two-model routing' : ''}</option>)}
    </select></label>
    <p className="small-note">{routing ? `${ROUTING_POLICIES[routingPolicy].description} Both models stay in memory.` : 'One model currently serves every request. Research R8 and install request routing in Serving efficiency to unlock Economy and Quality.'}</p>
    <Metrics>
      <Metric label="Serving work / 1,000 exchanges">{formatUnits(current.meter.work * 1000)}{forecast.meter.work !== current.meter.work ? ' → ' + formatUnits(forecast.meter.work * 1000) : ''} CUw</Metric>
      <Metric label="Relevant task quality">{score(currentScore)}{currentScore !== plannedScore ? ' → ' + score(plannedScore) : ''} / 100</Metric>
      <Metric label="Delivered model reliability">{score(current.model.reliabilityBps)}{current.model.reliabilityBps !== forecast.model.reliabilityBps ? ' → ' + score(forecast.model.reliabilityBps) : ''}%</Metric>
    </Metrics>
    <table className="compact-table"><caption>Audience appeal with this model, price and recent service</caption><thead><tr><th scope="col">Customer group</th><th scope="col">Positioning effect</th></tr></thead><tbody>{segments.map(segment => {
      const multiplier = audienceAcquisitionBps(plannedProduct, segment, {
        expectedBillCents: expectedProductBill(plannedProduct, forecast.contract.weeklyPriceCents, forecast.meter),
        taskScoreBps: taskScore(forecast.model, segment, forecast.features, forecast.documentBonusBps),
        reliabilityBps: forecast.model.reliabilityBps, fulfillmentBps,
      });
      return <tr key={segment.id}><th scope="row">{segment.name}</th><td>{appeal(multiplier)}</td></tr>;
    })}</tbody></table>
    <p className="small-note">Appeal adjusts trial competition and conversion. Eligibility, available customers and capacity still limit sales. Current subscription prices and signed customer agreements keep their recorded terms.</p>
    <ActionControl game={game} payload={{ kind: 'set_product_strategy', productId, audience, routingPolicy }} label="Apply product strategy" canAct={canAct} onQueue={onQueue} extraDisabled={!changed} />
  </section>;
}
