import type { DesignDomain } from '../contracts/model-design';
import type { SystemsChallengeFormat } from '../contracts/model-challenges';

const U = 1_000_000_000;
/** Version-one authored workload constraints. Changing these requires a new suite ID. */
export interface SystemsChallengeCase {
  title: string;
  domain: DesignDomain;
  support: DesignDomain;
  difficultyBps: number;
  reliabilityBps: number;
  maxServingCUwPer1000?: number;
  maxMemoryMU?: number;
  minRetentionBps?: number;
  minVerifiedBps?: number;
  maxLatencyBps?: number;
}

export const SYSTEMS_CHALLENGE_CASES: Readonly<Record<SystemsChallengeFormat, readonly SystemsChallengeCase[]>> = {
  cost: [
    { title: 'Handle the everyday support queue', domain: 'conversation', support: 'documents', difficultyBps: 4300, reliabilityBps: 8300, maxServingCUwPer1000: 0.20 },
    { title: 'Classify invoices within the service budget', domain: 'documents', support: 'conversation', difficultyBps: 4500, reliabilityBps: 8400, maxServingCUwPer1000: 0.22 },
    { title: 'Route routine code assistance efficiently', domain: 'coding', support: 'tools', difficultyBps: 4300, reliabilityBps: 8300, maxServingCUwPer1000: 0.24 },
    { title: 'Absorb a discounted support contract', domain: 'conversation', support: 'reasoning', difficultyBps: 5000, reliabilityBps: 8600, maxServingCUwPer1000: 0.18 },
    { title: 'Keep a mixed document queue affordable', domain: 'documents', support: 'longContext', difficultyBps: 5000, reliabilityBps: 8600, maxServingCUwPer1000: 0.20 },
    { title: 'Meet the lean automation contract', domain: 'tools', support: 'coding', difficultyBps: 5100, reliabilityBps: 8700, maxServingCUwPer1000: 0.16 },
  ],
  memory: [
    { title: 'Run a local reception assistant', domain: 'conversation', support: 'documents', difficultyBps: 4300, reliabilityBps: 8300, maxMemoryMU: 3 * U },
    { title: 'Read a private document on a small appliance', domain: 'documents', support: 'conversation', difficultyBps: 4500, reliabilityBps: 8400, maxMemoryMU: 4 * U },
    { title: 'Keep a bounded session inside the device', domain: 'longContext', support: 'documents', difficultyBps: 4200, reliabilityBps: 8300, maxMemoryMU: 4 * U },
    { title: 'Support a memory-limited field team', domain: 'conversation', support: 'tools', difficultyBps: 5100, reliabilityBps: 8600, maxMemoryMU: 3 * U },
    { title: 'Review a local case without cloud spillover', domain: 'documents', support: 'longContext', difficultyBps: 5100, reliabilityBps: 8600, maxMemoryMU: 4 * U },
    { title: 'Fit the strict handheld deployment', domain: 'tools', support: 'reasoning', difficultyBps: 5000, reliabilityBps: 8700, maxMemoryMU: 2 * U },
  ],
  retention: [
    { title: 'Retain a client constraint after twelve updates', domain: 'longContext', support: 'documents', difficultyBps: 4700, reliabilityBps: 8400, minRetentionBps: 6000, maxMemoryMU: 10 * U },
    { title: 'Recall an early exception after the case changes', domain: 'documents', support: 'longContext', difficultyBps: 4800, reliabilityBps: 8500, minRetentionBps: 6200, maxMemoryMU: 10 * U },
    { title: 'Reconcile a corrected client preference', domain: 'reasoning', support: 'conversation', difficultyBps: 4700, reliabilityBps: 8500, minRetentionBps: 6400, maxMemoryMU: 12 * U },
    { title: 'Carry a recurring task across twenty-four updates', domain: 'longContext', support: 'tools', difficultyBps: 5300, reliabilityBps: 8700, minRetentionBps: 6800, maxMemoryMU: 10 * U },
    { title: 'Preserve a critical revision without retaining everything', domain: 'documents', support: 'reasoning', difficultyBps: 5300, reliabilityBps: 8700, minRetentionBps: 7000, maxMemoryMU: 10 * U },
    { title: 'Repair conflicting memory before the final answer', domain: 'reasoning', support: 'longContext', difficultyBps: 5600, reliabilityBps: 8800, minRetentionBps: 7400, maxMemoryMU: 12 * U },
  ],
  verification: [
    { title: 'Check an answer before reporting completion', domain: 'reasoning', support: 'documents', difficultyBps: 5000, reliabilityBps: 8600, minVerifiedBps: 6600, maxLatencyBps: 32000 },
    { title: 'Verify a tool result against its specification', domain: 'tools', support: 'reasoning', difficultyBps: 5000, reliabilityBps: 8600, minVerifiedBps: 6800, maxLatencyBps: 32000 },
    { title: 'Reject an attractive but failing code repair', domain: 'coding', support: 'reasoning', difficultyBps: 5100, reliabilityBps: 8700, minVerifiedBps: 7000, maxLatencyBps: 35000 },
    { title: 'Compare alternatives within the response deadline', domain: 'reasoning', support: 'tools', difficultyBps: 5500, reliabilityBps: 8800, minVerifiedBps: 7400, maxLatencyBps: 35000 },
    { title: 'Stop only when the workflow is actually complete', domain: 'tools', support: 'coding', difficultyBps: 5500, reliabilityBps: 8800, minVerifiedBps: 7600, maxLatencyBps: 40000 },
    { title: 'Resolve a disputed result with an independent check', domain: 'reasoning', support: 'coding', difficultyBps: 5800, reliabilityBps: 8900, minVerifiedBps: 8000, maxLatencyBps: 40000 },
  ],
};
