package env

import (
	"testing"
	"time"
)

func TestGetString(t *testing.T) {
	t.Setenv("TEST_KEY", "custom")
	if val := GetString("TEST_KEY", "default"); val != "custom" {
		t.Errorf("expected custom, got %s", val)
	}
	if val := GetString("NON_EXISTENT", "default"); val != "default" {
		t.Errorf("expected default, got %s", val)
	}
}

func TestGetInt(t *testing.T) {
	t.Setenv("INT_KEY", "42")
	t.Setenv("BAD_INT", "not-a-number")

	if val := GetInt("INT_KEY", 10); val != 42 {
		t.Errorf("expected 42, got %d", val)
	}
	if val := GetInt("BAD_INT", 10); val != 10 {
		t.Errorf("expected fallback 10, got %d", val)
	}
	if val := GetInt("NON_EXISTENT", 10); val != 10 {
		t.Errorf("expected fallback 10, got %d", val)
	}
}

func TestGetBool(t *testing.T) {
	t.Setenv("BOOL_TRUE", "true")
	t.Setenv("BOOL_FALSE", "false")
	t.Setenv("BAD_BOOL", "xyz")

	if val := GetBool("BOOL_TRUE", false); val != true {
		t.Errorf("expected true, got %v", val)
	}
	if val := GetBool("BOOL_FALSE", true); val != false {
		t.Errorf("expected false, got %v", val)
	}
	if val := GetBool("BAD_BOOL", true); val != true {
		t.Errorf("expected fallback true, got %v", val)
	}
	if val := GetBool("NON_EXISTENT", false); val != false {
		t.Errorf("expected fallback false, got %v", val)
	}
}

func TestGetFloat(t *testing.T) {
	t.Setenv("FLOAT_KEY", "3.14")
	t.Setenv("BAD_FLOAT", "abc")

	if val := GetFloat("FLOAT_KEY", 1.0); val != 3.14 {
		t.Errorf("expected 3.14, got %f", val)
	}
	if val := GetFloat("BAD_FLOAT", 1.0); val != 1.0 {
		t.Errorf("expected fallback 1.0, got %f", val)
	}
	if val := GetFloat("NON_EXISTENT", 1.0); val != 1.0 {
		t.Errorf("expected fallback 1.0, got %f", val)
	}
}

func TestGetDuration(t *testing.T) {
	t.Setenv("DUR_KEY", "15m")
	t.Setenv("BAD_DUR", "invalid")
	t.Setenv("ZERO_DUR", "0s")

	if val := GetDuration("DUR_KEY", 5*time.Minute); val != 15*time.Minute {
		t.Errorf("expected 15m, got %v", val)
	}
	if val := GetDuration("BAD_DUR", 5*time.Minute); val != 5*time.Minute {
		t.Errorf("expected fallback 5m, got %v", val)
	}
	if val := GetDuration("ZERO_DUR", 5*time.Minute); val != 5*time.Minute {
		t.Errorf("expected fallback 5m for <= 0 duration, got %v", val)
	}
	if val := GetDuration("NON_EXISTENT", 5*time.Minute); val != 5*time.Minute {
		t.Errorf("expected fallback 5m, got %v", val)
	}
}

func TestMustGetEnv(t *testing.T) {
	t.Setenv("MUST_EXIST", "present")
	if val := MustGetEnv("MUST_EXIST"); val != "present" {
		t.Errorf("expected present, got %s", val)
	}
}
