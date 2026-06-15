package database

import (
	"context"
	"database/sql"
)

type Queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type DB interface {
	Queryer
	WithTransaction(ctx context.Context, fn func(tx Queryer) error) error
	Raw() *sql.DB
	Close() error
}

type SQLDB struct {
	db *sql.DB
}

func NewSQLDB(db *sql.DB) *SQLDB {
	return &SQLDB{db: db}
}

func (d *SQLDB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.db.QueryRowContext(ctx, query, args...)
}

func (d *SQLDB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.db.QueryContext(ctx, query, args...)
}

func (d *SQLDB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.db.ExecContext(ctx, query, args...)
}

func (d *SQLDB) WithTransaction(ctx context.Context, fn func(tx Queryer) error) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (d *SQLDB) Raw() *sql.DB { return d.db }

func (d *SQLDB) Close() error { return d.db.Close() }
