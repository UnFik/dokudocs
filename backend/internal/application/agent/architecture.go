package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"backend/constant"
	"backend/internal/application/catalog"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

// ArchitectureCatalog is the built-in list of kinds and protocols a canvas draws with.
type ArchitectureCatalog interface {
	List(ctx context.Context) ([]catalog.Entry, error)
}

// WithCatalog lets the service check the catalog slugs an Agent writes.
func (s *ContentService) WithCatalog(c ArchitectureCatalog) *ContentService {
	s.catalog = c
	return s
}

type canvasNode struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	ParentID *string `json:"parentId"`
	Name     string  `json:"name"`
}

type canvasConnection struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type canvas struct {
	Nodes       []canvasNode       `json:"nodes"`
	Connections []canvasConnection `json:"connections"`
}

func parseCanvas(text string) canvas {
	var c canvas
	_ = json.Unmarshal([]byte(text), &c)
	return c
}

func (c canvas) node(id string) (canvasNode, bool) {
	for _, n := range c.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return canvasNode{}, false
}

func (c canvas) connection(id string) (canvasConnection, bool) {
	for _, k := range c.Connections {
		if k.ID == id {
			return k, true
		}
	}
	return canvasConnection{}, false
}

// inside is every node held by id, at any depth.
func (c canvas) inside(id string) []canvasNode {
	held := map[string]bool{id: true}
	var out []canvasNode
	for grew := true; grew; {
		grew = false
		for _, n := range c.Nodes {
			if n.ParentID != nil && held[*n.ParentID] && !held[n.ID] {
				held[n.ID] = true
				out = append(out, n)
				grew = true
			}
		}
	}
	return out
}

type operation map[string]any

func (o operation) text(key string) string {
	s, _ := o[key].(string)
	return s
}

func parseOperations(raw json.RawMessage) ([]operation, error) {
	var ops []operation
	if err := json.Unmarshal(raw, &ops); err != nil {
		return nil, &ToolError{Message: "operations must be a list of objects"}
	}
	return ops, nil
}

func title(word string) string {
	if word == "" {
		return word
	}
	return strings.ToUpper(word[:1]) + word[1:]
}

// EditArchitecture applies operations to a canvas for an editor: the change lands
// directly after a named version, and a person who can only suggest or comment cannot
// make it (a canvas has no suggestions).
func (s *ContentService) EditArchitecture(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, version string, raw json.RawMessage) (EditResult, error) {
	head, access, err := s.head(ctx, actor, workspaceID, documentID)
	if err != nil {
		return EditResult{}, err
	}
	if head.DocumentType != "architecture" {
		return EditResult{}, &ToolError{Message: "this is not an Architecture document; use edit_document_content"}
	}
	if !access.CanEdit {
		return EditResult{}, constant.ErrForbidden
	}
	room := roomName(workspaceID, documentID, head)
	live, err := s.rooms.Read(ctx, room, head.DocumentType)
	if err != nil {
		return EditResult{}, err
	}
	if version != "" && live.Version != version {
		return EditResult{}, errStale
	}
	ops, err := parseOperations(raw)
	if err != nil {
		return EditResult{}, err
	}
	if err := s.checkArchitectureOperations(ctx, actor, workspaceID, parseCanvas(live.Text), ops); err != nil {
		return EditResult{}, err
	}
	title := "Before AI edit from chat"
	if actor.Channel == ChannelMCP {
		title = fmt.Sprintf("Before AI edit, key %s", actor.KeyName)
	}
	revision, err := s.revisions.CreateNamed(ctx, documentID, workspaceID, actor.UserID, truncate(title, 120))
	if err != nil {
		return EditResult{}, err
	}
	edited, err := s.rooms.Edit(ctx, LiveEdit{
		Room: room, Type: head.DocumentType, UserID: actor.UserID.String(), Mode: "direct", BaseVersion: version, Operations: raw,
	})
	if err != nil {
		var conflict *ConflictError
		if errors.As(err, &conflict) {
			return EditResult{}, errStale
		}
		return EditResult{}, err
	}
	return EditResult{
		Mode: "direct", Version: edited.Version, RevisionID: revision.ID,
		Created: edited.Created, RemovedNodes: edited.RemovedNodes, RemovedConnections: edited.RemovedConnections,
	}, nil
}

