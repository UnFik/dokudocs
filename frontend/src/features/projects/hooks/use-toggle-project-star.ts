import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProjectItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import { toggleProjectStar } from '@/lib/domain-api'

export function useToggleProjectStar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (project: ProjectItem) =>
      toggleProjectStar(project.orgId, project.id),
    onSuccess: async (isStarred, project) => {
      const queryKey = ['projects', project.orgId]
      queryClient.setQueryData<ProjectItem[]>(queryKey, (projects) =>
        projects?.map((row) =>
          row.id === project.id
            ? {
                ...row,
                isStarred,
                starredAt: isStarred ? new Date().toISOString() : null,
              }
            : row
        )
      )
      await queryClient.invalidateQueries({ queryKey })
      toast.success(`${isStarred ? 'Starred' : 'Unstarred'} "${project.name}"`)
    },
    onError: (error) => toast.error(error.message),
  })
}
