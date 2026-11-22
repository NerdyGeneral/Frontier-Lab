import type { EvaluationReport, GameState } from '../contracts/types';
import { POLICY_HOLDOUT_RULES } from '../content/wave11-policy';
import { policyHoldoutReport } from '../modules/policy-holdouts';

/** Commercial receipts cannot backdate or bypass an adopted model's exact policy evidence. */
export function assertWave11PolicyReleases(state: Readonly<GameState>): void {
  const reports = new Map<string, EvaluationReport | undefined>();
  const check = (modelId: string, admittedWeek: number) => {
    const model = state.slices.models.versions[modelId];
    if (!model?.policy) return;
    if (!reports.has(modelId)) reports.set(modelId, policyHoldoutReport(state, modelId));
    const report = reports.get(modelId);
    if (!report?.policy || report.week > admittedWeek || report.policy.totals.unsafeCompliances > POLICY_HOLDOUT_RULES.unsafeCeiling) {
      throw new Error('Commercial use of a policy-trained model requires its own paid, passing policy report before admission.');
    }
  };
  for (const deployment of Object.values(state.slices.products.deployments)) check(deployment.modelId, deployment.startedWeek);
  for (const rehearsal of Object.values(state.slices.products.releaseRehearsals ?? {})) check(rehearsal.candidateModelId, rehearsal.startedWeek);
  for (const release of Object.values(state.slices.products.preparedReleases ?? {})) {
    check(release.candidateModelId, release.startedWeek);
    check(release.sourceDeployment.modelId, release.sourceDeployment.startedWeek);
  }
  for (const install of Object.values(state.slices.products.efficiencyInstalls ?? {})) {
    if (install.kind === 'routing' && install.secondaryModelId) check(install.secondaryModelId, install.startedWeek);
  }
  for (const contract of Object.values(state.slices.products.commercialContracts ?? {})) check(contract.modelId, contract.signedWeek);
  for (const job of Object.values(state.slices.agents.jobs)) check(job.model.id, job.acceptedWeek);
}
