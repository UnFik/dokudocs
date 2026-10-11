package aisettings

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// fakeStore is an in-memory Store.
type fakeStore struct {
	mu         sync.Mutex
	superadmin map[uuid.UUID]bool
	rows       map[string]Record
	changes    []Change
}

func newFakeStore() *fakeStore {
	return &fakeStore{superadmin: map[uuid.UUID]bool{}, rows: map[string]Record{}}
}

func (s *fakeStore) IsSuperadmin(_ context.Context, id uuid.UUID) (bool, error) {
	return s.superadmin[id], nil
}
func (s *fakeStore) Get(_ context.Context, purpose string) (Record, bool, error) {
	r, ok := s.rows[purpose]
	return r, ok, nil
}
func (s *fakeStore) Put(_ context.Context, r Record) error {
	r.LastError, r.LastErrorAt = "", nil
	s.rows[r.Purpose] = r
	return nil
}
func (s *fakeStore) Delete(_ context.Context, purpose string) error {
	delete(s.rows, purpose)
	return nil
}
func (s *fakeStore) RecordError(_ context.Context, purpose, message string) error {
	if r, ok := s.rows[purpose]; ok {
		r.LastError = message
		s.rows[purpose] = r
	}
	return nil
}
func (s *fakeStore) AddChange(_ context.Context, c Change) error {
	s.changes = append(s.changes, c)
	return nil
}
func (s *fakeStore) ListChanges(_ context.Context, limit int) ([]Change, error) {
	return s.changes, nil
}

// fakeCipher reverses nothing: it only has to be reversible and not the identity.
type fakeCipher struct{}

func (fakeCipher) Seal(plain string) ([]byte, error) { return []byte("sealed:" + plain), nil }
func (fakeCipher) Open(sealed []byte) (string, error) {
	return strings.TrimPrefix(string(sealed), "sealed:"), nil
}

type fakeTester struct {
	err   error
	calls []Config
	purps []string
}

func (t *fakeTester) Test(_ context.Context, purpose string, cfg Config) error {
	t.calls = append(t.calls, cfg)
	t.purps = append(t.purps, purpose)
	return t.err
}

type fakeIndex struct {
	done, total int
	kept        [2]string
}

func (i *fakeIndex) RAGEmbeddingProgress(context.Context, string, string) (int, int, error) {
	return i.done, i.total, nil
}
func (i *fakeIndex) DeleteRAGEmbeddingsExcept(_ context.Context, provider, model string) (int64, error) {
	i.kept = [2]string{provider, model}
	return 0, nil
}

type env struct {
	svc    *Service
	store  *fakeStore
	tester *fakeTester
	index  *fakeIndex
	admin  uuid.UUID
}

func newEnv(t *testing.T) *env {
	t.Helper()
	e := &env{store: newFakeStore(), tester: &fakeTester{}, index: &fakeIndex{}, admin: uuid.New()}
	e.store.superadmin[e.admin] = true
	e.svc = NewService(Deps{
		Store: e.store, Index: e.index, Cipher: fakeCipher{}, Tester: e.tester,
		ProviderName: func(url string) string { return strings.TrimPrefix(url, "https://") },
	})
	return e
}

func answerInput() Input {
	return Input{BaseURL: "https://api.example.com/v1/", Protocol: "openai_chat_completions", Model: "m-1", APIKey: "sk-secret-abcd"}
}

func embeddingInput(model string) Input {
	return Input{BaseURL: "https://emb.example.com/v1", Protocol: "openai_responses", Model: model, APIKey: "sk-embed-wxyz"}
}

func TestOnlyASuperadminCanReadOrChangeTheSettings(t *testing.T) {
	e := newEnv(t)
	someone := uuid.New()
	if _, err := e.svc.Overview(context.Background(), someone); !errors.Is(err, ErrForbidden) {
		t.Errorf("Overview() error = %v, want ErrForbidden", err)
	}
	if _, err := e.svc.Save(context.Background(), someone, PurposeAnswer, answerInput()); !errors.Is(err, ErrForbidden) {
		t.Errorf("Save() error = %v, want ErrForbidden", err)
	}
	if err := e.svc.Test(context.Background(), someone, PurposeAnswer, answerInput()); !errors.Is(err, ErrForbidden) {
		t.Errorf("Test() error = %v, want ErrForbidden", err)
	}
	if len(e.tester.calls) != 0 || len(e.store.rows) != 0 {
		t.Fatal("a refused request still reached the provider or the store")
	}
}

