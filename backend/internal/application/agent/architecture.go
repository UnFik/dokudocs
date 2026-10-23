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
	Catalog  string  `json:"catalog"`
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

// twin finds the node an add_node would repeat: same kind, name, catalog and parent.
func (c canvas) twin(op operation) (canvasNode, bool) {
	for _, n := range c.Nodes {
		parent := ""
		if n.ParentID != nil {
			parent = *n.ParentID
		}
		if n.Kind == op.text("kind") && strings.EqualFold(n.Name, op.text("name")) && n.Catalog == op.text("catalog") && parent == op.text("parent") {
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

// received says what an operation without a known type did carry, for the Agent and the log.
func (o operation) received() string {
	keys := make([]string, 0, len(o))
	for key := range o {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if t, ok := o["type"]; ok {
		return fmt.Sprintf("it has type %v and the fields %s", t, strings.Join(keys, ", "))
	}
	if len(keys) == 0 {
		return `it is empty; each operation needs a "type"`
	}
	return fmt.Sprintf(`it has no "type" field, only %s`, strings.Join(keys, ", "))
}

func parseOperations(raw json.RawMessage) ([]operation, error) {
	var ops []operation
	if err := json.Unmarshal(raw, &ops); err != nil {
		return nil, &ToolError{Message: "operations must be a list of objects"}
	}
	for i, op := range ops {
		if !architectureOperations[op.text("type")] {
			return nil, &ToolError{Message: fmt.Sprintf("operation %d: type must be one of %s; %s", i+1, architectureOperationList, op.received())}
		}
	}
	return ops, nil
}

const architectureOperationList = "add_node, update_node, move_node, remove_node, add_connection, update_connection, remove_connection, link_document, unlink_document"

var architectureOperations = func() map[string]bool {
	known := map[string]bool{}
	for _, name := range strings.Split(architectureOperationList, ", ") {
		known[name] = true
	}
	return known
}()

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
		// The User approved this exact list of operations, which name elements by id and are
		// checked against the live canvas below. An earlier approval in the same answer moves
		// the version, so refusing here would make a second card fail every time.
		if !actor.Approved {
			return EditResult{}, errStale
		}
		version = live.Version
	}
	ops, err := parseOperations(raw)
	if err != nil {
		return EditResult{}, err
	}
	found, err := s.checkArchitectureOperations(ctx, actor, workspaceID, documentID, parseCanvas(live.Text), ops)
	if err != nil {
		return EditResult{}, err
	}
	if len(found.ops) == 0 {
		return EditResult{Mode: "direct", Version: live.Version, Next: "Everything asked is already on the canvas."}, nil
	}
	if len(found.bare) > 0 || len(found.resolved) > 0 || len(found.ops) != len(ops) {
		if raw, err = json.Marshal(found.ops); err != nil {
			return EditResult{}, err
		}
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
		Uncataloged: found.bare, Resolved: found.resolved, Next: uncatalogedNext(found.bare),
	}, nil
}

// checkElement refuses an element id the Architecture document does not have, and says
// which ids it has. A document that is not a canvas is left to the comment's own checks.
func (s *ContentService) checkElement(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, id string) error {
	read, err := s.Read(ctx, actor, workspaceID, documentID)
	if err != nil || read.Type != "architecture" {
		return err
	}
	r := newRefs(parseCanvas(read.Text))
	if !r.parsed || r.known[id] {
		return nil
	}
	if node, ok := r.byName(id); ok {
		return &ToolError{Message: fmt.Sprintf("element_id must be an id, not a name: use %s for %q", node.ID, node.Name)}
	}
	return &ToolError{Message: fmt.Sprintf("there is no element %q; the ids are %s", id, r.listing())}
}

// Uncataloged is a node drawn without a catalog entry because the catalog has none for it.
type Uncataloged struct {
	Name string `json:"name"`
	Kind string `json:"kind,omitempty"`
}

func uncatalogedNext(bare []Uncataloged) string {
	if len(bare) == 0 {
		return ""
	}
	return "These nodes are drawn without a catalog entry, so they show a plain icon. Tell the User, and offer to ask for the missing entries with request_catalog_entry. Do not send a request unless the User says yes."
}

var errStale = &ToolError{Message: "the version is not the document's current one: it changed since you read it, or it is not the exact version read_document returned; read it again and retry with that version"}

// checkArchitectureOperations refuses what only this side can judge: a slug the catalog
// does not have, a linked document the User cannot read, and a link to the canvas itself. The collaboration service
// judges the shape of the canvas itself.
//
// A catalog slug the catalog does not have and has nothing close to is not refused: the
// node is drawn without a catalog entry and reported back, so the Agent can offer the User
// to request the entry. A slug close to a real one is still refused, as a likely typo.
func (s *ContentService) checkArchitectureOperations(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, c canvas, ops []operation) (checked, error) {
	var entries map[string]catalog.Entry
	var slugs []catalog.Entry
	if s.catalog != nil {
		list, err := s.catalog.List(ctx)
		if err != nil {
			return checked{}, err
		}
		slugs = list
		entries = make(map[string]catalog.Entry, len(list))
		for _, e := range list {
			entries[e.Slug] = e
		}
	}
	kinds := map[string]string{}
	names := map[string]string{}
	var systems []string // "id (Name)" of every System a Connection may end at
	for _, n := range c.Nodes {
		kinds[n.ID] = n.Kind
		names[n.ID] = n.Name
		if n.Kind == "system" {
			systems = append(systems, fmt.Sprintf("%s (%s)", n.ID, n.Name))
		}
	}
	fail := func(i int, format string, args ...any) error {
		return &ToolError{Message: fmt.Sprintf("operation %d: ", i+1) + fmt.Sprintf(format, args...)}
	}
	var drawn []Uncataloged
	// without drops a catalog slug nothing in the catalog resembles; it is then drawn bare.
	without := func(op operation, kind, name string) {
		if !unknownSlug(entries, slugs, kind, op.text("catalog")) {
			return
		}
		delete(op, "catalog")
		drawn = append(drawn, Uncataloged{Name: name, Kind: kind})
	}
	refs := newRefs(c)
	kept := make([]operation, 0, len(ops))
	for i, op := range ops {
		if err := refs.resolve(op); err != nil {
			return checked{}, fail(i, "%s", err.Error())
		}
		drop := false
		switch op.text("type") {
		case "add_node":
			if ref := op.text("ref"); ref != "" {
				kinds[ref] = op.text("kind")
			}
			// What the canvas has is not added again; later operations on its ref use the node that is there.
			if existing, found := c.twin(op); found {
				if ref := op.text("ref"); ref != "" {
					refs.alias[ref] = existing.ID
				}
				drop = true
				break
			}
			if ref := op.text("ref"); ref != "" && op.text("kind") == "system" {
				systems = append(systems, fmt.Sprintf("%s (%s)", ref, op.text("name")))
			}
			without(op, op.text("kind"), op.text("name"))
			if msg := checkSlug(entries, slugs, op.text("kind"), op.text("catalog")); msg != "" {
				return checked{}, fail(i, "%s", msg)
			}
		case "update_node":
			kind, known := kinds[op.text("id")]
			name := op.text("name")
			if name == "" {
				name = names[op.text("id")]
			}
			without(op, kind, name)
			if known {
				if msg := checkSlug(entries, slugs, kind, op.text("catalog")); msg != "" {
					return checked{}, fail(i, "%s", msg)
				}
			} else if msg := checkSlug(entries, slugs, "", op.text("catalog")); msg != "" {
				return checked{}, fail(i, "%s", msg)
			}
		case "add_connection", "update_connection":
			if op.text("type") == "add_connection" {
				for _, end := range []string{"source", "target"} {
					if kind := kinds[op.text(end)]; kind == "host" || kind == "group" {
						return checked{}, fail(i, "%q is a %s, and a Connection joins two Systems; the Systems are %s", names[op.text(end)], title(kind), strings.Join(systems, ", "))
					}
				}
			}
			if msg := checkSlug(entries, slugs, "protocol", op.text("protocol")); msg != "" {
				return checked{}, fail(i, "%s", msg)
			}
		case "link_document":
			id := op.text("document_id")
			if err := s.checkLink(ctx, actor, workspaceID, documentID, id); err != nil {
				var refusal *ToolError
				if errors.As(err, &refusal) {
					return checked{}, fail(i, "%s", refusal.Message)
				}
				return checked{}, err
			}
		}
		if !drop {
			kept = append(kept, op)
		}
	}
	return checked{bare: drawn, resolved: refs.resolved, ops: kept}, nil
}

// checked is what checking the operations found: nodes to draw bare, and names the
// Agent wrote where an id belongs, which were turned into the ids.
type checked struct {
	bare     []Uncataloged
	resolved []Resolved
	// ops are the operations to run: an add_node for what the canvas already has is left out.
	ops []operation
}

// Resolved is a name the Agent wrote where an element id belongs, and the element it meant.
type Resolved struct {
	Asked string `json:"asked"`
	Name  string `json:"name"`
	ID    string `json:"id"`
}

// refs knows every element an operation may name: what is on the canvas and what earlier
// operations of the same call add under a ref.
type refs struct {
	canvas   canvas
	parsed   bool
	known    map[string]bool
	resolved []Resolved
	// alias maps the ref of a node the canvas already has to the id of the node that is there.
	alias map[string]string
}

func newRefs(c canvas) *refs {
	r := &refs{canvas: c, parsed: c.Nodes != nil, known: map[string]bool{}, alias: map[string]string{}}
	for _, n := range c.Nodes {
		r.known[n.ID] = true
	}
	for _, k := range c.Connections {
		r.known[k.ID] = true
	}
	return r
}

// elementKeys are the fields of an operation that name an element already there.
var elementKeys = map[string][]string{
	"add_node":          {"parent"},
	"update_node":       {"id"},
	"move_node":         {"id", "parent"},
	"remove_node":       {"id"},
	"add_connection":    {"source", "target"},
	"update_connection": {"id"},
	"remove_connection": {"id"},
	"link_document":     {"id"},
	"unlink_document":   {"id"},
}

// resolve checks the elements an operation names. A name that is not an id but is the
// name of exactly one node is replaced by that node's id; anything else is refused with the
// ids that exist, so the Agent can correct itself.
func (r *refs) resolve(op operation) error {
	if r.parsed {
		for _, key := range elementKeys[op.text("type")] {
			value := op.text(key)
			if id, ok := r.alias[value]; ok {
				op[key] = id
				continue
			}
			if value == "" || r.known[value] {
				continue
			}
			node, ok := r.byName(value)
			if !ok {
				return fmt.Errorf("there is no element %q; the ids are %s", value, r.listing())
			}
			op[key] = node.ID
			r.resolved = append(r.resolved, Resolved{Asked: value, Name: node.Name, ID: node.ID})
		}
	}
	if ref := op.text("ref"); ref != "" {
		r.known[ref] = true
	}
	return nil
}

func (r *refs) byName(name string) (canvasNode, bool) {
	var found []canvasNode
	for _, n := range r.canvas.Nodes {
		if strings.EqualFold(strings.TrimSpace(n.Name), strings.TrimSpace(name)) {
			found = append(found, n)
		}
	}
	if len(found) != 1 {
		return canvasNode{}, false
	}
	return found[0], true
}

func (r *refs) listing() string {
	const most = 25
	var parts []string
	for _, n := range r.canvas.Nodes {
		parts = append(parts, fmt.Sprintf("%s (%s)", n.ID, n.Name))
	}
	for _, k := range r.canvas.Connections {
		parts = append(parts, fmt.Sprintf("%s (Connection %s to %s)", k.ID, k.Source, k.Target))
	}
	if len(parts) == 0 {
		return "none yet: the canvas is empty"
	}
	more := ""
	if len(parts) > most {
		more = fmt.Sprintf(", and %d more", len(parts)-most)
		parts = parts[:most]
	}
	return strings.Join(parts, ", ") + more + "; read_document gives them all"
}

// unknownSlug is true for a catalog slug that is not an entry and is not close to one.
// Protocols and Groups are never unknown: a Connection needs a real protocol, a Group has
// no catalog entry.
func unknownSlug(entries map[string]catalog.Entry, all []catalog.Entry, kind, slug string) bool {
	if entries == nil || slug == "" || kind == "group" || kind == "protocol" {
		return false
	}
	if _, ok := entries[slug]; ok {
		return false
	}
	return len(nearSlugs(slug, all, kind)) == 0
}

func (s *ContentService) checkLink(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID, raw string) error {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return &ToolError{Message: fmt.Sprintf("you cannot link %q; it is not a document id", raw)}
	}
	if id == documentID {
		return &ToolError{Message: "you cannot link this canvas to itself; link another document"}
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
		return fmt.Sprintf("%q is a %s kind, not a protocol; list_architecture_catalog with category protocol shows the protocols", slug, title(entry.Category))
	case entry.Category == "protocol":
		return fmt.Sprintf("%q is a protocol, not a %s kind", slug, title(kind))
	}
	return fmt.Sprintf("%q is a %s kind, not a %s kind; it goes on a %s node", slug, title(entry.Category), title(kind), title(entry.Category))
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
	// A change the server would refuse is refused before the User is asked to approve it.
	found, err := s.checkArchitectureOperations(ctx, actor, workspaceID, documentID, parseCanvas(live.Text), ops)
	if err != nil {
		return "", err
	}
	if ops = found.ops; len(ops) == 0 {
		return "", nil
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
