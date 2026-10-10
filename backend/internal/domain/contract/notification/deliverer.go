package notification

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// MentionDeliverer sends what a mention owes beyond the app: email and push.
// It never fails the comment, so it reports nothing back.
type MentionDeliverer interface {
	Deliver(ctx context.Context, deliveries []model.MentionDelivery)
}

// PushMessage is a notification for a browser or phone.
type PushMessage struct {
	Title string
	Body  string
	// URL is the absolute address to open when it is tapped.
	URL string
}

// PushSender sends a message to every device a person registered. A device that
// is gone is dropped by the sender; having none is not an error.
type PushSender interface {
	SendToUser(ctx context.Context, userID uuid.UUID, message PushMessage) error
}
