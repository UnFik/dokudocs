// Package assetstore keeps uploaded files. Local writes them under a directory.
package assetstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type Local struct {
	root string
}

func NewLocal(root string) *Local { return &Local{root: root} }

// path keeps a key inside the directory: a key is `a/b/c`, never `..`.
func (l *Local) path(key string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(key))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", fmt.Errorf("assetstore: invalid key %q", key)
	}
	return filepath.Join(l.root, clean), nil
}

func (l *Local) Put(_ context.Context, key string, body io.Reader) error {
	target, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return err
	}
	// Written to a temporary name first, so a reader never sees half a file.
	temporary, err := os.CreateTemp(filepath.Dir(target), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if _, err := io.Copy(temporary, body); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), target)
}

func (l *Local) Open(_ context.Context, key string) (io.ReadCloser, error) {
	target, err := l.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(target)
}

func (l *Local) Delete(_ context.Context, key string) error {
	target, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
