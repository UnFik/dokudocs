// Command ownergrants audits and repairs document owner grants before a
// cutover. It is a dry run unless --apply is given.
//
//	DATABASE_URL=postgres://... go run ./cmd/ownergrants                  # report only
//	DATABASE_URL=postgres://... go run ./cmd/ownergrants --apply          # repair
//	DATABASE_URL=postgres://... go run ./cmd/ownergrants --workspace <id> # one workspace
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"backend/internal/infrastructure/database"
	"backend/internal/maintenance/ownergrants"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

type workspaceList []uuid.UUID

func (w *workspaceList) String() string { return fmt.Sprint([]uuid.UUID(*w)) }

func (w *workspaceList) Set(value string) error {
	for _, part := range strings.Split(value, ",") {
		id, err := uuid.Parse(strings.TrimSpace(part))
		if err != nil {
			return fmt.Errorf("invalid workspace ID %q: %w", part, err)
		}
		*w = append(*w, id)
	}
	return nil
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout io.Writer) error {
	flags := flag.NewFlagSet("ownergrants", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	apply := flags.Bool("apply", false, "commit the repairs; without it the command only reports")
	var workspaces workspaceList
	flags.Var(&workspaces, "workspace", "limit to this workspace ID (repeat or comma-separate); default all")
	if err := flags.Parse(args); err != nil {
		return err
	}
	databaseURL := getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	result, err := ownergrants.Reconcile(ctx, database.NewSQLDB(db), ownergrants.Scope{WorkspaceIDs: workspaces}, *apply)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}
