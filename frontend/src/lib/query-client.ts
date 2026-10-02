import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status < 500),
      staleTime: 10_000,
    },
    mutations: { retry: false },
  },
})
