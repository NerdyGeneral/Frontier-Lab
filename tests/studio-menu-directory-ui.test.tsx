import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { STUDIO_MENU_ENTRIES } from '../src/core/studio-menu-catalog';
import { StudioMenuDirectory } from '../src/ui/studio-menu-directory';
import { StudioResearchNavigation } from '../src/ui/studio-navigation';
import type { GameSectionVisibility } from '../src/ui/guide-links';

const locked: GameSectionVisibility = {
  market: false, campaign: false, agents: false, research: false, appliedResearch: false,
  developerApi: false, businessCommitments: false, infrastructure: false, chips: false, capacityForecast: false,
};
const noAction = () => assert.fail('Rendering a navigation entry must not open or schedule it');
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ attributes: match[1], text: text(match[2]) }));

test('All menus renders every feature with a labelled search and visible unlock explanations', () => {
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={locked} onNavigate={noAction} onClose={noAction} />);
  assert.match(html, /role="search" aria-label="Find a menu or task"/);
  assert.match(html, /<label[^>]*>Search menus and tasks<\/label>/);
  const entries = buttons(html).filter(item => item.attributes.includes('class="studio-menu-item"'));
  assert.equal(entries.length, STUDIO_MENU_ENTRIES.length);
  assert.equal(entries.some(item => item.attributes.includes('disabled')), false, 'Locked features remain inspectable');
  assert.ok(entries.some(item => item.text.includes('Developer API') && item.text.includes('Make your first sale')));
  assert.ok(entries.some(item => item.text.includes('Architecture research') && item.text.includes('Evaluation suite (R1)')));
  assert.match(html, /class="studio-menu-lock"/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal/);
});

test('pending operations disable directory navigation while leaving search and return available', () => {
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={locked} disabled onNavigate={noAction} onClose={noAction} />);
  const entries = buttons(html).filter(item => item.attributes.includes('class="studio-menu-item"'));
  assert.ok(entries.every(item => item.attributes.includes('disabled=""')));
  const close = buttons(html).find(item => item.text === 'Back to work');
  assert.ok(close);
  assert.doesNotMatch(close.attributes, /disabled/);
  assert.doesNotMatch(html.match(/<input[^>]+>/)?.[0] ?? '', /disabled/);
});

test('Research navigation exposes pathways, challenges, architecture, catalog, applications, and data independently', () => {
  const html = renderToStaticMarkup(<StudioResearchNavigation panel="research" activeTask="architecture-research" sections={locked} disabled={false} onNavigate={noAction} />);
  const entries = buttons(html);
  assert.deepEqual(entries.map(item => item.text.replace(/ — locked$/, '')), ['Pathways', 'Challenges', 'Architecture', 'Catalog', 'Applications', 'Synthetic data', 'Compare']);
  assert.deepEqual(entries.filter(item => item.attributes.includes('aria-pressed="true"')).map(item => item.text), ['Architecture']);
  const applications = entries.find(item => item.text.startsWith('Applications'))!;
  assert.match(applications.attributes, /aria-description="Finish a discovery/);
  assert.doesNotMatch(applications.attributes, /disabled/);
  const selected = renderToStaticMarkup(<StudioResearchNavigation panel="applied-research" sections={locked} disabled={false} onNavigate={noAction} />);
  assert.match(text(selected), /Finish a discovery with an upgrade you can build/);
});
