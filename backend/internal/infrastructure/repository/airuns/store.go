package airuns

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	app "backend/internal/application/airuns"
	"backend/internal/infrastructure/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

const columns = `id,owner_id,fingerprint,workspace_id,conversation_id,kind,status,draft,sequence,result,error,started_at,updated_at,deadline`

func scan(row *sql.Row) (app.Run, error) {
	var r app.Run
	var result []byte
	err := row.Scan(&r.ID, &r.OwnerID, &r.Fingerprint, &r.WorkspaceID, &r.ConversationID, &r.Kind, &r.Status, &r.Draft, &r.Sequence, &result, &r.Error, &r.StartedAt, &r.UpdatedAt, &r.Deadline)
	r.Result = result
	if errors.Is(err, sql.ErrNoRows) {
		err = app.ErrNotFound
	}
	return r, err
}

func (s *Store) Start(ctx context.Context, in app.Start) (app.Run, bool, error) {
	r, err := scan(s.db.QueryRowContext(ctx, `INSERT INTO ai_runs(owner_id,workspace_id,conversation_id,kind,idempotency_key,fingerprint,instance_id,deadline)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+columns, in.OwnerID, in.WorkspaceID, in.ConversationID, in.Kind, in.IdempotencyKey, in.Fingerprint, in.InstanceID, in.Deadline))
	if err == nil {
		return r, true, nil
	}
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || pg.Code != "23505" {
		return app.Run{}, false, err
	}
	var fingerprint string
	err = s.db.QueryRowContext(ctx, `SELECT fingerprint FROM ai_runs WHERE owner_id=$1 AND idempotency_key=$2`, in.OwnerID, in.IdempotencyKey).Scan(&fingerprint)
	if errors.Is(err, sql.ErrNoRows) {
		return app.Run{}, false, app.ErrBusy
	}
	if err != nil {
		return app.Run{}, false, err
	}
	if fingerprint != in.Fingerprint {
		return app.Run{}, false, app.ErrConflict
	}
	r, err = scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM ai_runs WHERE owner_id=$1 AND idempotency_key=$2`, in.OwnerID, in.IdempotencyKey))
	return r, false, err
}

func (s *Store) Get(ctx context.Context, owner, id uuid.UUID) (app.Run, error) {
	return scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM ai_runs WHERE owner_id=$1 AND id=$2`, owner, id))
}

func (s *Store) ByKey(ctx context.Context, owner uuid.UUID, key string) (app.Run, error) {
	return scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM ai_runs WHERE owner_id=$1 AND idempotency_key=$2`, owner, key))
}

