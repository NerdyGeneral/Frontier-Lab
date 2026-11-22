import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/contracts/types';
import { deserializeState } from '../../src/core/snapshot';
import { NaturalBusinessCampaign } from './wave5-business';

interface ScaleFixture {
  state: GameState;
  siteId: string;
  movingRackId: string;
  commands: NaturalBusinessCampaign['commands'];
  milestones: NaturalBusinessCampaign['milestones'];
  minimumCashCents: number;
  originalWeek: number;
  originalChecksum: string;
}
let prepared: ScaleFixture | undefined;

/** Ordinary investment from the published company; this helper grants no assets. */
export function paidScaleCompany(): ScaleFixture {
  if (!prepared) {
    const raw = readFileSync(join(__dirname, 'wave7-snapshot.json'), 'utf8'), imported = deserializeState(raw);
    assert.ok(imported.ok, imported.ok ? '' : imported.error);
    const originalWeek = imported.state.week, originalChecksum = JSON.parse(raw).checksum;
    const run = new NaturalBusinessCampaign(imported.state, 'wave8-scale');
    run.mark('Published Wave 7 company');
    run.hire('infrastructure', 2); run.founder('infrastructure');
    const siteId = 'facility-' + run.queue({ kind: 'start_facility' }); run.step();
    for (let i = 0; i < 7; i++) run.queue({ kind: 'order_rack', hardwareId: 'training', location: siteId });
    const movingRackId = 'rack-' + run.queue({ kind: 'order_rack', hardwareId: 'training', location: 'colocation' });
    for (let i = 0; i < 55; i++) {
      const site = run.state.slices.compute.facilities[siteId];
      const racks = Object.values(run.state.slices.compute.racks).filter(rack => rack.companyId === run.state.playerCompanyId);
      if (site.status === 'active' && racks.length === 8 && racks.every(rack => rack.status === 'installed')) break;
      if (site.status === 'building' && !site.stages[site.stageIndex].paidCents) run.queue({ kind: 'fund_facility_stage', facilityId: siteId });
      for (const rack of racks) if (rack.status === 'inventory') run.queue({ kind: 'install_rack', rackId: rack.id });
      run.step();
    }
    assert.equal(run.state.slices.compute.facilities[siteId].status, 'active');
    assert.equal(Object.values(run.state.slices.compute.racks).filter(rack => rack.companyId === run.state.playerCompanyId && rack.status === 'installed').length, 8);
    run.mark('Seven installed training racks in owned site and one in colocation');
    prepared = { state: run.state, siteId, movingRackId, commands: run.commands, milestones: run.milestones,
      minimumCashCents: run.minimumCashCents, originalWeek, originalChecksum };
  }
  return structuredClone(prepared);
}
