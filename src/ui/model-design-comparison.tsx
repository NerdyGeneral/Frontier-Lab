'use client';

import { useMemo } from 'react';
import type { GameState } from '../contracts/types';
import { getAISystemMetrics } from '../modules/ai-systems';
import { getAISystemForecastModel } from '../modules/model-design';
import { formatMoney, formatUnits } from '../core/math';
import { DESIGN_SKILL_NAMES, forecastSkill, getDesignCandidateForecast, humanizeDesignRequirement, type ModelDesignCandidate } from './model-design-insights';

const score = (value: number) => (value / 100).toLocaleString('en-US', { maximumFractionDigits: 1 });
const signed = (value: number, format: (value: number) => string) => value === 0 ? 'No change' : (value > 0 ? '+' : '−') + format(Math.abs(value));

export function ModelDesignComparison({ game, saved, current, canAct, onRestore, onClear }: {
  game: GameState; saved: ModelDesignCandidate; current: ModelDesignCandidate; canAct: boolean;
  onRestore: () => void; onClear: () => void;
}) {
  const pinned = useMemo(() => getDesignCandidateForecast(game, saved), [game, saved]);
  const edited = useMemo(() => getDesignCandidateForecast(game, current), [game, current]);
  const sameInputs = saved.baseModelId === current.baseModelId && [...saved.packetIds].sort().join('|') === [...current.packetIds].sort().join('|');
  const ready = !!pinned.preview && !!edited.preview && pinned.hasPrepared && edited.hasPrepared;
  const sameFamily = saved.spec.family === current.spec.family;
  const operating = (candidate: ModelDesignCandidate, forecast: typeof pinned) => getAISystemMetrics(getAISystemForecastModel(candidate.spec, forecast.design,
    forecast.preview && forecast.hasPrepared ? { capabilityBps: forecast.preview.capabilityRange.minimum, advancedCapabilities: forecast.preview.advancedCapabilityRange?.minimum, reliabilityBps: forecast.preview.reliabilityRange.minimum } : undefined));
  const savedSystem = operating(saved, pinned), currentSystem = operating(current, edited);
  const skills = (Object.keys(DESIGN_SKILL_NAMES) as (keyof typeof DESIGN_SKILL_NAMES)[]).map(domain => ({
    id: domain, name: DESIGN_SKILL_NAMES[domain], saved: ready ? forecastSkill(pinned.preview!, domain) : null,
    current: ready ? forecastSkill(edited.preview!, domain) : null, lower: false, format: score,
  }));
  const rows = [...skills,
    { id: 'memory', name: 'Deployed memory', saved: pinned.design.residentMU, current: edited.design.residentMU, lower: true, format: (n: number) => formatUnits(n) + ' MU' },
    { id: 'workspace', name: 'Training memory', saved: pinned.design.requiredMemory, current: edited.design.requiredMemory, lower: true, format: (n: number) => formatUnits(n) + ' MU' },
    { id: 'serving', name: 'Serving multiplier', saved: pinned.design.servingWorkBps, current: edited.design.servingWorkBps, lower: true, format: (n: number) => (n / 10000).toFixed(2) + '×' },
    { id: 'request-cost', name: 'Serving / 1,000 standard requests', saved: savedSystem.servingCUwPer1000, current: currentSystem.servingCUwPer1000, lower: true, format: (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' CUw' },
    { id: 'session-memory', name: 'Memory per account', saved: savedSystem.sessionMemoryMU, current: currentSystem.sessionMemoryMU, lower: true, format: (n: number) => formatUnits(n) + ' MU' },
    { id: 'retention', name: 'Case retention', saved: ready ? savedSystem.retentionBps : null, current: ready ? currentSystem.retentionBps : null, lower: false, format: (n: number) => score(n) + '%' },
    { id: 'verified', name: 'Verified completion', saved: ready ? savedSystem.verifiedCompletionBps : null, current: ready ? currentSystem.verifiedCompletionBps : null, lower: false, format: (n: number) => score(n) + '%' },
    { id: 'latency', name: 'Relative latency', saved: savedSystem.latencyBps, current: currentSystem.latencyBps, lower: true, format: (n: number) => (n / 10000).toFixed(2) + '×' },
    { id: 'work', name: 'Training work', saved: pinned.design.workCUw, current: edited.design.workCUw, lower: true, format: (n: number) => formatUnits(n) + ' CUw' },
    { id: 'fee', name: 'Setup fee', saved: pinned.design.feeCents, current: edited.design.feeCents, lower: true, format: formatMoney },
  ];
  const changed = rows.filter(row => (row.id !== 'serving' || sameFamily) && row.saved !== null && row.current !== null && row.saved !== row.current).length;
  return <details className="model-design-comparison">
    <summary><span>Compare with {saved.spec.name || 'saved candidate'}</span><strong>{!ready ? 'Skills need prepared data' : changed ? `${changed} outcomes change` : 'Same forecast'}</strong></summary>
    <div className="model-design-comparison-body">
      <p>Saved candidate → current design. Both forecasts use the current lab and each candidate’s original starting model and datasets.</p>
      <dl>{rows.map(row => {
        const differentReference = row.id === 'serving' && !sameFamily;
        const delta = differentReference || row.saved === null || row.current === null ? null : row.current - row.saved;
        return <div key={row.id} data-change={delta === null || delta === 0 ? 'flat' : (delta > 0) !== row.lower ? 'gain' : 'loss'}>
          <dt>{row.name}{row.lower && <small>{row.id === 'serving' ? 'Relative to each family’s reference' : 'Lower uses fewer resources'}</small>}</dt>
          <dd><span>{row.saved === null ? '—' : row.format(row.saved)} <i aria-hidden="true">→</i> {row.current === null ? '—' : row.format(row.current)}</span>
            <strong>{differentReference ? 'Different family references' : delta === null ? 'Choose prepared data' : signed(delta, row.format)}</strong></dd>
        </div>;
      })}</dl>
      {(pinned.reason || edited.reason) && <p className="model-design-comparison-note">{pinned.reason && <>Saved candidate: {humanizeDesignRequirement(pinned.reason.message)} </>}{edited.reason && <>Current design: {humanizeDesignRequirement(edited.reason.message)}</>}</p>}
      <div className="model-design-comparison-actions"><button type="button" onClick={onRestore} disabled={!canAct || !sameInputs}>Restore saved settings</button><button type="button" onClick={onClear}>Clear comparison</button></div>
      {!sameInputs && <p>Choose the saved starting model and datasets again to restore all of its settings. Comparing remains available.</p>}
    </div>
  </details>;
}
