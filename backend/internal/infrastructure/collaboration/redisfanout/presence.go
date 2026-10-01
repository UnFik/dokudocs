package redisfanout

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const presenceChannel = "dokudocs:presence:v1"

// DefaultPresenceTTL is how long an entry lives without a heartbeat.
const DefaultPresenceTTL = 30 * time.Second

// PresenceStore keeps live document connections in Redis. A sorted set holds
// each connection's expiry as its score and a hash holds its profile, so an
// instance that crashes without leaving is cleaned up by expiry alone.
type PresenceStore struct {
	client *redis.Client
	ttl    time.Duration
}

var _ collaboration.PresenceStore = (*PresenceStore)(nil)

func NewPresenceStore(redisURL string, ttl time.Duration) (*PresenceStore, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse Redis URL: %w", err)
	}
	if ttl <= 0 {
		ttl = DefaultPresenceTTL
	}
	return &PresenceStore{client: redis.NewClient(options), ttl: ttl}, nil
}

func liveKey(documentID uuid.UUID) string { return "dokudocs:presence:live:" + documentID.String() }
func dataKey(documentID uuid.UUID) string { return "dokudocs:presence:data:" + documentID.String() }

type storedEntry struct {
	UserID    uuid.UUID `json:"u"`
	Name      string    `json:"n,omitempty"`
	AvatarURL string    `json:"a,omitempty"`
}

func (s *PresenceStore) Heartbeat(ctx context.Context, documentID uuid.UUID, entry collaboration.PresenceEntry) error {
	payload, err := json.Marshal(storedEntry{UserID: entry.UserID, Name: entry.Name, AvatarURL: entry.AvatarURL})
	if err != nil {
		return err
	}
	expires := float64(time.Now().Add(s.ttl).UnixMilli())
	keyTTL := 4 * s.ttl
	pipe := s.client.TxPipeline()
	pipe.ZAdd(ctx, liveKey(documentID), redis.Z{Score: expires, Member: entry.ConnectionID.String()})
	pipe.HSet(ctx, dataKey(documentID), entry.ConnectionID.String(), payload)
	pipe.Expire(ctx, liveKey(documentID), keyTTL)
	pipe.Expire(ctx, dataKey(documentID), keyTTL)
	_, err = pipe.Exec(ctx)
	return err
}

func (s *PresenceStore) Leave(ctx context.Context, documentID, connectionID uuid.UUID) error {
	pipe := s.client.TxPipeline()
	pipe.ZRem(ctx, liveKey(documentID), connectionID.String())
	pipe.HDel(ctx, dataKey(documentID), connectionID.String())
	_, err := pipe.Exec(ctx)
	return err
}

func (s *PresenceStore) List(ctx context.Context, documentID uuid.UUID) ([]collaboration.PresenceEntry, error) {
	now := strconv.FormatInt(time.Now().UnixMilli(), 10)
	expired, err := s.client.ZRangeByScore(ctx, liveKey(documentID), &redis.ZRangeBy{Min: "-inf", Max: "(" + now}).Result()
	if err != nil {
		return nil, err
	}
	if len(expired) > 0 {
		pipe := s.client.TxPipeline()
		members := make([]any, len(expired))
		for i, id := range expired {
			members[i] = id
		}
		pipe.ZRem(ctx, liveKey(documentID), members...)
		pipe.HDel(ctx, dataKey(documentID), expired...)
		if _, err := pipe.Exec(ctx); err != nil {
			return nil, err
		}
	}
	live, err := s.client.ZRangeByScore(ctx, liveKey(documentID), &redis.ZRangeBy{Min: now, Max: "+inf"}).Result()
	if err != nil || len(live) == 0 {
		return nil, err
	}
	values, err := s.client.HMGet(ctx, dataKey(documentID), live...).Result()
	if err != nil {
		return nil, err
	}
	entries := make([]collaboration.PresenceEntry, 0, len(live))
	for i, id := range live {
		raw, ok := values[i].(string)
		if !ok {
			continue
		}
		var stored storedEntry
		connectionID, parseErr := uuid.Parse(id)
		if parseErr != nil || json.Unmarshal([]byte(raw), &stored) != nil {
			continue
		}
		entries = append(entries, collaboration.PresenceEntry{
			ConnectionID: connectionID, UserID: stored.UserID, Name: stored.Name, AvatarURL: stored.AvatarURL,
		})
	}
	return entries, nil
}

func (s *PresenceStore) Notify(ctx context.Context, documentID uuid.UUID) error {
	return s.client.Publish(ctx, presenceChannel, documentID.String()).Err()
}

func (s *PresenceStore) Changes(ctx context.Context) (<-chan uuid.UUID, error) {
	pubsub := s.client.Subscribe(ctx, presenceChannel)
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, fmt.Errorf("subscribe to presence changes: %w", err)
	}
	changes := make(chan uuid.UUID, 64)
	go func() {
		<-ctx.Done()
		_ = pubsub.Close()
	}()
	go func() {
		defer close(changes)
		defer pubsub.Close()
		for {
			message, err := pubsub.ReceiveMessage(ctx)
			if err != nil {
				return
			}
			documentID, err := uuid.Parse(message.Payload)
			if err != nil {
				continue
			}
			select {
			case changes <- documentID:
			case <-ctx.Done():
				return
			}
		}
	}()
	return changes, nil
}

func (s *PresenceStore) Close() error { return s.client.Close() }