func TestSavingStoresTheSettingWithTheKeySealedAndNeverReturnsIt(t *testing.T) {
	e := newEnv(t)
	overview, err := e.svc.Save(context.Background(), e.admin, PurposeAnswer, answerInput())
	if err != nil {
		t.Fatalf("Save(): %v", err)
	}
	row := e.store.rows[PurposeAnswer]
	if string(row.APIKeyCiphertext) == "sk-secret-abcd" || row.BaseURL != "https://api.example.com/v1" || row.Model != "m-1" {
		t.Fatalf("stored row = %+v", row)
	}
	if overview.Answer == nil || overview.Answer.KeyHint != "••••abcd" || overview.Answer.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("overview answer = %+v", overview.Answer)
	}
	if e.tester.calls[0].APIKey != "sk-secret-abcd" || e.tester.purps[0] != PurposeAnswer {
		t.Fatalf("the provider was tested with %+v for %v", e.tester.calls, e.tester.purps)
	}
}

func TestASettingThatFailsTheConnectionTestIsNotSaved(t *testing.T) {
	e := newEnv(t)
	e.tester.err = errors.New("the provider answered 401")
	_, err := e.svc.Save(context.Background(), e.admin, PurposeAnswer, answerInput())
	var failed *ConnectionError
	if !errors.As(err, &failed) || failed.Message != "the provider answered 401" {
		t.Fatalf("Save() error = %v, want a ConnectionError", err)
	}
	if len(e.store.rows) != 0 || len(e.store.changes) != 0 {
		t.Fatal("a failed test left a setting or an audit entry behind")
	}
}

func TestBadInputIsRefusedBeforeTheProviderIsCalled(t *testing.T) {
	for name, in := range map[string]Input{
		"http url":      {BaseURL: "http://api.example.com/v1", Protocol: "openai_responses", Model: "m", APIKey: "k"},
		"private host":  {BaseURL: "https://10.0.0.5/v1", Protocol: "openai_responses", Model: "m", APIKey: "k"},
		"no model":      {BaseURL: "https://api.example.com/v1", Protocol: "openai_responses", Model: "  ", APIKey: "k"},
		"odd protocol":  {BaseURL: "https://api.example.com/v1", Protocol: "grpc", Model: "m", APIKey: "k"},
		"first no key":  {BaseURL: "https://api.example.com/v1", Protocol: "openai_responses", Model: "m"},
		"model too big": {BaseURL: "https://api.example.com/v1", Protocol: "openai_responses", Model: strings.Repeat("m", 201), APIKey: "k"},
	} {
		e := newEnv(t)
		_, err := e.svc.Save(context.Background(), e.admin, PurposeAnswer, in)
		if !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: Save() error = %v, want ErrInvalid", name, err)
		}
		if len(e.tester.calls) != 0 || len(e.store.rows) != 0 {
			t.Errorf("%s: the request went further than validation", name)
		}
	}
}

func TestAnEmptyKeyKeepsTheStoredKey(t *testing.T) {
	e := newEnv(t)
	if _, err := e.svc.Save(context.Background(), e.admin, PurposeAnswer, answerInput()); err != nil {
		t.Fatal(err)
	}
	in := answerInput()
	in.APIKey, in.Model = "", "m-2"
	if _, err := e.svc.Save(context.Background(), e.admin, PurposeAnswer, in); err != nil {
		t.Fatalf("Save(): %v", err)
	}
	if got := e.tester.calls[1]; got.APIKey != "sk-secret-abcd" || got.Model != "m-2" {
		t.Fatalf("the second test used %+v", got)
	}
	if string(e.store.rows[PurposeAnswer].APIKeyCiphertext) != "sealed:sk-secret-abcd" {
		t.Fatal("the stored key changed")
	}
}

