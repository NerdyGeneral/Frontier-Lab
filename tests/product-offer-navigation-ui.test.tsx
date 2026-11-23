import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import type { ReactElement } from 'react';
import ts from 'typescript';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { createInitialState, validateState } from '../src/core/engine';
import { canonicalStateHash, getGameView } from '../src/core/index';
import { deserializeState } from '../src/core/snapshot';
import { getProductView } from '../src/modules/products';
import type { StudioLaunchSelection } from '../src/ui/studio-interaction-context';
import { NaturalBusinessCampaign, openNaturalBusiness } from './fixtures/wave5-business';

type Element = ReactElement<Record<string, unknown>>;
type Component = (props: Record<string, unknown>) => unknown;
type HookFrame = { slots: unknown[]; effects: Array<() => void>; index: number; changed: boolean };

// Run the production components with retained hook frames, including effects and
// the real ActionControl click handler. No DOM library is installed; focus and
// layout remain browser checks. Only React's hook dispatcher and the external
// Studio contexts are adapted, never offer selection or command validation.
function retainedProductUi(lab: NaturalBusinessCampaign, kind: 'basic-chat' | 'developer-api' = 'basic-chat', launch: StudioLaunchSelection | null = null, intercepted = true) {
  const frames = new Map<string, HookFrame>();
  let active: HookFrame | undefined;
  const frame = () => { assert.ok(active, 'A production component must own these hooks'); return active; };
  function useState(initial: unknown) {
    const owner = frame(), index = owner.index++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.slots[index], (update: unknown) => {
      const next = typeof update === 'function' ? update(owner.slots[index]) : update;
      if (!Object.is(next, owner.slots[index])) { owner.slots[index] = next; owner.changed = true; }
    }];
  }
  const hooks = {
    ...React,
    useState,
    useRef: (initial: unknown) => useState(() => ({ current: initial }))[0],
    useId: () => useState(() => 'offer-navigation-' + frame().index)[0],
    useEffect: (effect: () => void, dependencies?: unknown[]) => {
      const owner = frame(), index = owner.index++, previous = owner.slots[index] as unknown[] | undefined;
      if (!dependencies || !previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) owner.effects.push(effect);
      owner.slots[index] = dependencies;
    },
  };
  const submitted: string[] = [];
  let fallbackCalls = 0;
  const queue = (payload: CommandPayload) => { submitted.push(lab.queue(payload)); };
  const context = {
    useStudioLaunchSelection: () => launch,
    useStudioTaskMode: () => null,
    useStudioTaskActions: () => null,
    useStudioCommandReview: () => intercepted ? (payload: CommandPayload, _label: string, quoted: GameState) => {
      assert.equal(quoted, lab.state, 'The Studio interceptor receives the actual quoted state');
      queue(payload); return true;
    } : null,
  };
  const modules = new Map<string, Record<string, unknown>>();
  function loadProduction(name: 'product-panels' | 'components'): Record<string, unknown> {
    const cached = modules.get(name); if (cached) return cached;
    const file = new URL('../src/ui/' + name + '.tsx', import.meta.url), require = createRequire(file);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const module = { exports: {} as Record<string, unknown> }; modules.set(name, module.exports);
    new Function('require', 'module', 'exports', code)((id: string) => id === 'react' ? hooks
      : id === './studio-interaction-context' ? context : id === './components' ? loadProduction('components') : require(id), module, module.exports);
    return module.exports;
  }
  const components = loadProduction('product-panels');
  function renderComponent(key: string, element: Element) {
    let owner = frames.get(key);
    if (!owner) { owner = { slots: [], effects: [], index: 0, changed: false }; frames.set(key, owner); }
    for (let pass = 0; pass < 12; pass++) {
      owner.index = 0; owner.effects = []; owner.changed = false; active = owner;
      let result: unknown;
      try { result = (element.type as Component)(element.props); } finally { active = undefined; }
      for (const effect of owner.effects) effect();
      if (!owner.changed) return result;
    }
    assert.fail('Production hook updates must settle');
  }
  let output: unknown;
  function render() {
    const Panel = components[kind === 'basic-chat' ? 'ProductPanel' : 'DeveloperApiPanel'] as Component;
    const section = Panel({ game: lab.state, view: getGameView(lab.state), canAct: true,
      onQueue: (payload: CommandPayload) => { fallbackCalls++; assert.equal(intercepted, false, 'Studio handles the click before onQueue'); queue(payload); } });
    assert.ok(React.isValidElement(section));
    output = renderComponent('section', section as Element); return output;
  }
  function picker() { return find(output, element => componentName(element) === 'ProductPortfolioPicker'); }
  function terms() { return renderComponent('new-terms', find(output, element => componentName(element) === 'TermsForm' && !element.props.current)); }
  return {
    render, submitted,
    selected: () => picker().props.value,
    fallbackCalls: () => fallbackCalls,
    choose: (id: string) => { invoke(picker().props.onChange, id); render(); },
    edit: (id: string, value: string) => { invoke(find(terms(), element => element.props.id === id).props.onChange, { target: { value } }); },
    draft: (id: string) => find(terms(), element => element.props.id === id).props.value,
    deploy: () => {
      const action = find(terms(), element => componentName(element) === 'ActionControl' && (element.props.payload as CommandPayload | null)?.kind === 'deploy_product');
      const button = find(renderComponent('deploy', action), element => element.type === 'button');
      assert.equal(button.props.disabled, false, String(button.props['data-studio-blocked-reason']));
      invoke(button.props.onClick); return submitted.at(-1)!;
    },
    hasMetric: (label: string) => elements(output).some(element => componentName(element) === 'Metric' && element.props.label === label),
    text: () => textContent(output),
    output: () => output,
  };
}