var errStale = &ToolError{Message: "the document changed since you read it; read it again and retry with the new version"}

// checkArchitectureOperations refuses what only this side can judge: a slug the catalog
// does not have, and a linked document the User cannot read. The collaboration service
// judges the shape of the canvas itself.
func (s *ContentService) checkArchitectureOperations(ctx context.Context, actor Actor, workspaceID uuid.UUID, c canvas, ops []operation) error {
	var entries map[string]catalog.Entry
	var slugs []catalog.Entry
	if s.catalog != nil {
		list, err := s.catalog.List(ctx)
		if err != nil {
			return err
		}
		slugs = list
		entries = make(map[string]catalog.Entry, len(list))
		for _, e := range list {
			entries[e.Slug] = e
		}
	}
	kinds := map[string]string{}
	for _, n := range c.Nodes {
		kinds[n.ID] = n.Kind
	}
	fail := func(i int, format string, args ...any) error {
		return &ToolError{Message: fmt.Sprintf("operation %d: ", i+1) + fmt.Sprintf(format, args...)}
	}
	for i, op := range ops {
		switch op.text("type") {
		case "add_node":
			if ref := op.text("ref"); ref != "" {
				kinds[ref] = op.text("kind")
			}
			if msg := checkSlug(entries, slugs, op.text("kind"), op.text("catalog")); msg != "" {
				return fail(i, "%s", msg)
			}
		case "update_node":
			if kind, ok := kinds[op.text("id")]; ok {
				if msg := checkSlug(entries, slugs, kind, op.text("catalog")); msg != "" {
					return fail(i, "%s", msg)
				}
			} else if msg := checkSlug(entries, slugs, "", op.text("catalog")); msg != "" {
				return fail(i, "%s", msg)
			}
		case "add_connection", "update_connection":
			if msg := checkSlug(entries, slugs, "protocol", op.text("protocol")); msg != "" {
				return fail(i, "%s", msg)
			}
		case "link_document":
			id := op.text("document_id")
			if err := s.checkLink(ctx, actor, workspaceID, id); err != nil {
				var refusal *ToolError
				if errors.As(err, &refusal) {
					return fail(i, "%s", refusal.Message)
				}
				return err
			}
		}
	}
	return nil
}

func (s *ContentService) checkLink(ctx context.Context, actor Actor, workspaceID uuid.UUID, raw string) error {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return &ToolError{Message: fmt.Sprintf("you cannot link %q; it is not a document id", raw)}
	}
	denied := &ToolError{Message: fmt.Sprintf("you cannot link %s; it does not exist in this workspace or you cannot read it", id)}
	head, err := s.heads.ReadRoomHead(ctx, workspaceID, id, []uuid.UUID{actor.UserID})
	if errors.Is(err, collaboration.ErrCollabDocumentNotFound) {
		return denied
	}
	if err != nil {
		return err
	}
	if !head.Access[actor.UserID].CanRead {
		return denied
	}
	return nil
}

