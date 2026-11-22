import { RESOURCE_SCALE } from '../contracts/types';

export function checkedInteger(value: number, label = 'value', nonnegative = true): number {
  if (!Number.isSafeInteger(value) || (nonnegative && value < 0)) throw new Error(`${label} must be a ${nonnegative ? 'nonnegative ' : ''}safe integer.`);
  return value;
}
export function toUnits(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Resource quantity must be finite and nonnegative.');
  const units = Math.round(value * RESOURCE_SCALE);
  return checkedInteger(units, 'resource quantity');
}
export function fromUnits(value: number): number { return checkedInteger(value) / RESOURCE_SCALE; }
export function checkedAdd(a: number, b: number): number { checkedInteger(a, 'first operand', false); checkedInteger(b, 'second operand', false); return checkedInteger(a + b, 'sum', false); }
export function mulDiv(value: number, numerator: number, denominator: number, rounding: 'floor' | 'ceil' | 'nearest' = 'floor'): number {
  [value, numerator].forEach(v => checkedInteger(v));
  checkedInteger(denominator); if (denominator === 0) throw new Error('Denominator must be positive.');
  const n = BigInt(value) * BigInt(numerator), d = BigInt(denominator);
  const adjustment = rounding === 'ceil' ? d - BigInt(1) : rounding === 'nearest' ? d / BigInt(2) : BigInt(0);
  return checkedInteger(Number((n + adjustment) / d), 'result');
}
export function accumulateFraction(numerator: number, denominator: number, carry = 0): { whole: number; remainder: number } {
  checkedInteger(numerator); checkedInteger(denominator); checkedInteger(carry);
  if (denominator === 0 || carry >= denominator) throw new Error('Invalid fraction denominator or carry.');
  const n = BigInt(numerator) + BigInt(carry), d = BigInt(denominator);
  return { whole: checkedInteger(Number(n / d)), remainder: checkedInteger(Number(n % d)) };
}
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}
export function formatUnits(units: number): string { return (units / RESOURCE_SCALE).toLocaleString('en-US', { maximumFractionDigits: 4 }); }
