//go:build integration

package airuns_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	app "backend/internal/application/airuns"
	"backend/internal/infrastructure/database"
	repo "backend/internal/infrastructure/repository/airuns"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func fixture(t *testing.T) (*repo.Store, app.Start) {
	t.Helper()
	db, err := sql.Open("pgx", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner := uuid.New()
	_, err = db.Exec(`INSERT INTO users (id, account_no, email, full_name) VALUES ($1,$2,$3,'Run test')`, owner, owner.String(), fmt.Sprintf("run-%s@example.invalid", owner))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id=$1`, owner) })
	return repo.NewStore(database.NewSQLDB(db)), app.Start{OwnerID: owner, Kind: "test", IdempotencyKey: uuid.NewString(), Fingerprint: "request-one", InstanceID: uuid.New(), Deadline: time.Now().Add(time.Minute)}
}

func TestRepeatedRequestReturnsTheSameRunAndItsSavedStatus(t *testing.T) {
	store, input := fixture(t)
	ctx := context.Background()
	first, created, err := store.Start(ctx, input)
	if err != nil || !created {
		t.Fatalf("start: %+v, %v, %v", first, created, err)
	}
	second, created, err := store.Start(ctx, input)
	if err != nil || created || first.ID != second.ID {
		t.Fatalf("repeat: %+v, %v, %v", second, created, err)
	}
	saved, err := store.Get(ctx, input.OwnerID, first.ID)
	if err != nil || saved.Status != "running" || saved.ID != first.ID {
		t.Fatalf("saved: %+v, %v", saved, err)
	}
}

func TestReconnectReadsTheSavedDraftAndOnlyEventsAfterItsCursor(t *testing.T) {
	store, input := fixture(t)
	ctx := context.Background()
	run, _, err := store.Start(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	err = store.Append(ctx, run.ID, []app.Event{
		{Type: "text_delta", Data: json.RawMessage(`{"text":"Halo "}`)},
		{Type: "text_delta", Data: json.RawMessage(`{"text":"dunia"}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.Get(ctx, input.OwnerID, run.ID)
	if err != nil || saved.Draft != "Halo dunia" || saved.Sequence != 2 {
		t.Fatalf("snapshot: %+v, %v", saved, err)
	}
	events, err := store.Events(ctx, input.OwnerID, run.ID, 1)
	if err != nil || len(events) != 1 || events[0].Sequence != 2 || string(events[0].Data) != `{"text": "dunia"}` {
		t.Fatalf("replay: %+v, %v", events, err)
	}
}

func TestStopKeepsTheDraftAndCannotBecomeSuccessfulLater(t *testing.T) {
	store, input := fixture(t)
	ctx := context.Background()
	run, _, err := store.Start(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, run.ID, []app.Event{{Type: "text_delta", Data: json.RawMessage(`{"text":"Belum selesai"}`)}}); err != nil {
		t.Fatal(err)
	}
	stopped, err := store.Finish(ctx, input.OwnerID, run.ID, "cancelled", nil, "")
	if err != nil || stopped.Status != "cancelled" || stopped.Draft != "Belum selesai" {
		t.Fatalf("stop: %+v, %v", stopped, err)
	}
	if err := store.Append(ctx, run.ID, []app.Event{{Type: "text_delta", Data: json.RawMessage(`{"text":" tambahan"}`)}}); !errors.Is(err, app.ErrTerminal) {
		t.Fatalf("late delta: %v", err)
	}
	late, err := store.Finish(ctx, input.OwnerID, run.ID, "completed", json.RawMessage(`{"text":"selesai"}`), "")
	if err != nil || late.Status != "cancelled" || len(late.Result) != 0 {
		t.Fatalf("late completion: %+v, %v", late, err)
	}
}

func TestRecoveryInterruptsOnlyRunsWhoseServerLeaseHasExpired(t *testing.T) {
	store, input := fixture(t)
	ctx := context.Background()
	now := time.Now()
	input.Deadline = now.Add(time.Hour)
	stale, _, err := store.Start(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	input.InstanceID = uuid.New()
	input.IdempotencyKey = uuid.NewString()
	healthy, _, err := store.Start(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Renew(ctx, input.InstanceID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Recover(ctx, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(ctx, input.OwnerID, stale.ID)
	if err != nil || got.Status != "interrupted" {
		t.Fatalf("stale: %+v, %v", got, err)
	}
	got, err = store.Get(ctx, input.OwnerID, healthy.ID)
	if err != nil || got.Status != "running" {
		t.Fatalf("healthy: %+v, %v", got, err)
	}
}

func TestClosingTheClientDoesNotCancelTheServerRun(t *testing.T) {
	store, input := fixture(t)
	server, stopServer := context.WithCancel(context.Background())
	defer stopServer()
	runner := app.NewService(server, store, 4)
	defer runner.Close()
	client, closeClient := context.WithCancel(context.Background())
	started, finish := make(chan struct{}), make(chan struct{})
	run, _, err := runner.Start(client, input, func(ctx context.Context) (json.RawMessage, error) {
		close(started)
		select {
		case <-finish:
			return json.RawMessage(`{"text":"Selesai"}`), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	closeClient()
	close(finish)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		saved, err := store.Get(context.Background(), input.OwnerID, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if saved.Status == "completed" {
			return
		}
		if saved.Status != "running" {
			t.Fatalf("client cancelled server work: %+v", saved)
		}
		time.Sleep(time.Millisecond * 5)
	}
	t.Fatal("server run did not complete after client disconnect")
}

func TestDraftIsAvailableWhileTheProviderIsStillWorking(t *testing.T) {
	store, input := fixture(t)
	runner := app.NewService(context.Background(), store, 4)
	defer runner.Close()
	finish := make(chan struct{})
	defer close(finish)
	run, _, err := runner.Start(context.Background(), input, func(ctx context.Context) (json.RawMessage, error) {
		if err := app.Emit(ctx, "text_delta", map[string]string{"text": "Sedang menjawab"}); err != nil {
			return nil, err
		}
		select {
		case <-finish:
			return json.RawMessage(`{"text":"Sedang menjawab"}`), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		saved, err := store.Get(context.Background(), input.OwnerID, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if saved.Draft == "Sedang menjawab" && saved.Status == "running" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("draft did not become visible before the provider completed")
}

func TestExplicitStopCancelsServerWorkAndPreservesItsStatus(t *testing.T) {
 store,input:=fixture(t)
 runner:=app.NewService(context.Background(),store,4)
 defer runner.Close()
 started,stopped:=make(chan struct{}),make(chan struct{})
 run,_,err:=runner.Start(context.Background(),input,func(ctx context.Context)(json.RawMessage,error){close(started);<-ctx.Done();close(stopped);return nil,ctx.Err()})
 if err!=nil {t.Fatal(err)}
 <-started
 saved,err:=runner.Cancel(context.Background(),input.OwnerID,run.ID)
 if err!=nil || saved.Status!="cancelled" {t.Fatalf("cancel: %+v, %v",saved,err)}
 select {case <-stopped:case <-time.After(time.Second):t.Fatal("Stop did not cancel server work")}
}
