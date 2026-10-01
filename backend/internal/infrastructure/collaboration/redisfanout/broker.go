package redisfanout

import (
	"context"
	"encoding/json"
	"fmt"

	"backend/internal/application/collaboration"

	"github.com/redis/go-redis/v9"
)

const channel = "dokudocs:collaboration:v1"

type Broker struct {
	client *redis.Client
}

func New(redisURL string) (*Broker, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse Redis URL: %w", err)
	}
	return &Broker{client: redis.NewClient(options)}, nil
}

func (b *Broker) PublishEvent(ctx context.Context, event collaboration.BroadcastEvent) error {
	message, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode collaboration event: %w", err)
	}
	return b.client.Publish(ctx, channel, message).Err()
}

func (b *Broker) Subscribe(ctx context.Context) (<-chan collaboration.BroadcastEvent, error) {
	pubsub := b.client.Subscribe(ctx, channel)
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, fmt.Errorf("subscribe to collaboration events: %w", err)
	}
	events := make(chan collaboration.BroadcastEvent, 64)
	// ReceiveMessage can block past context cancellation while the connection is
	// idle; closing the subscription is what unblocks it.
	go func() {
		<-ctx.Done()
		_ = pubsub.Close()
	}()
	go func() {
		defer close(events)
		defer pubsub.Close()
		for {
			message, err := pubsub.ReceiveMessage(ctx)
			if err != nil {
				return
			}
			var event collaboration.BroadcastEvent
			if err := json.Unmarshal([]byte(message.Payload), &event); err != nil {
				continue
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()
	return events, nil
}

func (b *Broker) Close() error {
	return b.client.Close()
}
