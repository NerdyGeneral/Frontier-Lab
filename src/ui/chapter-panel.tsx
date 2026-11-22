'use client';

import { useState } from 'react';
import type { ChapterId } from '../contracts/strategic-variety';
import { CHAPTERS } from '../content/strategic-variety';
import { assessChapter } from '../modules/chapters';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';

export function ChapterPanel({ game, canAct, onQueue }: PanelProps) {
  const chapters = game.slices.campaign.chapters;
  const ids = Object.keys(CHAPTERS) as ChapterId[];
  const available = ids.filter(id => !chapters?.completed[id]);
  const [selection, setSelection] = useState<ChapterId>(chapters?.active ?? available[0] ?? 'first-product');
  const selected = available.includes(selection) ? selection : available[0];
  const active = chapters?.active;
  const activeDefinition = active ? CHAPTERS[active] : null;
  const assessment = active ? assessChapter(game, active) : null;
  return <Section title="Your next chapter" id="chapters">
    <p className="small-note">Pick one goal to focus your lab. The game records qualifying weeks automatically; earned chapters remain in this campaign’s save.</p>
    <Metrics><Metric label="Chapters earned">{Object.keys(chapters?.completed ?? {}).length} / {ids.length}</Metric>
      <Metric label="Current focus">{activeDefinition?.title ?? 'Choose a chapter'}</Metric>
      {active && <Metric label="Qualifying weeks">{chapters!.streak} / {CHAPTERS[active].weeks}</Metric>}</Metrics>
    {active && activeDefinition && <article className="project-row" aria-label="Current chapter progress">
      <div className="project-heading"><strong>{activeDefinition.title}</strong><span>{chapters!.completed[active] ? `Earned · Week ${chapters!.completed[active]!.completedWeek}` : `${chapters!.streak} / ${activeDefinition.weeks} weeks`}</span></div>
      <progress value={chapters!.streak} max={activeDefinition.weeks} aria-label="Chapter consecutive qualifying weeks" />
      {chapters!.completed[active] ? <p className="campaign-achievement">Earned permanently. Choose another chapter whenever you are ready.</p>
        : <><p className="small-note">{assessment?.productName ? `Tracking ${assessment.productName}. ` : ''}{assessment?.criteria.find(criterion => !criterion.met)?.label ?? 'All requirements met. Keep this product and model operating to complete the streak.'}</p>
          <ul className="campaign-criteria">{assessment?.criteria.map(criterion => <li key={criterion.label}><span aria-hidden="true">{criterion.met ? '✓' : '·'}</span> <span className="visually-hidden">{criterion.met ? 'Met: ' : 'Still needed: '}</span>{criterion.label}</li>)}</ul>
          <p className="small-note">Use the same product and model for the consecutive weeks. Missing a requirement resets only the unfinished streak.</p></>}
    </article>}
    {selected && <div className="chapter-selection">
      <label className="line-control wide-select" htmlFor="company-chapter">{active ? 'Choose your next focus' : 'Choose a focus'}<select id="company-chapter" value={selected} disabled={!canAct} onChange={event => setSelection(event.target.value as ChapterId)}>{available.map(id => <option key={id} value={id}>{CHAPTERS[id].title} · {CHAPTERS[id].weeks} {CHAPTERS[id].weeks === 1 ? 'week' : 'weeks'}</option>)}</select></label>
      <p className="small-note">{CHAPTERS[selected].description}</p>
      <ul className="small-note">{CHAPTERS[selected].requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul>
      <ActionControl game={game} payload={{ kind: 'select_chapter', chapterId: selected }} label="Focus on this chapter" canAct={canAct} onQueue={onQueue} extraDisabled={selected === active} />
    </div>}
    {Object.keys(chapters?.completed ?? {}).length > 0 && <div className="chapter-achievements"><h3>Earned chapters</h3>{ids.filter(id => chapters?.completed[id]).map(id => <p className="small-note" key={id}>✓ <strong>{CHAPTERS[id].title}</strong> · Week {chapters!.completed[id]!.completedWeek}</p>)}</div>}
  </Section>;
}
