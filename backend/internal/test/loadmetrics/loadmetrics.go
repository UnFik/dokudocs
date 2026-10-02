// Package loadmetrics summarizes latency samples captured by load tests.
package loadmetrics

import (
	"sort"
	"time"
)

type Summary struct {
	Count         int
	P50, P95, P99 time.Duration
	Max           time.Duration
}

// Summarize returns nearest-rank percentiles. The input is left untouched.
func Summarize(samples []time.Duration) Summary {
	if len(samples) == 0 {
		return Summary{}
	}
	sorted := append([]time.Duration(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	rank := func(p int) time.Duration {
		i := (p*len(sorted)+99)/100 - 1
		if i < 0 {
			i = 0
		}
		return sorted[i]
	}
	return Summary{Count: len(sorted), P50: rank(50), P95: rank(95), P99: rank(99), Max: sorted[len(sorted)-1]}
}
