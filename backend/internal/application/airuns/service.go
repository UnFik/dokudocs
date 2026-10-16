package airuns

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type Store interface {
	Start(context.Context, Start) (Run, bool, error)
	Get(context.Context, uuid.UUID, uuid.UUID) (Run, error)
	ByKey(context.Context, uuid.UUID, string) (Run, error)
	Append(context.Context, uuid.UUID, []Event) error
	Finish(context.Context, uuid.UUID, uuid.UUID, string, json.RawMessage, string) (Run, error)
	Renew(context.Context, uuid.UUID, time.Time) error
	Recover(context.Context, time.Time) (int64, error)
	Events(context.Context, uuid.UUID, uuid.UUID, int64) ([]Event, error)
	Latest(context.Context, uuid.UUID, uuid.UUID) (Run, error)
	LatestBySubject(context.Context, uuid.UUID, []string, string) (Run, error)
	Cleanup(context.Context, time.Time) (int64, error)
}

// Retention is how long a finished run's draft and events stay replayable.
const Retention = 7 * 24 * time.Hour

type activeRun struct {
	cancel   context.CancelFunc
	stopped  atomic.Bool
	finished chan struct{}
	// owner, conversation and err are set before finished closes.
	owner        uuid.UUID
	conversation *uuid.UUID
	err          error
}

type Work func(context.Context) (json.RawMessage, error)

type Service struct {
	store    Store
	ctx      context.Context
	stop     context.CancelFunc
	instance uuid.UUID
	slots    chan struct{}
	mu       sync.Mutex
	active   map[uuid.UUID]*activeRun
	wg       sync.WaitGroup
}

func NewService(ctx context.Context, store Store, limit int) *Service {
	if limit < 1 {
		limit = 4
	}
	root, stop := context.WithCancel(ctx)
	s := &Service{store: store, ctx: root, stop: stop, instance: uuid.New(), slots: make(chan struct{}, limit), active: make(map[uuid.UUID]*activeRun)}
	s.wg.Add(1)
	go s.maintain()
	return s
}

func (s *Service) Start(ctx context.Context, in Start, work Work) (Run, bool, error) {
	if in.OwnerID == uuid.Nil || len(in.IdempotencyKey) == 0 || len(in.IdempotencyKey) > 200 || len(in.Fingerprint) > 200 || work == nil || !in.Deadline.After(time.Now()) {
		return Run{}, false, ErrInvalid
	}
	if old, err := s.store.ByKey(ctx, in.OwnerID, in.IdempotencyKey); err == nil {
		if old.Fingerprint != in.Fingerprint {
			return Run{}, false, ErrConflict
		}
		return old, false, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Run{}, false, err
	}
	select {
	case <-s.ctx.Done():
		return Run{}, false, ErrTerminal
	default:
	}
	select {
	case s.slots <- struct{}{}:
	default:
		return Run{}, false, ErrCapacity
	}
	in.InstanceID = s.instance
	run, created, err := s.store.Start(ctx, in)
	if err != nil || !created {
		<-s.slots
		return run, created, err
	}
	job, cancel := context.WithDeadline(s.ctx, run.Deadline)
	s.mu.Lock()
	handle := &activeRun{cancel: cancel, finished: make(chan struct{}), conversation: run.ConversationID, owner: run.OwnerID}
	s.active[run.ID] = handle
	s.mu.Unlock()
	s.wg.Add(1)
	go s.execute(job, handle, run, work)
	return run, true, nil
}

