// Command bodyaudit reports how many active Markdown documents are
// recoverable from AST + CRDT state. It is read-only; legacy documents are
// initialized through the frontend backfill route, which owns the Markdown
// parser and the stale-source (fingerprint) check.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"backend/internal/config"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/postgres"
	"backend/internal/infrastructure/repository/document"

	"github.com/google/uuid"
)

func main() {
	log := logger.New()
	workspace := flag.String("workspace", "", "workspace UUID to audit")
	flag.Parse()
	workspaceID, err := uuid.Parse(*workspace)
	if err != nil {
		log.Fatalf("-workspace must be a UUID: %v", err)
	}
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := postgres.Open(cfg)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	report, err := document.NewRepository(database.NewSQLDB(db.Raw())).AuditMarkdownBodies(ctx, workspaceID)
	if err != nil {
		log.Fatalf("audit: %v", err)
	}
	fmt.Printf("active markdown: %d\npending legacy (no AST): %d\ninitialized: %d\nready: %d\nfindings: %d\n",
		report.ActiveMarkdown, report.PendingLegacy, report.Initialized, report.Ready, len(report.Findings))
	for _, f := range report.Findings {
		fmt.Printf("  %s %s %s\n", f.DocumentID, f.Code, f.Detail)
	}
	if len(report.Findings) > 0 {
		os.Exit(1)
	}
}