func (s *Store) Append(ctx context.Context, id uuid.UUID, events []app.Event) error {
	if len(events) == 0 {
		return nil
	}
	if len(events) > 256 {
		return app.ErrLimit
	}
	return s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		var sequence int64
		var draft, status string
		err := tx.QueryRowContext(ctx, `SELECT sequence,draft,status FROM ai_runs WHERE id=$1 FOR UPDATE`, id).Scan(&sequence, &draft, &status)
		if errors.Is(err, sql.ErrNoRows) {
			return app.ErrNotFound
		}
		if err != nil {
			return err
		}
		if status != "running" {
			return app.ErrTerminal
		}
		for _, event := range events {
			if len(event.Data) > 64<<10 {
				return app.ErrLimit
			}
			if !json.Valid(event.Data) {
				return app.ErrInvalid
			}
			switch event.Type {
			case "text_delta":
				var value struct {
					Text string `json:"text"`
				}
				if err := json.Unmarshal(event.Data, &value); err != nil {
					return app.ErrInvalid
				}
				draft += value.Text
			case "text_reset":
				draft = ""
			case "status", "tool_status", "action_pending":
			default:
				return app.ErrInvalid
			}
			if len(draft) > 2<<20 {
				return app.ErrLimit
			}
			sequence++
			if _, err := tx.ExecContext(ctx, `INSERT INTO ai_run_events(run_id,sequence,type,data) VALUES($1,$2,$3,$4)`, id, sequence, event.Type, []byte(event.Data)); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE ai_runs SET sequence=$2,draft=$3,updated_at=now() WHERE id=$1`, id, sequence, draft)
		return err
	})
}

func (s *Store) Events(ctx context.Context, owner, id uuid.UUID, after int64) ([]app.Event, error) {
	if after < 0 {
		return nil, app.ErrInvalid
	}
	if _, err := s.Get(ctx, owner, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sequence,type,data FROM ai_run_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 256`, id, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]app.Event, 0)
	for rows.Next() {
		var event app.Event
		var raw []byte
		if err := rows.Scan(&event.Sequence, &event.Type, &raw); err != nil {
			return nil, err
		}
		event.Data = raw
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) Finish(ctx context.Context, owner, id uuid.UUID, status string, result json.RawMessage, message string) (app.Run, error) {
	switch status {
	case "completed", "failed", "cancelled", "interrupted":
	default:
		return app.Run{}, app.ErrInvalid
	}
	if len(result) > 4<<20 || len(message) > 2000 {
		return app.Run{}, app.ErrLimit
	}
	if result != nil && !json.Valid(result) {
		return app.Run{}, app.ErrInvalid
	}
	var r app.Run
	err := s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		var err error
		r, err = scan(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM ai_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE`, id, owner))
		if err != nil {
			return err
		}
		if r.Status != "running" {
			return nil
		}
		r.Status, r.Result, r.Error = status, result, message
		r.Sequence++
		r.UpdatedAt = time.Now().UTC()
		raw, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO ai_run_events(run_id,sequence,type,data) VALUES($1,$2,$3,$4)`, id, r.Sequence, status, raw); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE ai_runs SET status=$2,result=$3,error=$4,sequence=$5,updated_at=$6 WHERE id=$1`, id, status, []byte(result), message, r.Sequence, r.UpdatedAt)
		return err
	})
	return r, err
}

func (s *Store) Renew(ctx context.Context, instance uuid.UUID, until time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE ai_runs SET lease_until=$2 WHERE instance_id=$1 AND status='running'`, instance, until)
	return err
}

func (s *Store) Recover(ctx context.Context, at time.Time) (int64, error) {
	var count int64
	err := s.db.QueryRowContext(ctx, `WITH recovered AS (
  UPDATE ai_runs SET status=CASE WHEN deadline <= $1 THEN 'failed' ELSE 'interrupted' END,
   error=CASE WHEN deadline <= $1 THEN 'AI run timed out' ELSE 'The server processing this AI run is no longer available' END,
   sequence=sequence+1,updated_at=$1
  WHERE status='running' AND (lease_until <= $1 OR deadline <= $1)
  RETURNING id,kind,status,draft,sequence,result,error,started_at,updated_at,deadline,workspace_id,conversation_id
 ), events AS (
  INSERT INTO ai_run_events(run_id,sequence,type,data)
  SELECT id,sequence,status,jsonb_build_object('id',id,'kind',kind,'status',status,'draft',draft,'sequence',sequence,
    'result',result,'error',error,'startedAt',started_at,'updatedAt',updated_at,'deadline',deadline,
    'workspaceID',workspace_id,'conversationID',conversation_id)
  FROM recovered RETURNING run_id
 ) SELECT count(*) FROM events`, at).Scan(&count)
	return count, err
}

func (s *Store) Latest(ctx context.Context, owner, conversation uuid.UUID) (app.Run, error) {
	return scan(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM ai_runs WHERE owner_id=$1 AND conversation_id=$2 ORDER BY (status='running') DESC, started_at DESC LIMIT 1`, owner, conversation))
}

// Cleanup removes runs that ended before the cutoff; their events go with them.
func (s *Store) Cleanup(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ai_runs WHERE status<>'running' AND updated_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