func TestTheAuditTrailNamesWhatChangedAndNeverHoldsAKey(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.svc.Save(ctx, e.admin, PurposeAnswer, answerInput()); err != nil {
		t.Fatal(err)
	}
	in := answerInput()
	in.APIKey, in.Model = "sk-new-key-9999", "m-2"
	if _, err := e.svc.Save(ctx, e.admin, PurposeAnswer, in); err != nil {
		t.Fatal(err)
	}
	if len(e.store.changes) != 2 {
		t.Fatalf("audit entries = %d, want 2", len(e.store.changes))
	}
	last := e.store.changes[1]
	if last.ChangedBy != e.admin || last.Purpose != PurposeAnswer {
		t.Fatalf("last change = %+v", last)
	}
	if got := last.Changes["model"]; got != (FieldChange{From: "m-1", To: "m-2"}) {
		t.Fatalf("model change = %+v", got)
	}
	if got := last.Changes["apiKey"]; got != (FieldChange{From: "", To: "replaced"}) {
		t.Fatalf("apiKey change = %+v", got)
	}
	if _, touched := last.Changes["baseURL"]; touched {
		t.Fatal("an unchanged field was listed")
	}
	for _, c := range e.store.changes {
		for _, f := range c.Changes {
			if strings.Contains(f.From+f.To, "sk-") {
				t.Fatalf("the audit trail holds a key: %+v", c)
			}
		}
	}
}

func TestTheFirstEmbeddingModelIsActiveAtOnce(t *testing.T) {
	e := newEnv(t)
	overview, err := e.svc.Save(context.Background(), e.admin, PurposeEmbedding, embeddingInput("e-1"))
	if err != nil {
		t.Fatal(err)
	}
	if overview.Embedding == nil || overview.Embedding.Model != "e-1" || overview.EmbeddingPending != nil {
		t.Fatalf("overview = %+v", overview)
	}
}

func TestANewEmbeddingModelWaitsAsPendingAndTheActiveOneStays(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-1")); err != nil {
		t.Fatal(err)
	}
	e.index.done, e.index.total = 3, 10
	overview, err := e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-2"))
	if err != nil {
		t.Fatal(err)
	}
	if overview.Embedding.Model != "e-1" || overview.EmbeddingPending == nil || overview.EmbeddingPending.Model != "e-2" {
		t.Fatalf("overview = %+v", overview)
	}
	if overview.Progress == nil || overview.Progress.Done != 3 || overview.Progress.Total != 10 {
		t.Fatalf("progress = %+v", overview.Progress)
	}
}

func TestSavingTheActiveModelAgainCancelsAPendingSwitch(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-1"))
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-2"))
	overview, err := e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-1"))
	if err != nil || overview.EmbeddingPending != nil {
		t.Fatalf("Save() = %+v, %v; want the pending switch gone", overview, err)
	}
}

func TestThePendingModelBecomesActiveOnlyWhenEveryChunkHasItsVector(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-1"))
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-2"))

	e.index.done, e.index.total = 9, 10
	if promoted, err := e.svc.Advance(ctx); err != nil || promoted {
		t.Fatalf("Advance() = %v, %v; want it to wait", promoted, err)
	}
	if e.store.rows[PurposeEmbedding].Model != "e-1" {
		t.Fatal("the model switched before the work was done")
	}

	e.index.done = 10
	if promoted, err := e.svc.Advance(ctx); err != nil || !promoted {
		t.Fatalf("Advance() = %v, %v; want the switch", promoted, err)
	}
	if e.store.rows[PurposeEmbedding].Model != "e-2" || len(e.store.rows) != 1 {
		t.Fatalf("rows after the switch = %+v", e.store.rows)
	}
	if e.index.kept != [2]string{"emb.example.com/v1", "e-2"} {
		t.Fatalf("old vectors were dropped keeping %v", e.index.kept)
	}
	if last := e.store.changes[len(e.store.changes)-1]; last.Purpose != PurposeEmbedding || last.Changes["model"].To != "e-2" {
		t.Fatalf("no audit entry for the switch: %+v", last)
	}
	if promoted, _ := e.svc.Advance(ctx); promoted {
		t.Fatal("Advance() switched twice")
	}
}

func TestTheEnvironmentSeedsOnlyAnEmptyTable(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	seed := Seed{APIKey: "sk-env-1234", AnswerModel: "gpt-x", EmbeddingModel: "emb-x", BaseURL: "https://api.openai.com/v1"}
	if err := e.svc.Seed(ctx, seed); err != nil {
		t.Fatalf("Seed(): %v", err)
	}
	if e.store.rows[PurposeAnswer].Model != "gpt-x" || e.store.rows[PurposeEmbedding].Model != "emb-x" ||
		e.store.rows[PurposeAnswer].Protocol != "openai_responses" {
		t.Fatalf("seeded rows = %+v", e.store.rows)
	}
	seed.AnswerModel = "changed-in-env"
	if err := e.svc.Seed(ctx, seed); err != nil {
		t.Fatal(err)
	}
	if e.store.rows[PurposeAnswer].Model != "gpt-x" {
		t.Fatal("a later boot overwrote the database with the environment")
	}
	empty := newEnv(t)
	if err := empty.svc.Seed(ctx, Seed{AnswerModel: "gpt-x"}); err != nil || len(empty.store.rows) != 0 {
		t.Fatalf("a seed without a key wrote rows: %+v, %v", empty.store.rows, err)
	}
}

