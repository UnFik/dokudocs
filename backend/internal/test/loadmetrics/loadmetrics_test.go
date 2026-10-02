package loadmetrics

import (
	"testing"
	"time"
)

func TestSummarizeUsesNearestRankPercentiles(t *testing.T) {
	var samples []time.Duration
	for i := 100; i >= 1; i-- { // unsorted on purpose
		samples = append(samples, time.Duration(i)*time.Millisecond)
	}
	got := Summarize(samples)
	if got.Count != 100 || got.P50 != 50*time.Millisecond || got.P95 != 95*time.Millisecond ||
		got.P99 != 99*time.Millisecond || got.Max != 100*time.Millisecond {
		t.Fatalf("Summarize = %+v, want n=100 p50=50ms p95=95ms p99=99ms max=100ms", got)
	}
}

func TestSummarizeSmallAndEmptySets(t *testing.T) {
	if got := Summarize(nil); got.Count != 0 || got.P99 != 0 {
		t.Fatalf("Summarize(nil) = %+v, want zero value", got)
	}
	got := Summarize([]time.Duration{7 * time.Millisecond})
	if got.P50 != 7*time.Millisecond || got.P99 != 7*time.Millisecond {
		t.Fatalf("single sample = %+v, want every percentile 7ms", got)
	}
}

func TestSummarizeDoesNotReorderCallerSlice(t *testing.T) {
	in := []time.Duration{3, 1, 2}
	Summarize(in)
	if in[0] != 3 || in[1] != 1 || in[2] != 2 {
		t.Fatalf("input mutated: %v", in)
	}
}
