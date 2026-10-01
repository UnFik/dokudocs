package yjs

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

var ErrInvalidProjection = errors.New("invalid collaborative body projection")

// ProjectV1 projects the canonical ProseMirror XML fragment into the AST rows.
func ProjectV1(encodedState []byte, documentID uuid.UUID) (documentbody.Body, error) {
	if len(encodedState) == 0 || documentID == uuid.Nil {
		return documentbody.Body{}, projectionError("state and document id are required")
	}
	doc := crdt.New()
	defer doc.Destroy()
	if err := crdt.ApplyUpdateV1(doc, encodedState, nil); err != nil {
		return documentbody.Body{}, fmt.Errorf("%w: decode Yjs state: %v", ErrInvalidProjection, err)
	}
	body, err := projectDoc(doc, documentID)
	if err != nil {
		return documentbody.Body{}, err
	}
	if err := documentbody.Validate(body); err != nil {
		return documentbody.Body{}, fmt.Errorf("%w: %v", ErrInvalidProjection, err)
	}
	return body, nil
}

// Document is a decoded Yjs state that can take further updates without being
// decoded again. It is not safe for concurrent use.
type Document struct {
	doc *crdt.Doc
}

// LoadDocumentV1 decodes an encoded Yjs state.
func LoadDocumentV1(state []byte) (*Document, error) {
	doc := crdt.New()
	if len(state) > 0 {
		if err := crdt.ApplyUpdateV1(doc, state, nil); err != nil {
			doc.Destroy()
			return nil, fmt.Errorf("%w: decode Yjs state: %v", ErrInvalidProjection, err)
		}
	}
	return &Document{doc: doc}, nil
}

// ApplyAndProjectV1 applies incoming in place and returns the new encoded state
// and its projection. It does not run documentbody.Validate; the caller
// validates the projection against the previous body
// (documentbody.ValidateCollaborativeChange). After an error the document may
// hold a partly applied update and must be closed.
func (d *Document) ApplyAndProjectV1(incoming []byte, documentID uuid.UUID) ([]byte, documentbody.Body, error) {
	if documentID == uuid.Nil {
		return nil, documentbody.Body{}, projectionError("document id is required")
	}
	if err := crdt.ApplyUpdateV1(d.doc, incoming, nil); err != nil {
		return nil, documentbody.Body{}, err
	}
	body, err := projectDoc(d.doc, documentID)
	if err != nil {
		return nil, documentbody.Body{}, err
	}
	return crdt.EncodeStateAsUpdateV1(d.doc, nil), body, nil
}

// Close releases the document.
func (d *Document) Close() {
	if d != nil && d.doc != nil {
		d.doc.Destroy()
		d.doc = nil
	}
}

// MergeAndProjectV1 applies incoming to persisted and projects the result from
// the same decoded document, saving the second decode MergeV1 plus ProjectV1
// would cost. Like ApplyAndProjectV1 it leaves validation to the caller.
func MergeAndProjectV1(persisted, incoming []byte, documentID uuid.UUID) ([]byte, documentbody.Body, error) {
	document, err := LoadDocumentV1(persisted)
	if err != nil {
		return nil, documentbody.Body{}, err
	}
	defer document.Close()
	return document.ApplyAndProjectV1(incoming, documentID)
}

func projectDoc(doc *crdt.Doc, documentID uuid.UUID) (documentbody.Body, error) {
	children := doc.GetXmlFragment("body").Children()
	if len(children) != 1 {
		return documentbody.Body{}, projectionError("body fragment must have one document root")
	}
	root, ok := children[0].(*crdt.YXmlElement)
	if !ok || root.NodeName != "document" {
		return documentbody.Body{}, projectionError("body fragment root must be a document element")
	}
	rootID, err := nodeID(root)
	if err != nil {
		return documentbody.Body{}, err
	}
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: make([]documentbody.Node, 0)}
	if err := appendElement(&body, root, nil, 0); err != nil {
		return documentbody.Body{}, err
	}
	return body, nil
}