function componentName(element: Element) { return typeof element.type === 'function' ? element.type.name : element.type; }
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children), ...elements(element.props.summary)];
}
function find(node: unknown, predicate: (element: Element) => boolean): Element {
  const result = elements(node).find(predicate); assert.ok(result, 'Expected production element'); return result;
}
function invoke(callback: unknown, ...args: unknown[]) { assert.equal(typeof callback, 'function'); return Reflect.apply(callback as (...args: unknown[]) => unknown, undefined, args); }
function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  return React.isValidElement(node) ? textContent((node as Element).props.children) : '';
}

let fixture: { game: GameState; modelId: string; reportId: string } | undefined;
let caseId = 0;
function beforeFirstLaunch() {
  if (!fixture) {
    const lab = new NaturalBusinessCampaign(createInitialState(CONTENT, 'release'), 'offer-navigation-opening');
    lab.queue({ kind: 'prepare_data', packetId: CONTENT.starterData.id });
    lab.queue({ kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 }); lab.step(2);
    lab.founder('ml');
    const training = lab.queue({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }); lab.step(3);
    const modelId = lab.state.slices.models.trainingRuns['training-' + training].outputModelId;
    lab.founder('research'); lab.queue({ kind: 'evaluate_model', modelId }); lab.step(); lab.founder('ml');
    const report = Object.values(lab.state.slices.models.reports).find(item => item.modelId === modelId && item.basicChatEligible)!;
    assert.ok(report); assert.deepEqual(validateState(lab.state), []);
    fixture = { game: lab.state, modelId, reportId: report.id };
  }
  return { lab: new NaturalBusinessCampaign(structuredClone(fixture.game), 'offer-navigation-' + ++caseId),
    selection: { intentId: 1, modelId: fixture.modelId, reportId: fixture.reportId } };
}
let paying: GameState | undefined;
function payingPortfolio() {
  if (!paying) {
    const lab = openNaturalBusiness('release'); lab.until(() => lab.company.earnedRevenueCents > 0, 20, 'ordinary paid service');
    assert.deepEqual(validateState(lab.state), []); paying = lab.state;
  }
  const lab = new NaturalBusinessCampaign(structuredClone(paying), 'offer-navigation-' + ++caseId);
  lab.autoCapacity = true; return lab;
}

test('first launch follows the created offer through the real intercepted action and paid service', () => {
  const { lab, selection } = beforeFirstLaunch(), ui = retainedProductUi(lab, 'basic-chat', selection);
  ui.render(); assert.equal(ui.selected(), 'new'); assert.equal(ui.hasMetric('Subscribed accounts'), true);
  ui.edit('basic-chat-offer-name', 'First navigation offer');
  const commandId = ui.deploy(); ui.render(); assert.equal(ui.selected(), 'new');
  assert.equal(ui.fallbackCalls(), 0, 'The intercepted Studio path must not need the onQueue callback');
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, development: 0, research: 0 }); lab.step();
  const productId = 'product:' + commandId; ui.render();
  assert.equal(ui.selected(), productId);
  assert.equal(lab.state.slices.products.offers[productId].name, 'First navigation offer');
  assert.equal(ui.hasMetric('Subscribed accounts'), false);
  lab.founder('commercial'); lab.queue({ kind: 'set_cloud_capacity', cu: 2 * U }); lab.step(); lab.autoCapacity = true;
  lab.until(() => lab.company.earnedRevenueCents > 0, 20, 'new offer paying service');
  const before = canonicalStateHash(lab.state); ui.render();
  assert.equal(ui.selected(), productId);
  assert.ok(getProductView(lab.state, productId, CONTENT).accounts > 0);
  assert.equal(ui.hasMetric('Subscribed accounts / next week'), true);
  assert.equal(canonicalStateHash(lab.state), before, 'Navigation cannot change engine progress');
});

