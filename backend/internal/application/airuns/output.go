package airuns

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

type outputKey struct{}
type outputFunc func(Event) error

func WithOutput(ctx context.Context, fn func(Event) error) context.Context {
	return context.WithValue(ctx, outputKey{}, outputFunc(fn))
}

func HasOutput(ctx context.Context) bool { _, ok := ctx.Value(outputKey{}).(outputFunc); return ok }

func Emit(ctx context.Context, kind string, value any) error {
	fn, ok := ctx.Value(outputKey{}).(outputFunc)
	if !ok {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(raw) > 64<<10 {
		return ErrLimit
	}
	return fn(Event{Type: kind, Data: raw})
}

type output struct {
	ctx    context.Context
	append func(context.Context, []Event) error
	events chan Event
	done   chan struct{}
	mu     sync.Mutex
	err    error
}

func newOutput(ctx context.Context, appendEvents func(context.Context, []Event) error) *output {
	o := &output{ctx: ctx, append: appendEvents, events: make(chan Event, 128), done: make(chan struct{})}
	go o.persist()
	return o
}

func (o *output) emit(event Event) error {
	o.mu.Lock()
	err := o.err
	o.mu.Unlock()
	if err != nil {
		return err
	}
	select {
	case <-o.ctx.Done():
		return o.ctx.Err()
	case <-o.done:
		return ErrTerminal
	case o.events <- event:
		return nil
	}
}

func (o *output) close() error {
	close(o.events)
	<-o.done
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.err
}

func (o *output) persist() {
	defer close(o.done)
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	batch := make([]Event, 0, 16)
	flush := func() bool {
		if len(batch) == 0 {
			return true
		}
		// A stopped or interrupted run still saves what it had shown, so the
		// write must not die with the run's own context.
		save, cancel := context.WithTimeout(context.WithoutCancel(o.ctx), 3*time.Second)
		err := o.append(save, batch)
		cancel()
		batch = batch[:0]
		if err != nil {
			o.mu.Lock()
			o.err = err
			o.mu.Unlock()
			return false
		}
		return true
	}
	for {
		select {
		case <-tick.C:
			if !flush() {
				return
			}
		case event, ok := <-o.events:
			if !ok {
				flush()
				return
			}
			if event.Type == "text_delta" && len(batch) > 0 && batch[len(batch)-1].Type == "text_delta" {
				var previous, next struct {
					Text string `json:"text"`
					Step int    `json:"step,omitempty"`
				}
				if json.Unmarshal(batch[len(batch)-1].Data, &previous) == nil && json.Unmarshal(event.Data, &next) == nil && previous.Step == next.Step && len(previous.Text)+len(next.Text) < 16<<10 {
					previous.Text += next.Text
					batch[len(batch)-1].Data, _ = json.Marshal(previous)
					continue
				}
			}
			batch = append(batch, event)
			if event.Type != "text_delta" || len(batch) >= 128 {
				if !flush() {
					return
				}
			}
		}
	}
}
