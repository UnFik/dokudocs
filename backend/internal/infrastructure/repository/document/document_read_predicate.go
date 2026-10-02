package document

import "fmt"

// documentReadPredicate applies the effective read and draft rules to alias d for actor $2.
const documentReadPredicate = `
		  AND EXISTS (
			SELECT 1 FROM workspace_members wm
			WHERE wm.workspace_id = d.workspace_id AND wm.user_id = $2
		  )
		  AND (
			EXISTS (
				SELECT 1 FROM workspace_members wm
				WHERE wm.workspace_id = d.workspace_id AND wm.user_id = $2 AND wm.role IN ('owner', 'admin')
			)
			OR EXISTS (
				SELECT 1 FROM document_accesses da_read
				WHERE da_read.document_id = d.id AND da_read.user_id = $2
			)
			OR (d.visibility IN ('private', 'public_link') AND d.author_id = $2)
			OR d.visibility = 'workspace'
			OR (
				d.visibility = 'inherit' AND (
					d.project_id IS NULL
					OR EXISTS (
						SELECT 1 FROM projects p_access
						WHERE p_access.id = d.project_id
						  AND p_access.workspace_id = d.workspace_id
						  AND p_access.deleted_at IS NULL
						  AND p_access.visibility = 'workspace'
					)
					OR EXISTS (
						SELECT 1 FROM projects p_access
						JOIN project_members pm_access ON pm_access.project_id = p_access.id AND pm_access.user_id = $2
						WHERE p_access.id = d.project_id
						  AND p_access.workspace_id = d.workspace_id
						  AND p_access.deleted_at IS NULL
						  AND p_access.visibility = 'private'
					)
				)
			)
		  )
		  AND (
			d.is_draft = FALSE
			OR d.author_id = $2
			OR EXISTS (
				SELECT 1 FROM workspace_members wm_edit
				WHERE wm_edit.workspace_id = d.workspace_id AND wm_edit.user_id = $2 AND wm_edit.role IN ('owner', 'admin')
			)
			OR EXISTS (
				SELECT 1 FROM document_accesses da_edit
				WHERE da_edit.document_id = d.id AND da_edit.user_id = $2 AND da_edit.access_level IN ('owner', 'edit')
			)
			OR EXISTS (
				SELECT 1 FROM projects p_edit
				JOIN project_members pm_edit ON pm_edit.project_id = p_edit.id AND pm_edit.user_id = $2
				WHERE p_edit.id = d.project_id
				  AND d.visibility IN ('inherit', 'workspace')
				  AND p_edit.workspace_id = d.workspace_id
				  AND p_edit.deleted_at IS NULL
				  AND pm_edit.role IN ('manager', 'editor')
			)
		  )
`

// documentProjectMetadataPredicate checks whether actorPlaceholder may see project-owned metadata.
const documentProjectMetadataPredicate = `(
	%s.visibility = 'workspace'
	OR EXISTS (
		SELECT 1 FROM workspace_members wm_project_metadata
		WHERE wm_project_metadata.workspace_id = d.workspace_id
		  AND wm_project_metadata.user_id = %s
		  AND wm_project_metadata.role IN ('owner', 'admin')
	)
	OR EXISTS (
		SELECT 1 FROM project_members pm_project_metadata
		WHERE pm_project_metadata.project_id = %s.id
		  AND pm_project_metadata.user_id = %s
	)
)`

func projectMetadataPredicate(actorPlaceholder, projectAlias string) string {
	return fmt.Sprintf(documentProjectMetadataPredicate, projectAlias, actorPlaceholder, projectAlias, actorPlaceholder)
}
