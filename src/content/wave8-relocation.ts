const U = 1_000_000_000;

/** Fictional logistics costs; original equipment and installed carrying costs remain. */
export const RACK_RELOCATION_RULES = {
  research: 'R12',
  feeCents: 150_000,
  maximumMovesPerRack: 4,
  stages: [
    { id: 'disconnect', name: 'Disconnect and pack', elapsedWeeks: 1, staffWeeks: U / 4 },
    { id: 'transport', name: 'Transport', elapsedWeeks: 2, staffWeeks: 0 },
    { id: 'reconnect', name: 'Reconnect and test', elapsedWeeks: 1, staffWeeks: 3 * U / 4 },
  ],
} as const;
