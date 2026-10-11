import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProjectItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import {
  addProjectCategory,
  deleteProjectCategory,
  reorderProjectCategories,
  updateProject,
  updateProjectCategory,
  type UpdateProjectInput,
} from '@/lib/domain-api'

type ProjectRef = Pick<ProjectItem, 'id' | 'orgId' | 'categoryIds'>

function categoryId(project: ProjectRef, name: string): string {
  const id = project.categoryIds?.[name]
  if (!id) throw new Error(`Category "${name}" was not found on the server`)
  return id
}

/**
 * Projects carry their categories, and documents carry the category names they
 * are mapped to, so category changes refresh both.
 */
function useRefresh() {
  const queryClient = useQueryClient()
  return (workspaceId: string, { documents = false } = {}) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
      documents
        ? queryClient.invalidateQueries({
            queryKey: ['documents', workspaceId],
          })
        : undefined,
    ])
}

export function useUpdateProject() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({
      project,
      input,
    }: {
      project: ProjectRef
      input: UpdateProjectInput
    }) => updateProject(project.orgId, project.id, input),
    onSuccess: (_, { project }) => refresh(project.orgId),
    onError: (error) => toast.error(error.message),
  })
}

export function useAddCategory() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({
      project,
      name,
      colorId,
    }: {
      project: ProjectRef
      name: string
      colorId: string
    }) => addProjectCategory(project.orgId, project.id, name, colorId),
    onSuccess: (_, { project }) => refresh(project.orgId),
    onError: (error) => toast.error(error.message),
  })
}

export function useRenameCategory() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({
      project,
      name,
      newName,
      colorId,
    }: {
      project: ProjectRef
      name: string
      newName: string
      colorId: string
    }) =>
      updateProjectCategory(
        project.orgId,
        project.id,
        categoryId(project, name),
        { name: newName, colorId }
      ),
    onSuccess: (_, { project }) => refresh(project.orgId, { documents: true }),
    onError: (error) => toast.error(error.message),
  })
}

export function useDeleteCategory() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ project, name }: { project: ProjectRef; name: string }) =>
      deleteProjectCategory(
        project.orgId,
        project.id,
        categoryId(project, name)
      ),
    onSuccess: (_, { project }) => refresh(project.orgId, { documents: true }),
    onError: (error) => toast.error(error.message),
  })
}

/** The order is applied at once so a dropped chip does not jump back. */
export function useReorderCategories() {
  const queryClient = useQueryClient()
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({
      project,
      names,
    }: {
      project: ProjectRef
      names: string[]
    }) =>
      reorderProjectCategories(
        project.orgId,
        project.id,
        names.map((name) => categoryId(project, name))
      ),
    onMutate: ({ project, names }) => {
      const key = ['projects', project.orgId]
      const previous = queryClient.getQueryData<ProjectItem[]>(key)
      queryClient.setQueryData<ProjectItem[]>(key, (projects) =>
        projects?.map((row) =>
          row.id === project.id ? { ...row, categories: names } : row
        )
      )
      return { key, previous }
    },
    onError: (error, _, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous)
      toast.error(error.message)
    },
    onSettled: (_, __, { project }) => refresh(project.orgId),
  })
}
