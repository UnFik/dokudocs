//go:build integration

package aiusage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	app "backend/internal/application/aiusage"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestUsageIsSummedByDayModelPurposeAndUser(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, _ = db.Exec(`DELETE FROM ai_model_usage`)
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM ai_model_usage`) })
	var heavy, light uuid.UUID
	for name, target := range map[string]*uuid.UUID{"Heavy": &heavy, "Light": &light} {
		if err := db.QueryRow(`INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
			uuid.NewString(), fmt.Sprintf("usage-%s@example.invalid", uuid.NewString()), name).Scan(target); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id IN ($1, $2)`, heavy, light) })
	store := NewStore(database.NewSQLDB(db))
	ctx := context.Background()
	for _, r := range []app.Record{
		{Provider: "openai", Model: "gpt-x", Purpose: "agent", Feature: app.FeatureChatWorkspace, InputTokens: 100, OutputTokens: 10, UserID: heavy, OK: true},
		{Provider: "openai", Model: "gpt-x", Purpose: "agent", Feature: app.FeatureChatDocument, InputTokens: 50, OutputTokens: 5, UserID: heavy, OK: true},
		{Provider: "openai", Model: "emb", Purpose: "embedding", Feature: app.FeatureIndexing, InputTokens: 7, OK: true},
		{Provider: "openai", Model: "gpt-x", Purpose: "answer", Feature: app.FeatureChatWorkspace, InputTokens: 1, UserID: light, OK: false},
	} {
		if err := store.RecordUsage(ctx, r); err != nil {
			t.Fatalf("RecordUsage(): %v", err)
		}
	}
	s, err := store.UsageSummary(ctx, time.Now().Add(-24*time.Hour), 10)
	if err != nil {
		t.Fatalf("UsageSummary(): %v", err)
	}
	if s.Overall.Calls != 4 || s.Overall.Failed != 1 || s.Overall.InputTokens != 158 || s.Overall.OutputTokens != 15 {
		t.Fatalf("overall = %+v", s.Overall)
	}
	if len(s.Models) != 2 || s.Models[0].Model != "gpt-x" || s.Models[0].InputTokens != 151 {
		t.Fatalf("models = %+v", s.Models)
	}
	if len(s.TopUsers) != 2 || s.TopUsers[0].UserID != heavy || s.TopUsers[0].Name != "Heavy" || s.TopUsers[0].InputTokens != 150 {
		t.Fatalf("top users = %+v", s.TopUsers)
	}
	if len(s.Days) != 1 || s.Days[0].Calls != 4 {
		t.Fatalf("days = %+v", s.Days)
	}
	if len(s.Purposes) != 4 {
		t.Fatalf("purposes = %+v", s.Purposes)
	}
}
