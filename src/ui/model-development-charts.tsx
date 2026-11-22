'use client';

import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { SCORE_SCALE, type GameState, type ModelVersion } from '../contracts/types';
import { getModelDevelopmentRows, type DevelopmentMetricRow } from '../modules/model-development';
import { modelProfileLabel } from './model-profile';

const score = (bps: number) => String(bps / SCORE_SCALE);
const signed = (bps: number) => bps === 0 ? '0' : (bps > 0 ? '+' : '−') + score(Math.abs(bps));
const changeRange = (low: number, high: number) => low === high ? signed(low) : signed(low) + ' to ' + signed(high);
const scoreRange = (row: DevelopmentMetricRow) => row.minBps === row.maxBps ? score(row.minBps) : score(row.minBps) + '–' + score(row.maxBps);
const percent = (bps: number) => (Math.max(0, Math.min(10000, bps)) / SCORE_SCALE) + '%';

function changeTone(row: DevelopmentMetricRow) {
  if (row.minBps === row.currentBps && row.maxBps === row.currentBps) return 'flat';
  if (row.minBps >= row.currentBps) return row.lowerIsBetter ? 'loss' : 'gain';
  if (row.maxBps <= row.currentBps) return row.lowerIsBetter ? 'gain' : 'loss';
  return 'mixed';
}

function SkillPlotRow({ row }: { row: DevelopmentMetricRow }) {
  const low = row.minBps - row.currentBps, high = row.maxBps - row.currentBps;
  const left = Math.min(row.currentBps, row.minBps), right = Math.max(row.currentBps, row.maxBps);
  const style = {
    '--start': percent(row.currentBps), '--low': percent(row.minBps), '--high': percent(row.maxBps),
    '--change-start': percent(left), '--change-width': percent(right - left),
  } as CSSProperties;
  return <li className="mdc-skill-row" data-change={changeTone(row)}>
    <div className="mdc-skill-head">
      <span className="mdc-skill-name">{row.label}{row.lowerIsBetter && <small>Lower is better</small>}</span>
      <span className="mdc-skill-values">
        <span className="visually-hidden">Starting score </span>{score(row.currentBps)}
        <span className="mdc-score-arrow" aria-hidden="true">→</span><span className="visually-hidden">, forecast </span>
        <strong>{scoreRange(row)}</strong>
      </span>
    </div>
    <div className="mdc-score-line">
      <div className="mdc-track" style={style} aria-hidden="true">
        <span className="mdc-current-bar" /><span className="mdc-change-line" />
        <span className="mdc-forecast-range" /><span className="mdc-current-dot" />
      </div>
      <span className="mdc-delta" aria-label={low === 0 && high === 0 ? 'No change' : 'Change ' + changeRange(low, high) + ' points'}>
        {low === 0 && high === 0 ? 'No change' : changeRange(low, high)}
      </span>
    </div>
  </li>;
}

export function TrainingForecastChart({ rows, baselineLabel = 'Starting score' }: {
  rows: readonly DevelopmentMetricRow[];
  baselineLabel?: string;
}) {
  const title = useId();
  return <section className="mdc-figure mdc-forecast" aria-labelledby={title}>
    <header className="mdc-chart-head"><h3 id={title}>Expected skill changes</h3><span className="mdc-units">0–100</span></header>
    {rows.length ? <>
      <div className="mdc-legend" aria-hidden="true">
        <span><i className="mdc-key-start" />{baselineLabel}</span>
        <span><i className="mdc-key-range" />Forecast range</span>
      </div>
      <ul className="mdc-score-list">{rows.map(row => <SkillPlotRow row={row} key={row.id} />)}</ul>
    </> : <p className="mdc-caption">Choose an available method and prepared data to see a forecast.</p>}
  </section>;
}

function SavedScoreBars({ rows, modelName }: { rows: readonly DevelopmentMetricRow[]; modelName: string }) {
  return <dl className="mdc-baseline-scores" aria-label={'Saved scores for ' + modelName}>
    {rows.map(item => <div key={item.id}>
      <dt>{item.label}</dt>
      <dd>
        <span className="mdc-baseline-track" aria-hidden="true"><i style={{ width: percent(item.minBps) }} /></span>
        <strong>{score(item.minBps)}<span className="visually-hidden"> out of 100</span></strong>
      </dd>
    </div>)}
  </dl>;
}

export function TrainingBaselineChart({ model }: { model: ModelVersion }) {
  const id = useId();
  return <section className="mdc-figure" aria-labelledby={id}>
    <header className="mdc-chart-head"><h3 id={id}>Starting scores</h3><span className="mdc-units">0–100</span></header>
    <SavedScoreBars rows={getModelDevelopmentRows(model, model)} modelName={model.name} />
  </section>;
}

/** A foundation starts a new model. Its saved parent is the design reference.
 * Distillation follows the student branch. A teacher and sibling checkpoints
 * are separate models, so their scores do not belong in this series. */
