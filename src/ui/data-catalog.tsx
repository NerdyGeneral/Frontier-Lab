'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { DATA_CATALOG } from '../content/wave2-lab';
import { ADVANCED_SKILL_LABELS } from '../content/advanced-skills';
import type { DataCatalogItem } from '../contracts/wave2-lab';
import type { CommandPayload, GameState } from '../contracts/types';
import { formatMoney } from '../core/math';
import { formatWorkPoints } from '../modules/workforce-points';
import { ActionControl, Metric, Metrics } from './components';

const LABELS = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use', ...ADVANCED_SKILL_LABELS };
export function dataCatalogSkills(item: DataCatalogItem): string[] {
  const coverage = { ...item.coverageBps, ...item.advancedCoverageBps };
  return Object.entries(LABELS).filter(([key]) => (coverage[key as keyof typeof coverage] ?? 0) >= 5000).map(([, label]) => label);
}
export function searchDataCatalog(query: string): readonly DataCatalogItem[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return DATA_CATALOG.filter(item => {
    const text = [item.name, ...dataCatalogSkills(item), item.broadUnits ? 'foundation general broad' : '', item.behaviorUnits ? 'behavior reliability' : '', item.id.includes('policy') ? 'policy refusal allowed restricted' : ''].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}

export function DataCatalog({ game, catalogId, onSelect, canAct, onQueue }: {
  game: GameState; catalogId: string; onSelect: (id: string) => void;
  canAct: boolean; onQueue: (payload: CommandPayload) => void;
}) {
  const [query, setQuery] = useState('');
  const offers = searchDataCatalog(query);
  const selected = DATA_CATALOG.find(item => item.id === catalogId) ?? DATA_CATALOG[0];
  const owned = new Set(Object.values(game.slices.data.packets).filter(item => item.companyId === game.playerCompanyId).map(item => item.catalogId));
  return <section className="data-marketplace" aria-label="Training data catalog">
    <div className="data-marketplace-heading"><div><h3>Find examples for your next model</h3><p className="small-note">Browse every dataset, including reasoning, long context and multimodal examples. Acquire a source, prepare it, then select it for training.</p></div></div>
    <label className="data-catalog-search"><Search size={18} aria-hidden="true" /><span className="visually-hidden">Search training data</span><input type="search" placeholder="Search a skill or dataset" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <p className="small-note" role="status">{offers.length} of {DATA_CATALOG.length} datasets</p>
    <div className="data-marketplace-layout">
      <div className="data-catalog-list" role="group" aria-label="Available datasets">
        {offers.map(item => <article key={item.id} className="data-catalog-entry"><button type="button" className="data-catalog-card" aria-expanded={item.id === selected.id} aria-pressed={item.id === selected.id} onClick={() => onSelect(item.id)}>
          <span className="data-catalog-card-heading"><strong>{item.name}</strong><span>{formatMoney(item.feeCents)}</span></span>
          <span>{dataCatalogSkills(item).join(' · ') || 'Policy boundaries'}</span>
          <small>{item.rawUnits} units · {item.qualityBps / 100}% quality{owned.has(item.id) ? ' · Owned' : ''}</small>
        </button>{item.id === selected.id && <div className="data-catalog-choice" role="region" aria-label="Selected dataset and cost">
        <span className="small-heading">Selected source</span><h3>{selected.name}</h3>
        <Metrics><Metric label="Purchase price">{formatMoney(selected.feeCents)}</Metric><Metric label="Raw examples">{selected.rawUnits} units</Metric><Metric label="Quality">{selected.qualityBps / 100} / 100</Metric><Metric label="Preparation work">{formatWorkPoints(selected.preparationStaff)} Data points</Metric></Metrics>
        <p className="small-note">{selected.broadUnits ? 'General examples support foundation training. ' : ''}{selected.behaviorUnits ? 'Includes behavior examples for reliability training. ' : ''}Buying data adds it to My datasets. Preparation is a separate project.</p>
        <ActionControl game={game} payload={{ kind: 'buy_data', catalogId: selected.id }} label="Acquire dataset" canAct={canAct} onQueue={onQueue} />
        </div>}</article>)}
        {!offers.length && <p className="small-note">No matching datasets. Try “reasoning,” “coding,” “foundation,” or clear your search.</p>}
      </div>
    </div>
  </section>;
}
