// Package notification sends what a mention owes beyond the app.
package notification

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	mailcontract "backend/internal/domain/contract/mail"
	notifycontract "backend/internal/domain/contract/notification"
	"backend/internal/domain/model"
)

// sendTimeout bounds one batch: the request that caused it is long gone.
const sendTimeout = time.Minute

// MentionDeliverer emails and pushes the people a comment names. A channel that
// is not configured is skipped, and a failure is logged, never raised: the
// comment is already saved.
type MentionDeliverer struct {
	mailer mailcontract.Mailer
	push   notifycontract.PushSender
	appURL string
}

// NewMentionDeliverer links to the app at appURL. Either channel may be nil.
func NewMentionDeliverer(mailer mailcontract.Mailer, push notifycontract.PushSender, appURL string) *MentionDeliverer {
	return &MentionDeliverer{mailer: mailer, push: push, appURL: strings.TrimRight(appURL, "/")}
}

// Deliver sends in the background so the person who commented does not wait on
// a mail server.
func (d *MentionDeliverer) Deliver(ctx context.Context, deliveries []model.MentionDelivery) {
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), sendTimeout)
		defer cancel()
		d.DeliverNow(ctx, deliveries)
	}()
}

// DeliverNow sends and returns once every attempt is done.
func (d *MentionDeliverer) DeliverNow(ctx context.Context, deliveries []model.MentionDelivery) {
	for _, delivery := range deliveries {
		link := d.appURL + delivery.Path
		if delivery.SendEmail && d.mailer != nil && delivery.Email != "" {
			err := d.mailer.Send(ctx, mailcontract.Message{
				To:      delivery.Email,
				Subject: oneLine(delivery.Title),
				Text: fmt.Sprintf("%s,\n\n%s:\n\n%s\n\nOpen the comment: %s\n\n"+
					"You get this because you were mentioned. Change which notifications you get in Settings.\n",
					delivery.Name, oneLine(delivery.Title), delivery.Body, link),
			})
			if err != nil {
				slog.WarnContext(ctx, "mention email not sent", "user_id", delivery.UserID, "error", err)
			}
		}
		if delivery.SendPush && d.push != nil {
			err := d.push.SendToUser(ctx, delivery.UserID, notifycontract.PushMessage{
				Title: oneLine(delivery.Title), Body: delivery.Body, URL: link,
			})
			if err != nil {
				slog.WarnContext(ctx, "mention push not sent", "user_id", delivery.UserID, "error", err)
			}
		}
	}
}

func oneLine(text string) string { return strings.Join(strings.Fields(text), " ") }
