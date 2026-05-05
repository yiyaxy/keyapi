export const qk = {
  tokens: {
    list: (page: number) => ['tokens', 'list', page] as const,
    detail: (id: number) => ['tokens', 'detail', id] as const,
  },
  user: {
    dataSelf: (startTs: number, endTs: number) => ['user', 'data', startTs, endTs] as const,
    statSelf: (startTs: number, endTs: number) => ['user', 'stat', startTs, endTs] as const,
    self: ['user', 'self'] as const,
  },
  logs: {
    self: (query: Record<string, unknown>) => ['logs', 'self', query] as const,
  },
  chatHistory: {
    list: (query: Record<string, unknown>) => ['chat-history', 'list', query] as const,
    detail: (requestId: string) => ['chat-history', 'detail', requestId] as const,
  },
  topup: {
    history: (page: number) => ['topup', 'history', page] as const,
  },
  meta: {
    availableModels: ['meta', 'models'] as const,
    channelGroups: ['meta', 'channel-groups'] as const,
    adminGroups: ['meta', 'admin-groups'] as const,
    channelTypeModels: ['meta', 'channel-type-models'] as const,
  },
} as const;