func appendElement(body *documentbody.Body, element *crdt.YXmlElement, parentID *uuid.UUID, siblingOrder float64) error {
	nodeID, err := nodeID(element)
	if err != nil {
		return err
	}
	nodeType, ok := nodeTypeFromProseMirror(element.NodeName)
	if !ok {
		return projectionError("unsupported ProseMirror node %q", element.NodeName)
	}
	bodyAttributes, bodyContent, err := elementBodyAttributes(element, nodeID)
	if err != nil {
		return err
	}
	if (isTextOnly(nodeType) || isInlineParent(nodeType) || nodeType == "run") && bodyContent != "" {
		return projectionError("text node %s has unexpected bodyContent", nodeID)
	}
	node := documentbody.Node{
		DocumentID: body.DocumentID, NodeID: nodeID, ParentID: parentID,
		SiblingOrder: siblingOrder, Type: nodeType, Content: bodyContent,
		Attributes: bodyAttributes, Version: 1,
	}
	body.Nodes = append(body.Nodes, node)
	rawChildren := element.Children()
	children := make([]crdtXMLNode, len(rawChildren))
	for index, child := range rawChildren {
		children[index] = child
	}
	if err := appendTextContent(&body.Nodes[len(body.Nodes)-1], nodeType, children); err != nil {
		return err
	}
	if isTextOnly(nodeType) || nodeType == "run" {
		return nil
	}
	var elements []*crdt.YXmlElement
	var directText []*crdt.YXmlText
	for _, child := range children {
		switch value := child.(type) {
		case *crdt.YXmlElement:
			elements = append(elements, value)
		case *crdt.YXmlText:
			directText = append(directText, value)
		default:
			return projectionError("node %s contains unsupported Yjs XML child", nodeID)
		}
	}
	if isInlineParent(nodeType) && len(elements) > 0 && len(directText) > 0 {
		return projectionError("inline parent %s mixes direct text and child nodes", nodeID)
	}
	if !isInlineParent(nodeType) && len(directText) > 0 && !isTextOnly(nodeType) {
		return projectionError("container %s contains direct text", nodeID)
	}
	for index, child := range elements {
		id := nodeID
		if err := appendElement(body, child, &id, float64(index)); err != nil {
			return err
		}
	}
	return nil
}

func appendTextContent(node *documentbody.Node, nodeType string, children []crdtXMLNode) error {
	if nodeType == "opaque" || nodeType == "opaque-inline" || nodeType == "thematic-break" {
		if len(children) > 0 {
			return projectionError("source node %s must be an XML atom", node.NodeID)
		}
		return nil
	}
	var text strings.Builder
	var baseAttributes map[string]json.RawMessage
	if nodeType == "run" {
		if err := json.Unmarshal(node.Attributes, &baseAttributes); err != nil {
			return projectionError("run %s has invalid attributes", node.NodeID)
		}
	}
	var marks map[string]any
	for _, child := range children {
		ytext, ok := child.(*crdt.YXmlText)
		if !ok {
			if nodeType == "run" || isTextOnly(nodeType) {
				return projectionError("text node %s contains a nested element", node.NodeID)
			}
			continue
		}
		for _, delta := range ytext.ToDelta() {
			if delta.Op != crdt.DeltaOpInsert {
				return projectionError("text node %s contains a non-insert delta", node.NodeID)
			}
			chunk, ok := delta.Insert.(string)
			if !ok {
				return projectionError("text node %s contains a non-text embed", node.NodeID)
			}
			text.WriteString(chunk)
			if nodeType == "run" {
				current, err := projectMarks(delta.Attributes)
				if err != nil {
					return fmt.Errorf("%w: %v", ErrInvalidProjection, err)
				}
				if marks != nil && !reflect.DeepEqual(marks, current) {
					return projectionError("run %s has mixed formatting; split it before projection", node.NodeID)
				}
				marks = current
			} else if len(delta.Attributes) > 0 {
				return projectionError("text node %s has marks outside a run", node.NodeID)
			}
		}
	}
	if isTextOnly(nodeType) || nodeType == "run" || isInlineParent(nodeType) {
		node.Content = text.String()
	}
	if nodeType == "run" {
		attributes, err := mergeRunMarks(baseAttributes, marks)
		if err != nil {
			return err
		}
		node.Attributes = attributes
	}
	return nil
}

// crdt.xmlNode is intentionally unexported; this local interface keeps the
// projector independent of the concrete fragment/element child container.
type crdtXMLNode interface {
	ToXML() string
}

