/** Diagnostics cannot stand in for a paid capability evaluation of this version. */
export function isCapabilitySuite(suiteId: string | undefined): boolean {
  return suiteId === undefined || suiteId === 'basic-conversation-1' || suiteId === 'expanded-capabilities-1';
}