// checkSlug says what is wrong with a slug for a kind ("host", "system", "group" or
// "protocol"), or "" when it is fine. A kind of "" means the caller does not know it.
func checkSlug(entries map[string]catalog.Entry, all []catalog.Entry, kind, slug string) string {
	if slug == "" || entries == nil {
		return ""
	}
	if kind == "group" {
		return "a Group has no catalog entry"
	}
	entry, ok := entries[slug]
	if !ok {
		what := "catalog entry"
		if kind == "protocol" {
			what = "protocol"
		}
		if near := nearSlugs(slug, all, kind); len(near) > 0 {
			return fmt.Sprintf("there is no %s %q; did you mean %s?", what, slug, orList(near))
		}
		return fmt.Sprintf("there is no %s %q; see list_architecture_catalog", what, slug)
	}
	switch {
	case kind == "":
		return ""
	case entry.Category == kind:
		return ""
	case kind == "protocol":
		return fmt.Sprintf("%q is a %s kind, not a protocol", slug, title(entry.Category))
	case entry.Category == "protocol":
		return fmt.Sprintf("%q is a protocol, not a %s kind", slug, title(kind))
	}
	return fmt.Sprintf("%q is a %s kind, not a %s kind", slug, title(entry.Category), title(kind))
}

func orList(items []string) string {
	if len(items) == 1 {
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " or " + items[len(items)-1]
}

// nearSlugs are up to three slugs of the wanted category that a mistyped one is close to.
func nearSlugs(slug string, all []catalog.Entry, kind string) []string {
	type scored struct {
		slug     string
		distance int
	}
	limit := max(2, len(slug)/3)
	var found []scored
	for _, e := range all {
		if kind != "" && e.Category != kind {
			continue
		}
		if d := distance(slug, e.Slug); d <= limit {
			found = append(found, scored{e.Slug, d})
		}
	}
	sort.Slice(found, func(i, j int) bool {
		if found[i].distance != found[j].distance {
			return found[i].distance < found[j].distance
		}
		return found[i].slug < found[j].slug
	})
	var out []string
	for _, f := range found[:min(3, len(found))] {
		out = append(out, f.slug)
	}
	return out
}

func distance(a, b string) int {
	prev := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur := make([]int, len(b)+1)
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(b)]
}

const summaryLines = 8

// ArchitectureSummary is what the User is asked to approve, written here from the
// operations and the live canvas so the model cannot soften what will happen.
func (s *ContentService) ArchitectureSummary(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, raw json.RawMessage) (string, error) {
	head, _, err := s.head(ctx, actor, workspaceID, documentID)
	if err != nil {
		return "", err
	}
	if head.DocumentType != "architecture" {
		return "", &ToolError{Message: "this is not an Architecture document; use edit_document_content"}
	}
	live, err := s.rooms.Read(ctx, roomName(workspaceID, documentID, head), head.DocumentType)
	if err != nil {
		return "", err
	}
	ops, err := parseOperations(raw)
	if err != nil {
		return "", err
	}
	d := describer{canvas: parseCanvas(live.Text), names: map[string]string{}, kinds: map[string]string{}}
	var lines []string
	for _, op := range ops {
		lines = append(lines, d.describe(op))
	}
	shown := lines[:min(summaryLines, len(lines))]
	out := "Change the Architecture diagram:\n- " + strings.Join(shown, "\n- ")
	if more := len(lines) - len(shown); more == 1 {
		out += "\n- and 1 more change"
	} else if more > 1 {
		out += fmt.Sprintf("\n- and %d more changes", more)
	}
	return out, nil
}

type describer struct {
	canvas canvas
	names  map[string]string
	kinds  map[string]string
}

func (d describer) name(id string) string {
	if n, ok := d.names[id]; ok {
		return fmt.Sprintf("%q", n)
	}
	if n, ok := d.canvas.node(id); ok {
		return fmt.Sprintf("%q", n.Name)
	}
	return fmt.Sprintf("%q", id)
}

func (d describer) kind(id string) string {
	if k, ok := d.kinds[id]; ok {
		return title(k)
	}
	if n, ok := d.canvas.node(id); ok {
		return title(n.Kind)
	}
	return ""
}

func (d describer) connection(id string) string {
	if k, ok := d.canvas.connection(id); ok {
		return fmt.Sprintf("the Connection from %s to %s", d.name(k.Source), d.name(k.Target))
	}
	return fmt.Sprintf("the Connection %q", id)
}

