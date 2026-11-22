'use client';

import { useState } from 'react';
import type { GameState, ProductKind, ProductOffer } from '../contracts/types';
import { PRODUCT_WORKLOAD_IDS, type ProductWorkloadId } from '../contracts/product-workloads';
import { PRODUCT_KIND_LIMIT, PRODUCT_PORTFOLIO_LIMIT, PRODUCT_WORKLOADS } from '../content/product-workloads';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { formatUnits } from '../core/math';
import { activePortfolio, createProductWorkloadReceipt, getProductWorkloadMeasure, productWorkloadExplanation } from '../modules/product-workloads';
import { getProductDemandAccess } from '../modules/markets';
import { productWorkloadMeasure } from '../modules/products';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

export function ProductPortfolioPicker({ game, kind, value, onChange }: { game: GameState; kind: ProductKind; value: string; onChange: (value: string) => void }) {
  if (!hasConnectedCompanyRules(game.contentVersion)) return null;
  const products = Object.values(game.slices.products.offers).filter(product => product.companyId === game.playerCompanyId && product.kind === kind);
  const live = activePortfolio(game, game.playerCompanyId);
  const full = live.length >= PRODUCT_PORTFOLIO_LIMIT || live.filter(product => product.kind === kind).length >= PRODUCT_KIND_LIMIT;
  return <div className="product-portfolio-picker">
    <label className="line-control wide-select" htmlFor={kind + '-portfolio'}>Choose an offer<select id={kind + '-portfolio'} value={value} onChange={event => onChange(event.target.value)}>
      {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.retiredWeek !== undefined ? 'Retired archive' : product.status}</option>)}
      <option value="new" disabled={full}>+ Create another offer{full ? ' · portfolio full' : ''}</option>
    </select></label>
    <p className="small-note">{live.length}/{PRODUCT_PORTFOLIO_LIMIT} public offers · at most {PRODUCT_KIND_LIMIT} of each kind. Offers share customers, commercial staff and compute. Overlapping offers divide your company’s existing reach.</p>
  </div>;
}

export function ProductWorkloadPicker({ game, value, onChange, modelId, product, id, disabled = false }: {
  game: GameState; value: ProductWorkloadId; onChange: (id: ProductWorkloadId) => void; modelId?: string; product?: ProductOffer; id: string; disabled?: boolean;
}) {
  if (!hasConnectedCompanyRules(game.contentVersion)) return null;
  const model = modelId ? game.slices.models.versions[modelId] : undefined;
  const proposed = createProductWorkloadReceipt(value, game.week + 1);
  const measured = product ? productWorkloadMeasure(game, { ...product, workload: proposed }) : model ? getProductWorkloadMeasure(model, proposed) : undefined;
  return <div className="product-workload-choice">
    <label className="line-control wide-select" htmlFor={id}>Customer workload<select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value as ProductWorkloadId)}>
      {PRODUCT_WORKLOAD_IDS.map(workload => <option key={workload} value={workload}>{PRODUCT_WORKLOADS[workload].name}</option>)}
    </select></label>
    <p className="small-note">{PRODUCT_WORKLOADS[value].description} {PRODUCT_WORKLOADS[value].promise}</p>
    {measured && value !== 'general' && <Metrics>
      <Metric label="Operating fit">{(measured.fitBps / 100).toFixed(1)}%</Metric>
      {value === 'continuity' && <Metric label="Facts retained">{(measured.retentionBps / 100).toFixed(1)}%</Metric>}
      {value === 'verified' && <Metric label="Verified completion">{(measured.verifiedCompletionBps / 100).toFixed(1)}%</Metric>}
      {value === 'responsive' && <Metric label="Expert routing quality">{(measured.routingQualityBps / 100).toFixed(1)}%</Metric>}
      <Metric label="Response time">{(measured.latencyBps / 10000).toFixed(2)}×</Metric>
      <Metric label="Model plus 25 sessions">{formatUnits(measured.memoryMU)} MU</Metric>
    </Metrics>}
  </div>;
}

export function ProductWorkloadControls(props: PanelProps & { product: ProductOffer }) {
  const { game, canAct, onQueue, product } = props;
  const [name, setName] = useState(product.name), [workload, setWorkload] = useState<ProductWorkloadId>(product.workload?.id ?? 'general');
  if (!hasConnectedCompanyRules(game.contentVersion) || product.retiredWeek !== undefined) return null;
  const modelId = game.slices.products.deployments[product.deploymentId].modelId;
  const measured = productWorkloadMeasure(game, product);
  const access = getProductDemandAccess(game, product);
  const unchanged = name.trim() === product.name && workload === product.workload?.id;
  return <section aria-label="Offer identity and customer needs">
    <h4>Offer and customer needs</h4>
    <p className="small-note">{productWorkloadExplanation(measured)}</p>
    {access.totalBps > 10000 && <p className="small-note">Earned demand access: +{((access.totalBps - 10000) / 100).toFixed(1)}% acquisition weight from client relationships, completed research programs or this campaign’s market. This competes for existing customers; it never creates free accounts.</p>}
    <label className="line-control" htmlFor={product.id + '-name'}>Offer name<input id={product.id + '-name'} value={name} maxLength={48} disabled={!canAct || product.status === 'deploying'} onChange={event => setName(event.target.value)} /></label>
    <ProductWorkloadPicker game={game} value={workload} onChange={setWorkload} modelId={modelId} product={product} id={product.id + '-workload'} disabled={!canAct || product.status === 'deploying'} />
    <ActionControl game={game} payload={{ kind: 'configure_product_offer', productId: product.id, name, workload }} label="Apply offer and customer promise" canAct={canAct} onQueue={onQueue} extraDisabled={unchanged || product.status === 'deploying'} compact />
  </section>;
}

export function RetireProductControl({ game, canAct, onQueue, product }: PanelProps & { product: ProductOffer }) {
  if (!hasConnectedCompanyRules(game.contentVersion) || product.retiredWeek !== undefined || product.status !== 'paused') return null;
  return <div><p className="small-note">Once existing customers and trials have left, retirement frees this offer’s portfolio slot and keeps its invoice history. Shared infrastructure bills continue.</p>
    <ActionControl game={game} payload={{ kind: 'retire_product', productId: product.id }} label="Retire empty offer" canAct={canAct} onQueue={onQueue} compact />
  </div>;
}
