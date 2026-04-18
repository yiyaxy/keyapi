export const qk = {
  tokens: {
    list: (page: number) => ['tokens', 'list', page] as const,
    detail: (id: number) => ['tokens', 'detail', id] as const,
  },
  user: {
    dataSelf: (startTs: number, endTs: number) =>
      ['user', 'data', startTs, endTs] as const,
    statSelf: (startTs: number, endTs: number) =>
      ['user', 'stat', startTs, endTs] as const,
  },
  meta: {
    availableModels: ['meta', 'models'] as const,
    channelGroups: ['meta', 'channel-groups'] as const,
  },
} as const;