func (d describer) target(id string) string {
	if _, ok := d.canvas.connection(id); ok {
		return d.connection(id)
	}
	return d.name(id)
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func (d describer) describe(op operation) string {
	id := op.text("id")
	switch op.text("type") {
	case "add_node":
		kind := title(op.text("kind"))
		if ref := op.text("ref"); ref != "" {
			d.names[ref] = op.text("name")
			d.kinds[ref] = op.text("kind")
		}
		line := fmt.Sprintf("Add %s %q", kind, op.text("name"))
		if parent := op.text("parent"); parent != "" {
			if k := d.kind(parent); k != "" {
				line += fmt.Sprintf(" inside %s %s", k, d.name(parent))
			} else {
				line += " inside " + d.name(parent)
			}
		}
		return line
	case "update_node":
		var fields []string
		for _, key := range []string{"name", "catalog", "tags", "description", "repoUrl"} {
			if _, ok := op[key]; ok {
				fields = append(fields, key)
			}
		}
		if len(fields) == 1 && fields[0] == "name" {
			return fmt.Sprintf("Rename %s to %q", d.name(id), op.text("name"))
		}
		return fmt.Sprintf("Change %s of %s", strings.Join(fields, ", "), d.name(id))
	case "move_node":
		if parent, ok := op["parent"]; ok {
			if parent == nil {
				return fmt.Sprintf("Move %s to the top level", d.name(id))
			}
			p := op.text("parent")
			if k := d.kind(p); k != "" {
				return fmt.Sprintf("Move %s into %s %s", d.name(id), k, d.name(p))
			}
			return fmt.Sprintf("Move %s into %s", d.name(id), d.name(p))
		}
		if _, w := op["w"]; w {
			return fmt.Sprintf("Resize %s", d.name(id))
		}
		if _, h := op["h"]; h {
			return fmt.Sprintf("Resize %s", d.name(id))
		}
		return fmt.Sprintf("Move %s on the canvas", d.name(id))
	case "remove_node":
		node, ok := d.canvas.node(id)
		if !ok {
			return fmt.Sprintf("Remove %s", d.name(id))
		}
		return d.removal(node)
	case "add_connection":
		if ref := op.text("ref"); ref != "" {
			d.names[ref] = ref
		}
		return fmt.Sprintf("Connect %s to %s over %s", d.name(op.text("source")), d.name(op.text("target")), op.text("protocol"))
	case "update_connection":
		return "Change " + d.connection(id)
	case "remove_connection":
		return "Remove " + d.connection(id)
	case "link_document":
		return "Link a document to " + d.target(id)
	case "unlink_document":
		return "Unlink a document from " + d.target(id)
	}
	return fmt.Sprintf("Run %q", op.text("type"))
}

// removal says what disappears with a node: what it holds and the Connections that touch it.
func (d describer) removal(node canvasNode) string {
	held := d.canvas.inside(node.ID)
	gone := map[string]bool{node.ID: true}
	counts := map[string]int{}
	for _, n := range held {
		gone[n.ID] = true
		counts[n.Kind]++
	}
	connections := 0
	for _, c := range d.canvas.Connections {
		if gone[c.Source] || gone[c.Target] {
			connections++
		}
	}
	var parts []string
	for _, kind := range []string{"host", "group", "system"} {
		if counts[kind] > 0 {
			parts = append(parts, plural(counts[kind], title(kind)))
		}
	}
	if connections > 0 {
		parts = append(parts, plural(connections, "Connection"))
	}
	line := fmt.Sprintf("Remove %s %q", title(node.Kind), node.Name)
	switch {
	case len(parts) == 0:
		return line
	case len(held) == 0:
		return line + " and " + parts[0]
	case len(parts) == 1:
		return line + " with " + parts[0]
	}
	return line + " with " + strings.Join(parts[:len(parts)-1], ", ") + " and " + parts[len(parts)-1]
}
