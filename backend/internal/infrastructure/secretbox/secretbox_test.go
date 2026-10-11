package secretbox

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(fill byte) string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32))
}

func TestASealedSecretOpensToTheSameText(t *testing.T) {
	box, err := New(testKey(1))
	if err != nil {
		t.Fatalf("New(): %v", err)
	}
	sealed, err := box.Seal("sk-live-1234567890")
	if err != nil {
		t.Fatalf("Seal(): %v", err)
	}
	if bytes.Contains(sealed, []byte("sk-live")) {
		t.Fatal("the sealed value contains the secret in clear text")
	}
	opened, err := box.Open(sealed)
	if err != nil || opened != "sk-live-1234567890" {
		t.Fatalf("Open() = %q, %v", opened, err)
	}
}

func TestSealingTheSameSecretTwiceGivesDifferentBytes(t *testing.T) {
	box, _ := New(testKey(1))
	a, _ := box.Seal("same")
	b, _ := box.Seal("same")
	if bytes.Equal(a, b) {
		t.Fatal("two seals of one secret are identical, so the nonce is reused")
	}
}

func TestASecretDoesNotOpenWithAnotherKeyOrWhenChanged(t *testing.T) {
	box, _ := New(testKey(1))
	other, _ := New(testKey(2))
	sealed, _ := box.Seal("secret")
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("a different key opened the secret")
	}
	sealed[len(sealed)-1] ^= 0xff
	if _, err := box.Open(sealed); err == nil {
		t.Fatal("a changed secret was opened")
	}
	if _, err := box.Open([]byte("short")); err == nil {
		t.Fatal("a truncated value was opened")
	}
}

func TestTheKeyMustBe32BytesOfBase64(t *testing.T) {
	for name, key := range map[string]string{
		"empty":      "",
		"not base64": "***",
		"too short":  base64.StdEncoding.EncodeToString([]byte("short")),
		"too long":   base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", 33))),
	} {
		if _, err := New(key); err == nil {
			t.Errorf("%s: New() accepted the key", name)
		}
	}
}