test('a retained form reopening after it skipped the queue and settlement selects the created offer', () => {
  const { lab, selection } = beforeFirstLaunch(), ui = retainedProductUi(lab, 'basic-chat', selection);
  ui.render(); const commandId = ui.deploy();
  // An inactive retained workbench receives neither queued nor weekly props.
  lab.step(2); ui.render();
  assert.equal(ui.selected(), 'product:' + commandId);
  assert.equal(ui.hasMetric('Subscribed accounts'), false);
});

test('explicit New keeps its draft across unrelated updates without showing first-launch totals', () => {
  const lab = payingPortfolio(), ui = retainedProductUi(lab);
  const original = lab.offers()[0]; ui.render(); assert.equal(ui.selected(), original.id);
  ui.choose('new'); ui.edit('basic-chat-offer-name', 'Unsubmitted offer'); ui.edit('basic-chat-price', '14.25');
  ui.render(); lab.queue({ kind: 'rename_company', name: 'Navigation audit company' }); lab.step(); ui.render(); ui.render();
  assert.equal(ui.selected(), 'new');
  assert.equal(ui.draft('basic-chat-offer-name'), 'Unsubmitted offer');
  assert.equal(ui.draft('basic-chat-price'), '14.25');
  assert.equal(ui.hasMetric('Subscribed accounts'), false);
  assert.equal(ui.hasMetric('Waiting for first access'), false);
  assert.doesNotMatch(ui.text(), /Launch a tested conversation model, attract trial users/);
  assert.match(ui.text(), /Create another Basic Chat offer/);
  assert.equal(lab.state.slices.products.offers[original.id].name, original.name);
});

test('a second launch selects its new stable ID instead of the older active offer', () => {
  const lab = payingPortfolio(), ui = retainedProductUi(lab), original = lab.offers()[0];
  ui.render(); ui.choose('new'); ui.edit('basic-chat-offer-name', 'Second navigation offer');
  const commandId = ui.deploy(); lab.step(); ui.render();
  assert.equal(ui.selected(), 'product:' + commandId);
  assert.notEqual(ui.selected(), original.id);
  assert.equal(lab.state.slices.products.offers[original.id].name, original.name);
  ui.choose(original.id); lab.step(); ui.render(); assert.equal(ui.selected(), original.id);
});

test('an explicit existing-offer choice during deployment is retained after that launch settles', () => {
  const lab = payingPortfolio(), ui = retainedProductUi(lab), original = lab.offers()[0];
  ui.render(); ui.choose('new'); ui.edit('basic-chat-offer-name', 'Background navigation offer');
  const commandId = ui.deploy(); ui.choose(original.id); lab.step(); ui.render();
  assert.ok(lab.state.slices.products.offers['product:' + commandId]);
  assert.equal(ui.selected(), original.id);
});

test('two ordinary queued offers select the first newly committed offer deterministically', () => {
  const { lab, selection } = beforeFirstLaunch(), ui = retainedProductUi(lab, 'basic-chat', selection, false);
  ui.render(); ui.edit('basic-chat-offer-name', 'First queued offer'); const first = ui.deploy();
  const second = lab.queue({ kind: 'deploy_product', productKind: 'basic-chat', modelId: selection.modelId,
    priceCents: 1400, allowance: 100, name: 'Second queued offer', workload: 'general' });
  lab.step(); ui.render();
  assert.equal(ui.fallbackCalls(), 1, 'The ordinary Classic path also uses committed output');
  assert.equal(ui.selected(), 'product:' + first);
  assert.ok(lab.state.slices.products.offers['product:' + second]);
  ui.choose('product:' + second); ui.render(); assert.equal(ui.selected(), 'product:' + second);
});

test('Developer API launch selects its own new offer without taking over a Basic Chat draft', () => {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/connected-037-paid-published.json', import.meta.url), 'utf8'));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  const lab = new NaturalBusinessCampaign(loaded.state, 'offer-navigation-api');
  const original = lab.offers().find(offer => offer.kind === 'developer-api')!;
  const modelId = lab.state.slices.products.deployments[original.deploymentId].modelId;
  const chat = retainedProductUi(lab), api = retainedProductUi(lab, 'developer-api');
  chat.render(); chat.choose('new'); chat.edit('basic-chat-offer-name', 'Independent Chat draft');
  api.render(); api.choose('new'); api.edit('developer-api-deploy-model', modelId); api.edit('developer-api-offer-name', 'Second API offer');
  const commandId = api.deploy(); lab.step(); api.render(); chat.render();
  assert.equal(api.selected(), 'product:' + commandId);
  assert.notEqual(api.selected(), original.id);
  assert.equal(chat.selected(), 'new');
  assert.equal(chat.draft('basic-chat-offer-name'), 'Independent Chat draft');
  assert.deepEqual(validateState(lab.state), []);
});
