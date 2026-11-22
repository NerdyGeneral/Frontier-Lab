import type { DevelopmentMetricRow } from '../modules/model-development';

/** Highlight changes whose direction holds across the entire displayed range. */
export function modelScoreHighlights(readings: readonly DevelopmentMetricRow[]) {
  let gain: DevelopmentMetricRow | undefined, loss: DevelopmentMetricRow | undefined;
  let gainMagnitude = 0, lossMagnitude = 0;
  for (const reading of readings) {
    const improvement = reading.lowerIsBetter ? reading.currentBps - reading.maxBps : reading.minBps - reading.currentBps;
    const decline = reading.lowerIsBetter ? reading.minBps - reading.currentBps : reading.currentBps - reading.maxBps;
    if (improvement > gainMagnitude) { gain = reading; gainMagnitude = improvement; }
    if (decline > lossMagnitude) { loss = reading; lossMagnitude = decline; }
  }
  const display = (reading: DevelopmentMetricRow | undefined) => {
    if (!reading) return undefined;
    const result = reading.minBps === reading.maxBps ? String(reading.minBps / 100)
      : `${reading.minBps / 100}–${reading.maxBps / 100}`;
    const unit = reading.lowerIsBetter ? '%' : '';
    return `${reading.label} ${reading.currentBps / 100}${unit} → ${result}${unit}`;
  };
  return { gain: display(gain), loss: display(loss) };
}
