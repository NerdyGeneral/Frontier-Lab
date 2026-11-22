/** Fictional repeated processing passes beyond each edition's distinct evidence units. */
export const DATA_REPEAT_PROFILES: Readonly<Record<string, { repeatBps: number; explanation: string }>> = {
  'starter-public': { repeatBps: 1000, explanation: 'Repeated public-sample processing passes.' },
  'specialist-conversation-1': { repeatBps: 2000, explanation: 'Overlapping conversation examples in the processing stream.' },
  'specialist-documents-1': { repeatBps: 2000, explanation: 'Repeated document segments in the processing stream.' },
  'specialist-coding-1': { repeatBps: 2000, explanation: 'Repeated repository segments in the processing stream.' },
  'specialist-tools-1': { repeatBps: 2000, explanation: 'Repeated tool trajectories in the processing stream.' },
  'broad-corpus-1': { repeatBps: 2500, explanation: 'Repeated mirrored passages in this broad-corpus edition.' },
  'broad-corpus-2': { repeatBps: 2500, explanation: 'Repeated mirrored passages in this broad-corpus edition.' },
  'broad-corpus-3': { repeatBps: 2500, explanation: 'Repeated mirrored passages in this broad-corpus edition.' },
};

export const DATA_DEDUPLICATION = {
  maximumWorkReductionBps: 1000,
  unitsPerDataStaffWeek: 250,
  minimumDataStaffWeeks: 1,
} as const;