func (s *Service) execute(ctx context.Context, handle *activeRun, run Run, work Work) {
	defer s.wg.Done()
	defer func() {
		handle.cancel()
		s.mu.Lock()
		delete(s.active, run.ID)
		s.mu.Unlock()
		<-s.slots
		close(handle.finished)
	}()
	var result json.RawMessage
	var err error
	output := newOutput(ctx, func(ctx context.Context, events []Event) error { return s.store.Append(ctx, run.ID, events) })
	ctx = WithOutput(WithRun(ctx, run.ID), output.emit)
	func() {
		defer func() {
			if recover() != nil {
				err = errors.New("AI run failed")
			}
		}()
		result, err = work(ctx)
	}()
	if outputErr := output.close(); err == nil {
		err = outputErr
	}
	handle.err = err
	status, message := "completed", ""
	// Work that returned without an error already saved its result, so a Stop or
	// deadline that arrives afterwards cannot turn it into a failure.
	if err != nil {
		result = nil
		status, message = "failed", "AI run failed"
		var public *PublicError
		if errors.As(err, &public) && len(public.Message) <= 1000 {
			message = public.Message
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			message = "AI run timed out"
		}
		if s.ctx.Err() != nil {
			status, message = "interrupted", "The server processing this AI run stopped"
		}
		if handle.stopped.Load() {
			status, message = "cancelled", "Stopped by the user"
		}
	}
	finish, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	_, _ = s.store.Finish(finish, run.OwnerID, run.ID, status, result, message)
}

// Cancel stops the owner's run on this server. A run already finished, or owned
// by another instance, is returned unchanged.
func (s *Service) Cancel(ctx context.Context, owner, id uuid.UUID) (Run, error) {
	run, err := s.store.Get(ctx, owner, id)
	if err != nil {
		return Run{}, err
	}
	s.mu.Lock()
	handle := s.active[id]
	s.mu.Unlock()
	if handle == nil || run.Status != "running" {
		return run, nil
	}
	handle.stopped.Store(true)
	handle.cancel()
	select {
	case <-handle.finished:
	case <-ctx.Done():
		return Run{}, ctx.Err()
	case <-time.After(5 * time.Second):
	}
	return s.store.Get(ctx, owner, id)
}

func (s *Service) Get(ctx context.Context, owner, id uuid.UUID) (Run, error) {
	return s.store.Get(ctx, owner, id)
}

func (s *Service) Events(ctx context.Context, owner, id uuid.UUID, after int64) ([]Event, error) {
	return s.store.Events(ctx, owner, id, after)
}

// Latest is the active run of a conversation, or else its most recent one.
func (s *Service) Latest(ctx context.Context, owner, conversation uuid.UUID) (Run, error) {
	return s.store.Latest(ctx, owner, conversation)
}

// LatestBySubject is the newest run of the given kinds about a subject.
func (s *Service) LatestBySubject(ctx context.Context, owner uuid.UUID, kinds []string, subject string) (Run, error) {
	return s.store.LatestBySubject(ctx, owner, kinds, subject)
}

// Wait blocks until a run started on this server has finished and returns the
// error its work gave. For any other run it returns its saved state at once.
func (s *Service) Wait(ctx context.Context, owner, id uuid.UUID) (Run, error, error) {
	s.mu.Lock()
	handle := s.active[id]
	s.mu.Unlock()
	if handle != nil {
		select {
		case <-handle.finished:
		case <-ctx.Done():
			return Run{}, nil, ctx.Err()
		}
	}
	run, err := s.store.Get(ctx, owner, id)
	if handle != nil {
		return run, handle.err, err
	}
	return run, nil, err
}

// CancelConversation stops the run in progress on a conversation that is being deleted.
func (s *Service) CancelConversation(ctx context.Context, owner, conversation uuid.UUID) {
	s.mu.Lock()
	var ids []uuid.UUID
	for id, handle := range s.active {
		if handle.owner == owner && handle.conversation != nil && *handle.conversation == conversation {
			ids = append(ids, id)
		}
	}
	s.mu.Unlock()
	for _, id := range ids {
		_, _ = s.Cancel(ctx, owner, id)
	}
}

// Done is closed once the server begins to stop, so observers can leave.
func (s *Service) Done() <-chan struct{} { return s.ctx.Done() }

func (s *Service) maintain() {
	defer s.wg.Done()
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	var lastCleanup time.Time
	for {
		if s.ctx.Err() != nil {
			return
		}
		_ = s.store.Renew(s.ctx, s.instance, time.Now().Add(30*time.Second))
		_, _ = s.store.Recover(s.ctx, time.Now())
		if time.Since(lastCleanup) > time.Hour {
			if _, err := s.store.Cleanup(s.ctx, time.Now().Add(-Retention)); err == nil {
				lastCleanup = time.Now()
			}
		}
		select {
		case <-s.ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (s *Service) Close() {
	s.stop()
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
	}
}
