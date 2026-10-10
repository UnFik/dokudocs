package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"backend/internal/domain/mention"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const (
	mentionKind = "comment_mention"
	// externalCooldown is how long email and push for one message hold off after
	// they were sent, so fixing a typo does not send them again.
	externalCooldown = "10 minutes"
	snippetLength    = 160
)

// mentionNotice is one message that names people.
type mentionNotice struct {
	workspaceID, documentID, threadID uuid.UUID
	// commentID is the thread for its first message, or the reply.
	commentID uuid.UUID
	actorID   uuid.UUID
	mentioned []uuid.UUID
	content   string
}

// channelPrefs are what a person chose for notifications; whatever they did not
// choose is on.
type channelPrefs struct{ InApp, Email, Push bool }

func readChannelPrefs(ctx context.Context, tx database.Queryer, userID uuid.UUID) (channelPrefs, error) {
	prefs := channelPrefs{InApp: true, Email: true, Push: true}
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT notification_prefs FROM user_settings WHERE user_id = $1`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return prefs, nil
	}
	if err != nil {
		return prefs, err
	}
	var chosen map[string]bool
	if json.Unmarshal(raw, &chosen) != nil {
		return prefs, nil
	}
	if value, ok := chosen["in_app"]; ok {
		prefs.InApp = value
	}
	if value, ok := chosen["email"]; ok {
		prefs.Email = value
	}
	if value, ok := chosen["push"]; ok {
		prefs.Push = value
	}
	return prefs, nil
}

func snippet(content string) string {
	text := strings.Join(strings.Fields(mention.Visible(content)), " ")
	if utf8.RuneCountInString(text) > snippetLength {
		text = strings.TrimSpace(string([]rune(text)[:snippetLength])) + "…"
	}
	return text
}

// notifyMentions records a notification for each person a message names, in the
// transaction that saved the message, and says whom email or push should reach.
// A message that is edited tells them again: an unread notification for it is
// updated in place, and email and push wait out a cooldown.
func notifyMentions(ctx context.Context, tx database.Queryer, notice mentionNotice) ([]model.MentionDelivery, error) {
	if len(notice.mentioned) == 0 {
		return nil, nil
	}
	var actorName, title string
	if err := tx.QueryRowContext(ctx, `SELECT full_name FROM users WHERE id = $1`, notice.actorID).Scan(&actorName); err != nil {
		return nil, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT title FROM documents WHERE id = $1`, notice.documentID).Scan(&title); err != nil {
		return nil, err
	}
	heading := fmt.Sprintf("%s mentioned you in “%s”", actorName, title)
	body := snippet(notice.content)
	path := fmt.Sprintf("/docs/%s?workspaceId=%s&thread=%s", notice.documentID, notice.workspaceID, notice.threadID)

	var deliveries []model.MentionDelivery
	seen := make(map[uuid.UUID]bool, len(notice.mentioned))
	for _, userID := range notice.mentioned {
		if userID == notice.actorID || seen[userID] {
			continue
		}
		seen[userID] = true
		prefs, err := readChannelPrefs(ctx, tx, userID)
		if err != nil {
			return nil, err
		}
		send := true
		if prefs.InApp {
			err = tx.QueryRowContext(ctx, `
				INSERT INTO notifications (user_id, kind, title, body, workspace_id, document_id, thread_id, comment_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (user_id, comment_id) WHERE kind = 'comment_mention' AND read_at IS NULL
				DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, created_at = NOW()
				RETURNING delivered_at IS NULL OR delivered_at < NOW() - INTERVAL '`+externalCooldown+`'
			`, userID, mentionKind, heading, body, notice.workspaceID, notice.documentID, notice.threadID, notice.commentID).Scan(&send)
			if err != nil {
				return nil, err
			}
		}
		if !send || !(prefs.Email || prefs.Push) {
			continue
		}
		if prefs.InApp {
			if _, err := tx.ExecContext(ctx, `
				UPDATE notifications SET delivered_at = NOW()
				WHERE user_id = $1 AND comment_id = $2 AND kind = $3 AND read_at IS NULL
			`, userID, notice.commentID, mentionKind); err != nil {
				return nil, err
			}
		}
		delivery := model.MentionDelivery{
			UserID: userID, Title: heading, Body: body, Path: path,
			SendEmail: prefs.Email, SendPush: prefs.Push,
		}
		if err := tx.QueryRowContext(ctx, `SELECT email, full_name FROM users WHERE id = $1`, userID).Scan(&delivery.Email, &delivery.Name); err != nil {
			return nil, err
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, nil
}