func elementBodyAttributes(element *crdt.YXmlElement, id uuid.UUID) (json.RawMessage, string, error) {
	values := element.GetAttributeValues()
	if len(values) != 3 {
		return nil, "", projectionError("node %s must have only nodeID, bodyAttributes, and bodyContent", id)
	}
	for key := range values {
		switch key {
		case "nodeID", "bodyAttributes", "bodyContent":
		default:
			return nil, "", projectionError("node %s has unsupported XML attribute %q", id, key)
		}
	}
	attributeText, ok := values["bodyAttributes"].(string)
	if !ok || !json.Valid([]byte(attributeText)) {
		return nil, "", projectionError("node %s has invalid bodyAttributes", id)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal([]byte(attributeText), &object); err != nil || object == nil {
		return nil, "", projectionError("node %s bodyAttributes must be an object", id)
	}
	canonical, err := json.Marshal(object)
	if err != nil {
		return nil, "", projectionError("node %s bodyAttributes cannot be serialized", id)
	}
	content, ok := values["bodyContent"].(string)
	if !ok {
		return nil, "", projectionError("node %s has invalid bodyContent", id)
	}
	return canonical, content, nil
}

func nodeID(element *crdt.YXmlElement) (uuid.UUID, error) {
	values := element.GetAttributeValues()
	raw, ok := values["nodeID"].(string)
	if !ok {
		return uuid.Nil, projectionError("node %q has no string nodeID", element.NodeName)
	}
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil {
		return uuid.Nil, projectionError("node %q has invalid nodeID", element.NodeName)
	}
	return id, nil
}

func projectMarks(attributes crdt.Attributes) (map[string]any, error) {
	result := make(map[string]any, len(attributes))
	for name, value := range attributes {
		switch name {
		case "strong", "em", "strike", "code":
			if !emptyMarkAttrs(value) {
				return nil, projectionError("mark %q has unsupported attributes", name)
			}
			result[map[string]string{"strong": "bold", "em": "italic", "strike": "strike", "code": "code"}[name]] = true
		case "link":
			var link map[string]any
			if err := decodeObject(value, &link); err != nil {
				return nil, projectionError("link mark has invalid attributes")
			}
			for key := range link {
				if key != "href" && key != "title" {
					return nil, projectionError("link mark has unsupported attribute %q", key)
				}
			}
			href, ok := link["href"].(string)
			if !ok || href == "" {
				return nil, projectionError("link mark requires href")
			}
			result["href"] = href
			if title, ok := link["title"].(string); ok {
				result["linkTitle"] = title
			} else if title, exists := link["title"]; exists && title != nil {
				return nil, projectionError("link mark title must be a string")
			}
		default:
			return nil, projectionError("unsupported text mark %q", name)
		}
	}
	return result, nil
}

func mergeRunMarks(attributes map[string]json.RawMessage, marks map[string]any) (json.RawMessage, error) {
	for _, key := range []string{"bold", "italic", "strike", "code"} {
		if marks[key] == true {
			attributes[key] = json.RawMessage("true")
		} else {
			delete(attributes, key)
		}
	}
	if href, ok := marks["href"].(string); ok {
		encoded, err := json.Marshal(href)
		if err != nil {
			return nil, projectionError("cannot encode link href")
		}
		attributes["href"] = encoded
		if title, exists := marks["linkTitle"]; exists {
			encoded, err := json.Marshal(title)
			if err != nil {
				return nil, projectionError("cannot encode link title")
			}
			attributes["linkTitle"] = encoded
		} else {
			delete(attributes, "linkTitle")
		}
	} else {
		delete(attributes, "href")
		delete(attributes, "linkTitle")
	}
	encoded, err := json.Marshal(attributes)
	if err != nil {
		return nil, projectionError("cannot encode run attributes")
	}
	return encoded, nil
}

func nodeTypeFromProseMirror(name string) (string, bool) {
	switch name {
	case "table_row":
		return "table.row", true
	case "table_cell":
		return "table.cell", true
	case "document", "paragraph", "atx_heading", "setext_heading", "thematic_break", "code_block", "html_block", "link_reference_definition", "block_quote", "order_list", "bullet_list", "task_list", "list_item", "task_list_item", "table", "math_block", "frontmatter", "diagram", "footnote", "opaque", "run", "image", "math", "line_break", "opaque_inline":
		return strings.ReplaceAll(name, "_", "-"), true
	default:
		return "", false
	}
}

func isTextOnly(nodeType string) bool {
	switch nodeType {
	case "code-block", "html-block", "link-reference-definition", "math-block", "frontmatter", "diagram", "math":
		return true
	default:
		return false
	}
}

func isInlineParent(nodeType string) bool {
	switch nodeType {
	case "paragraph", "atx-heading", "setext-heading", "table.cell":
		return true
	default:
		return false
	}
}

func emptyMarkAttrs(value any) bool {
	if value == nil {
		return true
	}
	switch object := value.(type) {
	case map[string]any:
		return len(object) == 0
	case crdt.Attributes:
		return len(object) == 0
	default:
		return false
	}
}

func decodeObject(value any, target any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

func projectionError(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidProjection, fmt.Sprintf(format, args...))
}
