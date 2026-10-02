package collaboration

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

type writerFunc func(context.Context, Actor, Update) (CommitReceipt, error)

func (f writerFunc) CommitUpdate(ctx context.Context, actor Actor, update Update) (CommitReceipt, error) {
	return f(ctx, actor, update)
}

type fanoutFunc func(context.Context, CommitReceipt, Update) error

func (f fanoutFunc) Publish(ctx context.Context, receipt CommitReceipt, update Update) error {
	return f(ctx, receipt, update)
}

func TestTransportCanAckDurableReceiptBeforeFanout(t *testing.T) {
	docID, actorID, updateID := uuid.New(), uuid.New(), uuid.New()
	var events []string
	writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
		events = append(events, "commit")
		return CommitReceipt{DocumentID: docID, UpdateID: updateID, BodyEpoch: 3, BodyVersion: 9, Changed: true}, nil
	})
	fanout := fanoutFunc(func(_ context.Context, receipt CommitReceipt, update Update) error {
		if receipt.BodyVersion != 9 || string(update.Bytes) != "edit" || update.BodySchemaVersion != 1 {
			t.Fatalf("published receipt/update = %+v/%+v", receipt, update)
		}
		if events[len(events)-1] != "ack" {
			t.Fatalf("fanout ran before ACK: %v", events)
		}
		events = append(events, "fanout")
		return nil
	})

	useCase := NewUseCase(writer, fanout)
	receipt, err := useCase.Apply(context.Background(), Actor{UserID: actorID}, Update{
		DocumentID: docID, UpdateID: updateID, BodyEpoch: 3, BodySchemaVersion: 1, Bytes: []byte("edit"),
	})
	if err != nil {
		t.Fatalf("apply update: %v", err)
	}
	if receipt.BodyVersion != 9 {
		t.Fatalf("ACK version = %d, want 9", receipt.BodyVersion)
	}
	if want := []string{"commit"}; !reflect.DeepEqual(events, want) {
		t.Fatalf("events before ACK = %v, want %v", events, want)
	}
	events = append(events, "ack")
	update := Update{DocumentID: docID, UpdateID: updateID, BodyEpoch: 3, BodySchemaVersion: 1, Bytes: []byte("edit")}
	if err := useCase.PublishAfterAck(context.Background(), receipt, update); err != nil {
		t.Fatalf("publish after ACK: %v", err)
	}
	if want := []string{"commit", "ack", "fanout"}; !reflect.DeepEqual(events, want) {
		t.Fatalf("events = %v, want %v", events, want)
	}
}

func TestApplyReturnsWriterFailure(t *testing.T) {
	commitErr := errors.New("postgres unavailable")
	writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
		return CommitReceipt{}, commitErr
	})

	_, err := NewUseCase(writer, fanoutFunc(func(context.Context, CommitReceipt, Update) error { return nil })).Apply(context.Background(), Actor{UserID: uuid.New()}, Update{
		DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: []byte("edit"),
	})
	if !errors.Is(err, commitErr) {
		t.Fatalf("error = %v, want commit error", err)
	}
}

func TestApplyReturnsBodyRecoveryConditions(t *testing.T) {
	for _, want := range []error{ErrStaleBodyEpoch, ErrBodySchemaMismatch, ErrBodyNotInitialized} {
		t.Run(want.Error(), func(t *testing.T) {
			writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
				return CommitReceipt{}, want
			})
			_, err := NewUseCase(writer, fanoutFunc(func(context.Context, CommitReceipt, Update) error { return nil })).Apply(
				context.Background(), Actor{UserID: uuid.New()}, Update{
					DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 1,
					BodySchemaVersion: 1, Bytes: []byte("edit"),
				},
			)
			if !errors.Is(err, want) {
				t.Fatalf("Apply() error = %v, want %v", err, want)
			}
		})
	}
}

func TestFanoutFailureAfterAckDoesNotInvalidateDurableReceipt(t *testing.T) {
	fanoutErr := errors.New("redis unavailable")
	want := CommitReceipt{DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 2, BodyVersion: 5, Changed: true}
	var events []string
	writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
		events = append(events, "commit")
		return want, nil
	})
	fanout := fanoutFunc(func(context.Context, CommitReceipt, Update) error {
		if events[len(events)-1] != "ack" {
			t.Fatalf("fanout ran before ACK: %v", events)
		}
		events = append(events, "fanout")
		return fanoutErr
	})

	useCase := NewUseCase(writer, fanout)
	got, err := useCase.Apply(context.Background(), Actor{UserID: uuid.New()}, Update{
		DocumentID: want.DocumentID, UpdateID: want.UpdateID, BodyEpoch: want.BodyEpoch,
		BodySchemaVersion: 1, Bytes: []byte("edit"),
	})
	if err != nil || got != want {
		t.Fatalf("durable receipt = %+v, %v; want %+v", got, err, want)
	}
	events = append(events, "ack")
	update := Update{
		DocumentID: want.DocumentID, UpdateID: want.UpdateID, BodyEpoch: want.BodyEpoch,
		BodySchemaVersion: 1, Bytes: []byte("edit"),
	}
	if err := useCase.PublishAfterAck(context.Background(), got, update); !errors.Is(err, fanoutErr) {
		t.Fatalf("fanout error = %v, want %v", err, fanoutErr)
	}
	if want := []string{"commit", "ack", "fanout"}; !reflect.DeepEqual(events, want) {
		t.Fatalf("events = %v, want %v", events, want)
	}
}

