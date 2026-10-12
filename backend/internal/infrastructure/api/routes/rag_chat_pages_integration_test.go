//go:build integration

package routes

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
)

type historyPage struct {
	Data struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
		NextCursor *string `json:"nextCursor"`
	} `json:"data"`
}

func (p historyPage) contents() []string {
	out := make([]string, len(p.Data.Messages))
	for i, m := range p.Data.Messages {
		out[i] = m.Content
	}
	return out
}

func (r *runEnv) seedMessages(n int) {
	r.t.Helper()
	for i := 1; i <= n; i++ {
		role := "user"
		if i%2 == 0 {
			role = "assistant"
		}
		if _, err := r.db.Exec(`INSERT INTO rag_messages (conversation_id, sequence_no, role, content) VALUES ($1, $2, $3, $4)`,
			r.conv, i, role, fmt.Sprintf("m%d", i)); err != nil {
			r.t.Fatal(err)
		}
	}
}

func (r *runEnv) page(u tokenUser, query url.Values) (int, historyPage) {
	r.t.Helper()
	path := "/api/v1/rag/conversations/" + r.conv
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	res := r.do(http.MethodGet, path, nil, r.headers(u, ""), "")
	var body historyPage
	res.json(&body)
	return res.Code, body
}

func sequence(from, to int) []string {
	out := make([]string, 0, to-from+1)
	for i := from; i <= to; i++ {
		out = append(out, fmt.Sprintf("m%d", i))
	}
	return out
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestConversationHistoryIsReadNewestPageFirst(t *testing.T) {
	r := newRunEnv(t)
	r.seedMessages(70)

	code, first := r.page(r.owner, nil)
	if code != http.StatusOK {
		t.Fatalf("first page = %d", code)
	}
	if want := sequence(41, 70); !sameStrings(first.contents(), want) {
		t.Fatalf("first page = %v, want the newest 30 oldest-first %v", first.contents(), want)
	}
	if first.Data.NextCursor == nil || *first.Data.NextCursor == "" {
		t.Fatal("first page has older messages but no nextCursor")
	}

	code, second := r.page(r.owner, url.Values{"before": {*first.Data.NextCursor}})
	if code != http.StatusOK {
		t.Fatalf("second page = %d", code)
	}
	if want := sequence(11, 40); !sameStrings(second.contents(), want) {
		t.Fatalf("second page = %v, want %v", second.contents(), want)
	}
	if second.Data.NextCursor == nil {
		t.Fatal("second page has older messages but no nextCursor")
	}

	code, third := r.page(r.owner, url.Values{"before": {*second.Data.NextCursor}})
	if code != http.StatusOK {
		t.Fatalf("third page = %d", code)
	}
	if want := sequence(1, 10); !sameStrings(third.contents(), want) {
		t.Fatalf("third page = %v, want %v", third.contents(), want)
	}
	if third.Data.NextCursor != nil {
		t.Fatalf("oldest page nextCursor = %q, want none", *third.Data.NextCursor)
	}
}

func TestConversationHistoryPageSizeAndEdges(t *testing.T) {
	r := newRunEnv(t)
	r.seedMessages(30)

	_, small := r.page(r.owner, url.Values{"limit": {"5"}})
	if want := sequence(26, 30); !sameStrings(small.contents(), want) {
		t.Fatalf("limit=5 = %v, want %v", small.contents(), want)
	}

	// Exactly one page of messages leaves nothing older to fetch.
	_, whole := r.page(r.owner, nil)
	if len(whole.Data.Messages) != 30 || whole.Data.NextCursor != nil {
		t.Fatalf("30 messages in one page of 30 = %d messages, nextCursor %v", len(whole.Data.Messages), whole.Data.NextCursor)
	}

	// A new message after the first page does not shift the next one.
	_, newest := r.page(r.owner, url.Values{"limit": {"10"}})
	if _, err := r.db.Exec(`INSERT INTO rag_messages (conversation_id, sequence_no, role, content) VALUES ($1, 31, 'user', 'm31')`, r.conv); err != nil {
		t.Fatal(err)
	}
	_, older := r.page(r.owner, url.Values{"limit": {"10"}, "before": {*newest.Data.NextCursor}})
	if want := sequence(11, 20); !sameStrings(older.contents(), want) {
		t.Fatalf("older page after a new message = %v, want %v", older.contents(), want)
	}
}

func TestConversationHistoryRejectsBadPaging(t *testing.T) {
	r := newRunEnv(t)
	r.seedMessages(3)
	for name, query := range map[string]url.Values{
		"garbage cursor": {"before": {"not-a-cursor"}},
		"zero limit":     {"limit": {"0"}},
		"text limit":     {"limit": {"many"}},
		"negative limit": {"limit": {"-1"}},
	} {
		if code, _ := r.page(r.owner, query); code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", name, code)
		}
	}
	if code, page := r.page(r.owner, url.Values{"limit": {"1000"}}); code != http.StatusOK || len(page.Data.Messages) != 3 {
		t.Errorf("an oversized limit is capped, not refused: %d, %d messages", code, len(page.Data.Messages))
	}
}

func TestConversationHistoryStaysPrivateAcrossPages(t *testing.T) {
	r := newRunEnv(t)
	r.seedMessages(40)
	_, first := r.page(r.owner, nil)
	other := r.registerWithToken("")
	code, _ := r.page(other, url.Values{"before": {*first.Data.NextCursor}})
	if code != http.StatusNotFound {
		t.Fatalf("another User's page = %d, want 404", code)
	}
}
