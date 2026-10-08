package assetstore

import (
	"bytes"
	"context"
	"io"
	"testing"
)

func TestLocalKeepsAndRemovesFiles(t *testing.T) {
	store := NewLocal(t.TempDir())
	ctx := context.Background()
	if err := store.Put(ctx, "ws/doc/asset", bytes.NewBufferString("hello")); err != nil {
		t.Fatalf("Put() = %v", err)
	}
	reader, err := store.Open(ctx, "ws/doc/asset")
	if err != nil {
		t.Fatalf("Open() = %v", err)
	}
	got, _ := io.ReadAll(reader)
	_ = reader.Close()
	if string(got) != "hello" {
		t.Fatalf("read %q, want hello", got)
	}
	if err := store.Delete(ctx, "ws/doc/asset"); err != nil {
		t.Fatalf("Delete() = %v", err)
	}
	if _, err := store.Open(ctx, "ws/doc/asset"); err == nil {
		t.Fatal("Open() after Delete succeeded")
	}
	if err := store.Delete(ctx, "ws/doc/asset"); err != nil {
		t.Fatalf("Delete() of a missing file = %v, want nil", err)
	}
}

func TestLocalKeepsKeysInsideItsDirectory(t *testing.T) {
	store := NewLocal(t.TempDir())
	for _, key := range []string{"../escape", "/absolute", "a/../../escape", ""} {
		if err := store.Put(context.Background(), key, bytes.NewBufferString("x")); err == nil {
			t.Fatalf("Put(%q) succeeded, want an error", key)
		}
	}
}
