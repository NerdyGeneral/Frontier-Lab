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

test('All menus renders each feature once with action shortcuts and visible unlock explanations', () => {
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={locked} onNavigate={noAction} onClose={noAction} />);
  assert.match(html, /role="search" aria-label="Find a feature or action"/);
  assert.match(html, /<label[^>]*>Search features and actions<\/label>/);
  const entries = buttons(html).filter(item => item.attributes.includes('class="studio-menu-item"'));
  assert.equal(entries.length, STUDIO_MENU_ENTRIES.length);
  assert.equal(entries.some(item => item.attributes.includes('disabled')), false, 'Locked features remain inspectable');
  assert.ok(entries.some(item => item.text.includes('Developer API') && item.text.includes('Make your first sale')));
  assert.ok(entries.some(item => item.text.startsWith('Research programs')));
  assert.equal(entries.filter(item => item.text.startsWith('Develop a model')).length, 1);
  assert.equal(entries.filter(item => item.text.startsWith('Capacity')).length, 1);
  assert.doesNotMatch(html, /Menus and tasks|value="task"|data-menu-kind/);
  const shortcuts = buttons(html).filter(item => item.attributes.includes('class="studio-menu-shortcut"'));
  assert.ok(shortcuts.some(item => item.text.startsWith('Architecture research')));
  assert.ok(shortcuts.some(item => item.text.startsWith('Systems experiment')));
  assert.ok(shortcuts.some(item => item.text.startsWith('Forecast') && item.text.includes('Research Enterprise operations')));
  assert.ok(shortcuts.some(item => item.text.startsWith('Costs') && item.text.includes('Research Enterprise operations')));
  assert.equal(shortcuts.some(item => item.attributes.includes('disabled')), false, 'Locked shortcuts remain inspectable');
  assert.match(html, /class="studio-menu-lock"/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal/);
});

test('pending operations disable directory navigation while leaving search and return available', () => {
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={locked} disabled onNavigate={noAction} onClose={noAction} />);
  const entries = buttons(html).filter(item => /class="studio-menu-(?:item|shortcut)"/.test(item.attributes));
  assert.ok(entries.every(item => item.attributes.includes('disabled=""')));
  const close = buttons(html).find(item => item.text === 'Back to work');
  assert.ok(close);
  assert.doesNotMatch(close.attributes, /disabled/);
  assert.doesNotMatch(html.match(/<input[^>]+>/)?.[0] ?? '', /disabled/);
});

test('Research navigation groups architecture under Programs and keeps locked applications inspectable', () => {
  const html = renderToStaticMarkup(<StudioResearchNavigation panel="research" activeTask="architecture-research" sections={locked} disabled={false} onNavigate={noAction} />);
  const entries = buttons(html);
  assert.deepEqual(entries.map(item => item.text.replace(/ — locked$/, '')), ['Discoveries', 'Programs', 'Challenges', 'Applications', 'Synthetic data', 'Compare']);
  assert.deepEqual(entries.filter(item => item.attributes.includes('aria-pressed="true"')).map(item => item.text), ['Programs']);
  const applications = entries.find(item => item.text.startsWith('Applications'))!;
  assert.match(applications.attributes, /aria-description="Finish a discovery/);
  assert.doesNotMatch(applications.attributes, /disabled/);
  const selected = renderToStaticMarkup(<StudioResearchNavigation panel="applied-research" sections={locked} disabled={false} onNavigate={noAction} />);
  assert.match(text(selected), /Finish a discovery with an upgrade you can build/);
});
