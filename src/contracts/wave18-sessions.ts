export type ConsumerSessionProfile = 'brief' | 'extended';

export interface ConsumerSessionHistory {
  accounts: number;
  tokens: number;
}

export interface ConsumerSessionUsage {
  profile: ConsumerSessionProfile;
  paidWorkPerExchange: number;
}

export type Wave18SessionCommand = {
  kind: 'set_consumer_sessions';
  productId: string;
  profile: ConsumerSessionProfile | 'off';
};