func TestCachedReadersAreToldWhenTheSettingsChange(t *testing.T) {
	e := newEnv(t)
	changes := 0
	e.svc = NewService(Deps{
		Store: e.store, Index: e.index, Cipher: fakeCipher{}, Tester: e.tester,
		ProviderName: func(url string) string { return strings.TrimPrefix(url, "https://") },
		OnChange:     func() { changes++ },
	})
	ctx := context.Background()
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-1"))
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-2"))
	if changes != 2 {
		t.Fatalf("OnChange ran %d times after two saves", changes)
	}
	e.tester.err = errors.New("down")
	_, _ = e.svc.Save(ctx, e.admin, PurposeEmbedding, embeddingInput("e-3"))
	if changes != 2 {
		t.Fatal("OnChange ran for a save that did not happen")
	}
	e.tester.err = nil
	e.index.done, e.index.total = 4, 4
	if promoted, _ := e.svc.Advance(ctx); !promoted || changes != 3 {
		t.Fatalf("promoted %v, OnChange ran %d times", promoted, changes)
	}
}

func TestTestingWithoutSavingTouchesNothing(t *testing.T) {
	e := newEnv(t)
	if err := e.svc.Test(context.Background(), e.admin, PurposeAnswer, answerInput()); err != nil {
		t.Fatalf("Test(): %v", err)
	}
	if len(e.store.rows) != 0 || len(e.store.changes) != 0 || len(e.tester.calls) != 1 {
		t.Fatal("Test() saved something or skipped the provider")
	}
	e.tester.err = errors.New("nope")
	var failed *ConnectionError
	if err := e.svc.Test(context.Background(), e.admin, PurposeAnswer, answerInput()); !errors.As(err, &failed) {
		t.Fatalf("Test() error = %v, want a ConnectionError", err)
	}
}

func TestTheAgentModelIsAThirdSettingTestedLikeTheOthers(t *testing.T) {
	e := newEnv(t)
	in := Input{BaseURL: "https://api.example.com/v1", Protocol: ProtocolChatCompletions, Model: "agent-1", APIKey: "sk-agent-0001"}
	overview, err := e.svc.Save(context.Background(), e.admin, PurposeAgent, in)
	if err != nil || overview.Agent == nil || overview.Agent.Model != "agent-1" || overview.Agent.KeyHint != "••••0001" {
		t.Fatalf("Save(agent) = %+v, %v", overview.Agent, err)
	}
	if e.tester.purps[0] != PurposeAgent {
		t.Fatalf("tested as %v", e.tester.purps)
	}
	e.tester.err = errors.New("the model did not call a tool")
	if _, err := e.svc.Save(context.Background(), e.admin, PurposeAgent, in); err == nil {
		t.Fatal("an agent model that cannot call tools was saved")
	}
}

func TestAStoredKeyIsNeverSentToAnotherAddress(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.svc.Save(ctx, e.admin, PurposeAnswer, answerInput()); err != nil {
		t.Fatal(err)
	}
	moved := answerInput()
	moved.BaseURL, moved.APIKey = "https://other.example.org/v1", ""
	calls := len(e.tester.calls)
	if err := e.svc.Test(ctx, e.admin, PurposeAnswer, moved); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Test() with a new address and no key = %v, want ErrInvalid", err)
	}
	if _, err := e.svc.Save(ctx, e.admin, PurposeAnswer, moved); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "key") {
		t.Fatalf("Save() with a new address and no key = %v", err)
	}
	if len(e.tester.calls) != calls {
		t.Fatal("the stored key was sent to the new address")
	}
	moved.APIKey = "sk-for-the-new-address"
	if _, err := e.svc.Save(ctx, e.admin, PurposeAnswer, moved); err != nil {
		t.Fatalf("Save() with a key for the new address: %v", err)
	}
	if got := e.tester.calls[len(e.tester.calls)-1]; got.APIKey != "sk-for-the-new-address" {
		t.Fatalf("tested with %+v", got)
	}
}