function savedLineage(game: GameState, selected: ModelVersion): ModelVersion[] {
  const path: ModelVersion[] = [], seen = new Set<string>();
  let current: ModelVersion | undefined = selected;
  while (current && current.companyId === selected.companyId && !seen.has(current.id)) {
    path.push(current);
    seen.add(current.id);
    const run = current.trainingRunId ? game.slices.models.trainingRuns[current.trainingRunId] : undefined;
    if (run?.plan?.kind === 'foundation') break;
    const parentId: string | undefined = current.parentModelId ?? current.runtimeVariant?.sourceModelId;
    current = parentId && Object.hasOwn(game.slices.models.versions, parentId) ? game.slices.models.versions[parentId] : undefined;
  }
  return path.reverse();
}

interface SavedPoint { version: ModelVersion; scoreBps: number }

function HistoryLine({ series }: { series: readonly SavedPoint[] }) {
  const points = series.map((point, index) => ({
    ...point, x: index * 100 / (series.length - 1), y: 100 - point.scoreBps / SCORE_SCALE,
  }));
  const path = points.map(point => point.x + ',' + point.y).join(' ');
  return <div className="mdc-history-graph" aria-hidden="true">
    <div className="mdc-axis-y"><span>100</span><span>50</span><span>0</span></div>
    <div className="mdc-history-grid">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <polygon points={'0,100 ' + path + ' 100,100'} className="mdc-history-fill" />
        <polyline points={path} className="mdc-history-stroke" vectorEffect="non-scaling-stroke" />
      </svg>
      {points.map(({ version, scoreBps, x, y }) => <span key={version.id} className="mdc-history-point" title={version.name + ' · ' + score(scoreBps)} style={{ left: x + '%', top: y + '%' }} />)}
    </div>
    <div className="mdc-axis-x"><span>{series[0].version.name}</span><span>{series[series.length - 1].version.name}</span></div>
  </div>;
}

export function ModelVersionHistoryChart({ game, model }: { game: GameState; model: ModelVersion }) {
  const title = useId(), skillInput = useId();
  const [selectedSkill, setSelectedSkill] = useState<DevelopmentMetricRow['id'] | null>(null);
  const lineage = savedLineage(game, model), previous = lineage.at(-2);
  const run = model.trainingRunId ? game.slices.models.trainingRuns[model.trainingRunId] : undefined;
  const kind = run?.plan?.kind;
  const rows = getModelDevelopmentRows(previous ?? model, model, kind);
  const change = (row: DevelopmentMetricRow) => Math.abs(row.minBps - row.currentBps);
  const strongest = rows.reduce((best, row) => change(row) > change(best) ? row : best);
  const metric = rows.find(row => row.id === selectedSkill) ?? strongest;
  const current = metric.minBps, delta = current - metric.currentBps;
  const series = lineage.map(version => {
    // A specialty row is omitted when the two stored values are equal and the
    // training method did not target it. Its value then equals the selected one.
    const saved = getModelDevelopmentRows(model, version, kind).find(row => row.id === metric.id);
    return { version, scoreBps: saved?.minBps ?? current };
  });
  const plotted = series.slice(-8);
  return <section className="mdc-figure mdc-history" aria-labelledby={title}>
    <header className="mdc-chart-head"><h3 id={title}>Version history</h3><span className="mdc-units">{lineage.length} saved {lineage.length === 1 ? 'version' : 'versions'}</span></header>
    {previous ? <>
      <div className="mdc-history-controls"><label htmlFor={skillInput}>Show skill</label>
        <select id={skillInput} value={metric.id} onChange={event => setSelectedSkill(event.target.value as DevelopmentMetricRow['id'])}>
          {rows.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div className="mdc-history-reading"><strong>{score(current)}<small> / 100</small></strong>
        <span data-change={changeTone(metric)}>
          {delta === 0 ? 'Unchanged' : signed(delta) + ' points'} from {previous.name}{metric.lowerIsBetter ? ' · Lower is better' : ''}
        </span>
      </div>
      <HistoryLine series={plotted} />
      <p className="mdc-caption">{plotted.length < lineage.length ? 'Last ' + plotted.length + ' versions' : 'Saved versions'} in this branch, oldest to newest.</p>
      <details className="mdc-details"><summary>Skill changes from {previous.name}</summary>
        <table><caption className="visually-hidden">Saved scores in {previous.name} and {model.name}</caption>
          <thead><tr><th scope="col">Skill</th><th scope="col">Previous</th><th scope="col">Current</th><th scope="col">Change</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}{row.lowerIsBetter && <small>Lower is better</small>}</th>
            <td>{score(row.currentBps)}</td><td>{score(row.minBps)}</td><td data-change={changeTone(row)}>{signed(row.minBps - row.currentBps)}</td></tr>)}</tbody>
        </table>
      </details>
      <details className="mdc-details"><summary>Version scores for {metric.label.toLowerCase()}</summary>
        <table><caption className="visually-hidden">{metric.label} by saved version</caption>
          <thead><tr><th scope="col">Version</th><th scope="col">Profile</th><th scope="col">Week</th><th scope="col">Score</th></tr></thead>
          <tbody>{series.map(({ version, scoreBps }) => <tr key={version.id}><th scope="row">{version.name}</th><td>{modelProfileLabel(version)}</td><td>{version.createdWeek ?? '—'}</td><td>{score(scoreBps)}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <>
      <SavedScoreBars rows={rows} modelName={model.name} />
      <p className="mdc-caption">{model.name} is the first recorded version of this branch. A follow-up run will add a version to compare.</p>
    </>}
  </section>;
}
