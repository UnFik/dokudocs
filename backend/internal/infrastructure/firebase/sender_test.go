package firebase

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	notifycontract "backend/internal/domain/contract/notification"

	"github.com/google/uuid"
)

type fakeTokens struct {
	mu      sync.Mutex
	tokens  map[uuid.UUID][]string
	dropped []string
	listErr error
}

func (f *fakeTokens) Tokens(_ context.Context, userID uuid.UUID) ([]string, error) {
	return f.tokens[userID], f.listErr
}

func (f *fakeTokens) Drop(_ context.Context, token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dropped = append(f.dropped, token)
	return nil
}

type sentMessage struct {
	Message struct {
		Token string            `json:"token"`
		Data  map[string]string `json:"data"`
	} `json:"message"`
}

func TestSendsDataOnlyToEveryRegisteredBrowser(t *testing.T) {
	var mu sync.Mutex
	var sent []sentMessage
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var message sentMessage
		if err := json.Unmarshal(body, &message); err != nil {
			t.Errorf("body %s is not JSON: %v", body, err)
		}
		mu.Lock()
		sent, paths = append(sent, message), append(paths, r.URL.Path)
		mu.Unlock()
		_, _ = w.Write([]byte(`{"name":"projects/p/messages/1"}`))
	}))
	defer server.Close()
	user := uuid.New()
	store := &fakeTokens{tokens: map[uuid.UUID][]string{user: {"tok-a", "tok-b"}}}
	sender := newSender(server.Client(), server.URL, "dokudocs-test", store)

	err := sender.SendToUser(context.Background(), user, notifycontract.PushMessage{Title: "Fikri mentioned you", Body: "can you check?", URL: "https://docs.example.com/docs/1?thread=2"})
	if err != nil {
		t.Fatalf("SendToUser() = %v", err)
	}
	if len(sent) != 2 || paths[0] != "/v1/projects/dokudocs-test/messages:send" {
		t.Fatalf("sent %d messages to %v, want two to the project's send endpoint", len(sent), paths)
	}
	for _, message := range sent {
		want := map[string]string{"title": "Fikri mentioned you", "body": "can you check?", "url": "https://docs.example.com/docs/1?thread=2"}
		for key, value := range want {
			if message.Message.Data[key] != value {
				t.Errorf("data[%q] = %q, want %q", key, message.Message.Data[key], value)
			}
		}
	}
	if got := []string{sent[0].Message.Token, sent[1].Message.Token}; !(got[0] == "tok-a" && got[1] == "tok-b") && !(got[0] == "tok-b" && got[1] == "tok-a") {
		t.Fatalf("tokens = %v, want both", got)
	}
}

func TestADeviceFirebaseDoesNotKnowIsDropped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var message sentMessage
		_ = json.Unmarshal(body, &message)
		switch message.Message.Token {
		case "gone":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":404,"status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`))
		case "malformed":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"code":400,"message":"The registration token is not a valid FCM registration token","status":"INVALID_ARGUMENT"}}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer server.Close()
	user := uuid.New()
	store := &fakeTokens{tokens: map[uuid.UUID][]string{user: {"gone", "malformed", "alive"}}}
	err := newSender(server.Client(), server.URL, "p", store).SendToUser(context.Background(), user, notifycontract.PushMessage{Title: "t"})
	if err != nil {
		t.Fatalf("SendToUser() = %v, want gone devices to be forgotten quietly", err)
	}
	if len(store.dropped) != 2 {
		t.Fatalf("dropped %v, want the unregistered and the malformed token", store.dropped)
	}
}

func TestOtherFailuresAreReportedAndNothingIsDropped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"code":503,"status":"UNAVAILABLE"}}`))
	}))
	defer server.Close()
	user := uuid.New()
	store := &fakeTokens{tokens: map[uuid.UUID][]string{user: {"tok"}}}
	if err := newSender(server.Client(), server.URL, "p", store).SendToUser(context.Background(), user, notifycontract.PushMessage{Title: "t"}); err == nil {
		t.Fatal("SendToUser() = nil on a 503, want the failure")
	}
	if len(store.dropped) != 0 {
		t.Fatalf("dropped %v on a server error, want the token kept", store.dropped)
	}
}

func TestAPersonWithNoBrowserIsNotAnError(t *testing.T) {
	store := &fakeTokens{}
	if err := newSender(http.DefaultClient, "http://127.0.0.1:1", "p", store).SendToUser(context.Background(), uuid.New(), notifycontract.PushMessage{Title: "t"}); err != nil {
		t.Fatalf("SendToUser() with no tokens = %v, want nil", err)
	}
	store.listErr = errors.New("db down")
	if err := newSender(http.DefaultClient, "http://127.0.0.1:1", "p", store).SendToUser(context.Background(), uuid.New(), notifycontract.PushMessage{Title: "t"}); err == nil {
		t.Fatal("SendToUser() with the token list failing = nil, want the error")
	}
}

func TestCredentialsThatAreNotAServiceAccountAreRefused(t *testing.T) {
	if _, _, err := NewFromCredentials(context.Background(), []byte(`not json`), "", &fakeTokens{}); err == nil {
		t.Fatal("NewFromCredentials() accepted something that is not a service account")
	}
}

func TestSignsInWithTheServiceAccountKeyAndSendsWithTheToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustPKCS8(t, key)})

	var exchanged, authorization string
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		exchanged = r.PostForm.Get("grant_type")
		_, _ = w.Write([]byte(`{"access_token":"ya29.stub","token_type":"Bearer","expires_in":3600}`))
	}))
	defer tokenServer.Close()
	fcm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer fcm.Close()

	account, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": "dokudocs-test", "private_key_id": "k1",
		"private_key": string(pemKey), "client_email": "push@dokudocs-test.iam.gserviceaccount.com",
		"token_uri": tokenServer.URL,
	})
	user := uuid.New()
	store := &fakeTokens{tokens: map[uuid.UUID][]string{user: {"tok"}}}
	sender, project, err := NewFromCredentials(context.Background(), account, "", store, WithEndpoint(fcm.URL))
	if err != nil || project != "dokudocs-test" {
		t.Fatalf("NewFromCredentials() = %v, project %q, want the key's own project", err, project)
	}
	if err := sender.SendToUser(context.Background(), user, notifycontract.PushMessage{Title: "t"}); err != nil {
		t.Fatalf("SendToUser() = %v", err)
	}
	if exchanged != "urn:ietf:params:oauth:grant-type:jwt-bearer" || authorization != "Bearer ya29.stub" {
		t.Fatalf("signed in with grant %q and sent with %q, want the JWT bearer exchange and its token", exchanged, authorization)
	}
}

func mustPKCS8(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}
