import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProjectItem, ProjectMemberRole } from '@/types/dokudocs'
import { toast } from 'sonner'
import {
  listProjectMembers,
  removeProjectMember,
  setProjectMember,
} from '@/lib/domain-api'

type ProjectRef = Pick<ProjectItem, 'id' | 'orgId'>

const membersKey = (project: ProjectRef) => [
  'project-members',
  project.orgId,
  project.id,
]

export function useProjectMembers(project: ProjectRef, enabled: boolean) {
  return useQuery({
    queryKey: membersKey(project),
    queryFn: ({ signal }) =>
      listProjectMembers(project.orgId, project.id, signal),
    enabled,
  })
}

export function useSetProjectMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      project,
      email,
      role,
    }: {
      project: ProjectRef
      email: string
      role: ProjectMemberRole
    }) => setProjectMember(project.orgId, project.id, email, role),
    onSuccess: (_, { project }) =>
      queryClient.invalidateQueries({ queryKey: membersKey(project) }),
    onError: (error) => toast.error(error.message),
  })
}

export function useRemoveProjectMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      project,
      userId,
    }: {
      project: ProjectRef
      userId: string
    }) => removeProjectMember(project.orgId, project.id, userId),
    onSuccess: (_, { project }) =>
      queryClient.invalidateQueries({ queryKey: membersKey(project) }),
    onError: (error) => toast.error(error.message),
  })
}
