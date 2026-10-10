package notification

import (
	"context"
	"errors"
	"strings"
	"testing"

	mailcontract "backend/internal/domain/contract/mail"
	notifycontract "backend/internal/domain/contract/notification"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type fakeMailer struct {
	sent []mailcontract.Message
	fail map[string]bool
}

func (m *fakeMailer) Send(_ context.Context, msg mailcontract.Message) error {
	if m.fail[msg.To] {
		return errors.New("smtp down")
	}
	m.sent = append(m.sent, msg)
	return nil
}

type fakePush struct {
	sent map[uuid.UUID][]notifycontract.PushMessage
	fail bool
}

func (p *fakePush) SendToUser(_ context.Context, userID uuid.UUID, message notifycontract.PushMessage) error {
	if p.fail {
		return errors.New("fcm down")
	}
	if p.sent == nil {
		p.sent = map[uuid.UUID][]notifycontract.PushMessage{}
	}
	p.sent[userID] = append(p.sent[userID], message)
	return nil
}

func delivery(email string, sendEmail, sendPush bool) model.MentionDelivery {
	return model.MentionDelivery{
		UserID: uuid.New(), Email: email, Name: "Dewi",
		Title: "Fikri mentioned you in “Order\nflow”", Body: "can you check this?",
		Path: "/docs/d1?workspaceId=w1&thread=t1", SendEmail: sendEmail, SendPush: sendPush,
	}
}

func TestDeliveryWritesTheEmailAndThePush(t *testing.T) {
	mailer, push := &fakeMailer{}, &fakePush{}
	d := NewMentionDeliverer(mailer, push, "https://docs.example.com/")
	both := delivery("dewi@example.com", true, true)
	d.DeliverNow(context.Background(), []model.MentionDelivery{both})

	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(mailer.sent))
	}
	mail := mailer.sent[0]
	if mail.To != "dewi@example.com" || strings.ContainsAny(mail.Subject, "\r\n") || !strings.Contains(mail.Subject, "mentioned you") {
		t.Fatalf("email header = %q to %q, want one line saying who mentioned them", mail.Subject, mail.To)
	}
	for _, want := range []string{"Dewi", "can you check this?", "https://docs.example.com/docs/d1?workspaceId=w1&thread=t1"} {
		if !strings.Contains(mail.Text, want) {
			t.Errorf("email text lacks %q:\n%s", want, mail.Text)
		}
	}
	got := push.sent[both.UserID]
	if len(got) != 1 || got[0].URL != "https://docs.example.com/docs/d1?workspaceId=w1&thread=t1" || got[0].Body != "can you check this?" {
		t.Fatalf("push = %+v, want one pointing at the comment", got)
	}
}

func TestDeliveryKeepsToTheChannelsAPersonChose(t *testing.T) {
	mailer, push := &fakeMailer{}, &fakePush{}
	d := NewMentionDeliverer(mailer, push, "https://docs.example.com")
	emailOnly, pushOnly := delivery("a@example.com", true, false), delivery("b@example.com", false, true)
	d.DeliverNow(context.Background(), []model.MentionDelivery{emailOnly, pushOnly})
	if len(mailer.sent) != 1 || mailer.sent[0].To != "a@example.com" {
		t.Fatalf("emails = %+v, want only the one who chose email", mailer.sent)
	}
	if len(push.sent[pushOnly.UserID]) != 1 || len(push.sent[emailOnly.UserID]) != 0 {
		t.Fatalf("push = %+v, want only the one who chose push", push.sent)
	}
}

func TestOneFailureDoesNotStopTheRest(t *testing.T) {
	mailer := &fakeMailer{fail: map[string]bool{"first@example.com": true}}
	push := &fakePush{fail: true}
	d := NewMentionDeliverer(mailer, push, "https://docs.example.com")
	d.DeliverNow(context.Background(), []model.MentionDelivery{delivery("first@example.com", true, true), delivery("second@example.com", true, true)})
	if len(mailer.sent) != 1 || mailer.sent[0].To != "second@example.com" {
		t.Fatalf("emails = %+v, want the second still sent after the first failed", mailer.sent)
	}
}

func TestDeliveryWithoutAMailerOrPushIsQuiet(t *testing.T) {
	NewMentionDeliverer(nil, nil, "https://docs.example.com").
		DeliverNow(context.Background(), []model.MentionDelivery{delivery("a@example.com", true, true)})
}