func TestApplyDoesNotFanoutDuplicateUpdate(t *testing.T) {
	published := false
	want := CommitReceipt{DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 2, BodyVersion: 5, Changed: false}
	writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) { return want, nil })
	fanout := fanoutFunc(func(context.Context, CommitReceipt, Update) error {
		published = true
		return nil
	})

	useCase := NewUseCase(writer, fanout)
	got, err := useCase.Apply(context.Background(), Actor{UserID: uuid.New()}, Update{
		DocumentID: want.DocumentID, UpdateID: want.UpdateID, BodyEpoch: want.BodyEpoch,
		BodySchemaVersion: 1, Bytes: []byte("retry"),
	})
	if err != nil {
		t.Fatalf("retry update: %v", err)
	}
	if got != want {
		t.Fatalf("receipt = %+v, want %+v", got, want)
	}
	update := Update{
		DocumentID: want.DocumentID, UpdateID: want.UpdateID, BodyEpoch: want.BodyEpoch,
		BodySchemaVersion: 1, Bytes: []byte("retry"),
	}
	if err := useCase.PublishAfterAck(context.Background(), got, update); err != nil {
		t.Fatalf("publish duplicate: %v", err)
	}
	if published {
		t.Fatal("duplicate update was fanned out")
	}
}

func TestApplyRejectsIncompleteEnvelopeBeforeWriter(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Actor, *Update)
	}{
		{name: "actor", mutate: func(actor *Actor, _ *Update) { actor.UserID = uuid.Nil }},
		{name: "document", mutate: func(_ *Actor, update *Update) { update.DocumentID = uuid.Nil }},
		{name: "update id", mutate: func(_ *Actor, update *Update) { update.UpdateID = uuid.Nil }},
		{name: "epoch", mutate: func(_ *Actor, update *Update) { update.BodyEpoch = 0 }},
		{name: "schema version", mutate: func(_ *Actor, update *Update) { update.BodySchemaVersion = 0 }},
		{name: "empty bytes", mutate: func(_ *Actor, update *Update) { update.Bytes = nil }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			writerCalled := false
			writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
				writerCalled = true
				return CommitReceipt{}, nil
			})
			actor := Actor{UserID: uuid.New()}
			update := Update{
				DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 1,
				BodySchemaVersion: 1, Bytes: []byte("edit"),
			}
			test.mutate(&actor, &update)
			_, err := NewUseCase(writer, fanoutFunc(func(context.Context, CommitReceipt, Update) error { return nil })).Apply(context.Background(), actor, update)
			if !errors.Is(err, ErrInvalidUpdate) {
				t.Fatalf("Apply() error = %v, want %v", err, ErrInvalidUpdate)
			}
			if writerCalled {
				t.Fatal("invalid update reached writer")
			}
		})
	}
}

func TestApplyRejectsReceiptThatCannotAcknowledgeRequest(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*CommitReceipt)
	}{
		{name: "document", mutate: func(receipt *CommitReceipt) { receipt.DocumentID = uuid.New() }},
		{name: "update id", mutate: func(receipt *CommitReceipt) { receipt.UpdateID = uuid.New() }},
		{name: "epoch", mutate: func(receipt *CommitReceipt) { receipt.BodyEpoch++ }},
		{name: "body version", mutate: func(receipt *CommitReceipt) { receipt.BodyVersion = 0 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			update := Update{
				DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 4,
				BodySchemaVersion: 1, Bytes: []byte("edit"),
			}
			want := CommitReceipt{
				DocumentID: update.DocumentID, UpdateID: update.UpdateID,
				BodyEpoch: update.BodyEpoch, BodyVersion: 7, Changed: true,
			}
			test.mutate(&want)
			writer := writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
				return want, nil
			})
			got, err := NewUseCase(writer, fanoutFunc(func(context.Context, CommitReceipt, Update) error { return nil })).Apply(
				context.Background(), Actor{UserID: uuid.New()}, update,
			)
			if !errors.Is(err, ErrInvalidReceipt) || got != (CommitReceipt{}) {
				t.Fatalf("Apply() = %+v, %v; want empty receipt and %v", got, err, ErrInvalidReceipt)
			}
		})
	}
}

func TestPublishAfterAckRejectsMismatchedUpdate(t *testing.T) {
	receipt := CommitReceipt{
		DocumentID: uuid.New(), UpdateID: uuid.New(), BodyEpoch: 2,
		BodyVersion: 5, Changed: true,
	}
	update := Update{
		DocumentID: receipt.DocumentID, UpdateID: uuid.New(), BodyEpoch: receipt.BodyEpoch,
		BodySchemaVersion: 1, Bytes: []byte("edit"),
	}
	published := false
	fanout := fanoutFunc(func(context.Context, CommitReceipt, Update) error {
		published = true
		return nil
	})

	err := NewUseCase(writerFunc(func(context.Context, Actor, Update) (CommitReceipt, error) {
		return CommitReceipt{}, nil
	}), fanout).PublishAfterAck(context.Background(), receipt, update)
	if !errors.Is(err, ErrInvalidReceipt) {
		t.Fatalf("PublishAfterAck() error = %v, want %v", err, ErrInvalidReceipt)
	}
	if published {
		t.Fatal("mismatched update was fanned out")
	}
}
