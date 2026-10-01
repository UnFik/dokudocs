package documentbody

import "fmt"

// MaxCollaborativeNodes is the largest body, counted in AST nodes, that
// collaborative editing supports. See docs/adr/0020 for how it was chosen.
const MaxCollaborativeNodes = 2001

// ErrTooLarge reports a body above MaxCollaborativeNodes. It wraps ErrInvalid.
var ErrTooLarge = fmt.Errorf("%w: body exceeds %d nodes", ErrInvalid, MaxCollaborativeNodes)

// CheckCollaborativeSize rejects a body that may not start collaborative editing.
func CheckCollaborativeSize(body Body) error {
	if len(body.Nodes) > MaxCollaborativeNodes {
		return ErrTooLarge
	}
	return nil
}
