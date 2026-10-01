package rageval

import (
	"context"
	"fmt"
	"strings"
)

type Embedder interface {
	Embed(context.Context, []string) ([][]float32, error)
}

// embedBatchSize stays under the provider adapter's 32-input request limit.
const embedBatchSize = 32

func embedAll(ctx context.Context, e Embedder, inputs []string) ([][]float32, error) {
	out := make([][]float32, 0, len(inputs))
	for start := 0; start < len(inputs); start += embedBatchSize {
		end := min(start+embedBatchSize, len(inputs))
		vectors, err := e.Embed(ctx, inputs[start:end])
		if err != nil {
			return nil, err
		}
		if len(vectors) != end-start {
			return nil, fmt.Errorf("embedder returned %d vectors for %d inputs", len(vectors), end-start)
		}
		out = append(out, vectors...)
	}
	return out, nil
}

// Measure embeds each doc body and question and
// sweeps the cutoffs over the measured cosine distances.
func Measure(ctx context.Context, corpus Corpus, embedder Embedder, thresholds []float64) ([]ThresholdResult, error) {
	docTexts := make([]string, len(corpus.Docs))
	for i, d := range corpus.Docs {
		docTexts[i] = d.Text
	}
	questions := make([]string, len(corpus.Cases))
	for i, c := range corpus.Cases {
		questions[i] = c.Question
	}
	docVectors, err := embedAll(ctx, embedder, docTexts)
	if err != nil {
		return nil, err
	}
	questionVectors, err := embedAll(ctx, embedder, questions)
	if err != nil {
		return nil, err
	}
	distances := make(map[string]map[string]float64, len(corpus.Cases))
	for i, c := range corpus.Cases {
		distances[c.ID] = make(map[string]float64, len(corpus.Docs))
		for j, d := range corpus.Docs {
			distances[c.ID][d.Key] = CosineDistance(questionVectors[i], docVectors[j])
		}
	}
	return Evaluate(corpus, distances, thresholds)
}

func FormatTable(results []ThresholdResult) string {
	var b strings.Builder
	b.WriteString("threshold  precision  recall  f1     abstain  conflict-both\n")
	for _, r := range results {
		fmt.Fprintf(&b, "%-9.2f  %.3f      %.3f   %.3f  %.3f    %.3f\n", r.Threshold, r.Precision, r.Recall, r.F1(), r.AbstentionRate, r.ConflictBothRate)
	}
	return b.String()
}
