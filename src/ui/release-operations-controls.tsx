'use client';

import type { PanelProps } from './panels';
import { ReleaseRehearsalPanel } from './release-rehearsal-panel';
import { PreparedReleasesPanel } from './prepared-releases-panel';

/** Release choices stay beside their product, under one plain disclosure. */
export function ReleaseOperationsControls(props: PanelProps & { productId: string }) {
  const { game, productId } = props;
  const researched = (game.slices.research.completedByCompany[game.playerCompanyId] ?? []).includes('R12');
  const used = Object.values(game.slices.products.releaseRehearsals ?? {}).some(item => item.productId === productId)
    || Object.values(game.slices.products.preparedReleases ?? {}).some(item => item.productId === productId);
  if (!researched && !used) return null;
  return <details className="inline-details release-operations" id={'release-operations-' + productId}>
    <summary>Manage model releases</summary>
    <ReleaseRehearsalPanel {...props} />
    <PreparedReleasesPanel {...props} />
  </details>;
}
