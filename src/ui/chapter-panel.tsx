'use client';

import { useState } from 'react';
import type { ChapterId } from '../contracts/strategic-variety';
import { CHAPTERS } from '../content/strategic-variety';
import { CHAPTER_REWARDS } from '../content/company-progression';
import { assessChapter } from '../modules/chapters';
import { assessConnectedChapter, connectedChapterDefinition } from '../modules/company-progression';
import { companyChapterEarnedWeek } from '../modules/progression-state';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';

export function ChapterPanel(props: PanelProps) {
  return props.game.slices.campaign.progression ? <ConnectedChapterPanel {...props} /> : <LegacyChapterPanel {...props} />;
}

function ConnectedChapterPanel({ game, canAct, onQueue }: PanelProps) {
  const progression = game.slices.campaign.progression!, ids = Object.keys(CHAPTERS) as ChapterId[];
  const remaining = ids.filter(id => companyChapterEarnedWeek(game, id) === null);
  const pinned = game.slices.campaign.chapters?.active;
  const [choice, setChoice] = useState<ChapterId>(pinned ?? remaining[0] ?? 'first-product');
  const selected = remaining.includes(choice) ? choice : remaining[0];
  return <Section title="Company chapters" id="chapters">
    <p className="small-note">Every chapter tracks your results in the background. Pin a goal to guide your next decision. Qualifying model replacements and changes of focus preserve the company's progress.</p>
    <Metrics><Metric label="Chapters earned">{ids.length - remaining.length} / {ids.length}</Metric><Metric label="Pinned goal">{pinned ? connectedChapterDefinition(pinned).title : 'Choose any useful next goal'}</Metric></Metrics>
    {selected && <div className="chapter-selection"><label className="line-control wide-select" htmlFor="company-chapter">Next goal<select id="company-chapter" value={selected} onChange={event => setChoice(event.target.value as ChapterId)} disabled={!canAct}>{remaining.map(id => <option key={id} value={id}>{connectedChapterDefinition(id).title}</option>)}</select></label><ActionControl game={game} payload={{ kind: 'select_chapter', chapterId: selected }} label="Pin this goal" canAct={canAct} onQueue={onQueue} extraDisabled={selected === pinned} compact /></div>}
    <div className="campaign-routes">{ids.map(id => {
      const definition = connectedChapterDefinition(id), earnedWeek = companyChapterEarnedWeek(game, id), track = progression.chapters[id];
      const assessment = assessConnectedChapter(game, id), streak = earnedWeek !== null ? definition.weeks : track?.progress.length ?? 0;
      return <article key={id} className="project-row" aria-label={definition.title + ' chapter'}>
        <div className="project-heading"><strong>{definition.title}{pinned === id ? ' · Pinned' : ''}</strong><span>{earnedWeek !== null ? `Earned · Week ${earnedWeek}` : `${streak} / ${definition.weeks} weeks`}</span></div>
        <progress value={streak} max={definition.weeks} aria-label={definition.title + ' qualifying weeks'} />
        <p className="small-note"><strong>{earnedWeek !== null ? 'Permanent benefit' : 'Earn this benefit'} · {CHAPTER_REWARDS[id].name}.</strong> {CHAPTER_REWARDS[id].description}</p>
        {earnedWeek === null && <p className="small-note">{assessment.productName ? `Tracking ${assessment.productName}. ` : ''}{assessment.criteria.find(criterion => !criterion.met)?.label ?? 'All requirements met. Keep delivering reliable paid work.'}</p>}
        <details className="inline-details" open={pinned === id && earnedWeek === null || undefined}><summary>Chapter requirements</summary><ul className="campaign-criteria">{assessment.criteria.map(criterion => <li key={criterion.label}><span aria-hidden="true">{criterion.met ? '✓' : '·'}</span> {criterion.label}</li>)}</ul><p className="small-note">Each week needs a qualified evaluated model delivering paid work. A newer qualified model or another qualifying customer service can continue the company streak. A missed operating requirement resets an unfinished streak; earned chapters remain.</p></details>
      </article>;
    })}</div>
  </Section>;
}

function LegacyChapterPanel({ game, canAct, onQueue }: PanelProps) {
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
