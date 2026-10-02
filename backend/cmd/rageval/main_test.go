package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

type axisEmbedder struct{}

func (axisEmbedder) Provider() string { return "fake" }
func (axisEmbedder) Model() string    { return "axis" }
func (axisEmbedder) Embed(_ context.Context, in []string) ([][]float32, error) {
	out := make([][]float32, len(in))
	for i := range in {
		out[i] = []float32{1, 0}
	}
	return out, nil
}

func TestRunWithoutAPIKeyExplainsNothingWasMeasured(t *testing.T) {
	var out bytes.Buffer
	err := run(context.Background(), "../../internal/rageval/testdata/corpus.json", nil, &out)
	if err == nil || !strings.Contains(err.Error(), "OPENAI_API_KEY") {
		t.Fatalf("run without an embedder = %v, want an OPENAI_API_KEY error", err)
	}
	if out.Len() != 0 {
		t.Fatalf("run printed %q without measuring anything", out.String())
	}
}

func TestRunPrintsSweepAndProviderIdentity(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), "../../internal/rageval/testdata/corpus.json", axisEmbedder{}, &out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"fake/axis", "threshold", "0.35", "suggested cutoff"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output missing %q:\n%s", want, out.String())
		}
	}
}
