import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type SetupStatus = {
  status: boolean; // true = already set up
  root_init: boolean; // true = root user exists
  database_type: string;
};

export function useSetupStatus() {
  return useQuery<SetupStatus>({
    queryKey: ['setup', 'status'],
    queryFn: async () => {
      const res = await api.get<SetupStatus>('/api/setup');
      return res.data;
    },
    staleTime: 0,
  });
}

export type SetupPayload = {
  username: string;
  password: string;
  confirmPassword: string;
  SelfUseModeEnabled: boolean;
  DemoSiteEnabled: boolean;
};

export function useCompleteSetup() {
  return useMutation({
    mutationFn: async (body: SetupPayload) => {
      await api.post('/api/setup', body);
    },
  });
}
