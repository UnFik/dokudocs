import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { listWorkspaces } from '@/lib/domain-api'

export function useWorkspaces() {
  const user = useAuthStore((state) => state.auth.user)
  const selectedWorkspaceId = useDokudocsStore((state) => state.activeOrgId)
  const setActiveOrgId = useDokudocsStore((state) => state.setActiveOrgId)
  const query = useQuery({
    queryKey: ['workspaces', user?.id],
    queryFn: ({ signal }) => listWorkspaces(signal),
    enabled: Boolean(user?.id),
  })
  const workspaces = query.data ?? []
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    workspaces[0]

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId: activeWorkspace?.id ?? '',
    setActiveWorkspace: setActiveOrgId,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}
