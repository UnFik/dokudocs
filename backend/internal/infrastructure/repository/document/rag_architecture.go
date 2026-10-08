package document

import (
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

type ragCanvas struct {
	Nodes []struct {
		ID          string   `json:"id"`
		Kind        string   `json:"kind"`
		Name        string   `json:"name"`
		Catalog     *string  `json:"catalog"`
		Tags        []string `json:"tags"`
		ParentID    *string  `json:"parentId"`
		Description string   `json:"description"`
	} `json:"nodes"`
	Connections []struct {
		Source   string `json:"source"`
		Target   string `json:"target"`
		Protocol string `json:"protocol"`
		Label    string `json:"label"`
	} `json:"connections"`
}

// renderArchitectureRAG indexes a canvas one element at a time, so an answer can
// cite the System it came from and the reader can jump to it.
func renderArchitectureRAG(contentJSON []byte) []renderedRAGChunk {
	var canvas ragCanvas
	if json.Unmarshal(contentJSON, &canvas) != nil {
		return nil
	}
	byID := map[string]int{}
	for i, n := range canvas.Nodes {
		byID[n.ID] = i
	}
	parentOf := func(id string) (string, string, bool) {
		i, ok := byID[id]
		if !ok || canvas.Nodes[i].ParentID == nil {
			return "", "", false
		}
		p, ok := byID[*canvas.Nodes[i].ParentID]
		if !ok {
			return "", "", false
		}
		return canvas.Nodes[p].ID, canvas.Nodes[p].Kind, true
	}
	label := func(kind string) string {
		if kind == "" {
			return ""
		}
		return strings.ToUpper(kind[:1]) + kind[1:]
	}
	var chunks []renderedRAGChunk
	for _, n := range canvas.Nodes {
		tech := []string{}
		if n.Catalog != nil && *n.Catalog != "" {
			tech = append(tech, *n.Catalog)
		}
		tech = append(tech, n.Tags...)
		var text strings.Builder
		text.WriteString(label(n.Kind) + ` "` + n.Name + `"`)
		if len(tech) > 0 {
			text.WriteString(" (" + strings.Join(tech, "; ") + ")")
		}
		// Where it runs: the nearest Host above it; Groups only gather.
		var breadcrumb []string
		for id, cur := n.ID, ""; ; id = cur {
			parentID, kind, ok := parentOf(id)
			if !ok {
				break
			}
			cur = parentID
			breadcrumb = append([]string{canvas.Nodes[byID[parentID]].Name}, breadcrumb...)
			if kind == "host" && n.Kind != "group" && !strings.Contains(text.String(), " runs on ") {
				text.WriteString(` runs on Host "` + canvas.Nodes[byID[parentID]].Name + `"`)
			}
		}
		text.WriteString(".")
		if n.Description != "" {
			text.WriteString(" " + n.Description)
		}
		for _, c := range canvas.Connections {
			if c.Source != n.ID {
				continue
			}
			if t, ok := byID[c.Target]; ok {
				text.WriteString(` Calls "` + canvas.Nodes[t].Name + `" over ` + c.Protocol)
				if c.Label != "" {
					text.WriteString(" (" + c.Label + ")")
				}
				text.WriteString(".")
			}
		}
		id, err := uuid.Parse(n.ID)
		if err != nil {
			id = uuid.NewSHA1(ragNodeNamespace, []byte(n.ID))
		}
		chunks = append(chunks, renderedRAGChunk{nodeID: id, text: text.String(), breadcrumb: strings.Join(breadcrumb, " › ")})
	}
	return chunks
}
