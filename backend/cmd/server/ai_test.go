package main

import (
	"strings"
	"testing"

	"backend/internal/config"
)

func TestTheServerRefusesToStartWithoutAValidEncryptionKey(t *testing.T) {
	for name, key := range map[string]string{
		"missing":    "",
		"not base64": "***",
		"too short":  "c2hvcnQ=",
	} {
		_, err := newSecretBox(config.Config{AISettingsEncryptionKey: key})
		if err == nil || !strings.Contains(err.Error(), "AI_SETTINGS_ENCRYPTION_KEY") {
			t.Errorf("%s: newSecretBox() error = %v, want one naming AI_SETTINGS_ENCRYPTION_KEY", name, err)
		}
	}
	key := strings.Repeat("A", 43) + "="
	if _, err := newSecretBox(config.Config{AISettingsEncryptionKey: key}); err != nil {
		t.Errorf("a 32-byte base64 key was refused: %v", err)
	}
}
