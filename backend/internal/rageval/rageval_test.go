package rageval

import (
	"context"
	"math"
	"strings"
	"testing"
)

func TestCosineDistanceMatchesPgvectorOperator(t *testing.T) {
	cases := []struct {
		name string
		a, b []float32
		want float64
	}{
		{"identical", []float32{1, 0}, []float32{2, 0}, 0},
		{"orthogonal", []float32{1, 0}, []float32{0, 3}, 1},
		{"opposite", []float32{1, 0}, []float32{-1, 0}, 2},
		{"45 degrees", []float32{1, 0}, []float32{1, 1}, 1 - math.Sqrt2/2},
	}
	for _, c := range cases {
		if got := CosineDistance(c.a, c.b); math.Abs(got-c.want) > 1e-6 {
			t.Errorf("%s: distance = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestEvaluateReportsPrecisionRecallAbstentionAndConflictPerThreshold(t *testing.T) {
	corpus := Corpus{
		Docs: []Doc{{Key: "a"}, {Key: "b"}, {Key: "c"}},
		Cases: []Case{
			{ID: "q1", Kind: KindAnswerable, Relevant: []string{"a"}},
			{ID: "q2", Kind: KindUnanswerable},
			{ID: "q3", Kind: KindConflict, Relevant: []string{"b", "c"}},
		},
	}
	// distances[caseID][docKey]
	distances := map[string]map[string]float64{
		"q1": {"a": 0.10, "b": 0.50, "c": 0.60},
		"q2": {"a": 0.40, "b": 0.45, "c": 0.70},
		"q3": {"a": 0.30, "b": 0.20, "c": 0.34},
	}
	got, err := Evaluate(corpus, distances, []float64{0.15, 0.35, 0.8})
	if err != nil {
		t.Fatal(err)
	}
	want := []ThresholdResult{
		// t=0.15: retrieved q1={a}, q2={}, q3={}. tp=1 fp=0 fn=2 (q3 has two relevant)
		{Threshold: 0.15, Precision: 1, Recall: 1.0 / 3, AbstentionRate: 1, ConflictBothRate: 0},
		// t=0.35: q1={a}, q2={a}? no: 0.40>0.35 so {}, q3={a,b,c}. tp=3 fp=1 fn=0
		{Threshold: 0.35, Precision: 0.75, Recall: 1, AbstentionRate: 1, ConflictBothRate: 1},
		// t=0.8: q1={a,b,c}, q2={a,b,c}, q3={a,b,c}. tp=3 fp=2+1=3
		{Threshold: 0.8, Precision: 0.5, Recall: 1, AbstentionRate: 0, ConflictBothRate: 1},
	}
	for i, w := range want {
		g := got[i]
		if !near(g.Precision, w.Precision) || !near(g.Recall, w.Recall) || !near(g.AbstentionRate, w.AbstentionRate) || !near(g.ConflictBothRate, w.ConflictBothRate) || g.Threshold != w.Threshold {
			t.Errorf("threshold %v = %+v, want %+v", w.Threshold, g, w)
		}
	}
}

func TestEvaluateRejectsMissingDistances(t *testing.T) {
	corpus := Corpus{Docs: []Doc{{Key: "a"}}, Cases: []Case{{ID: "q1", Kind: KindAnswerable, Relevant: []string{"a"}}}}
	if _, err := Evaluate(corpus, map[string]map[string]float64{}, []float64{0.35}); err == nil {
		t.Fatal("Evaluate accepted a case with no measured distances")
	}
}

func TestBestThresholdBalancesF1AndAbstention(t *testing.T) {
	results := []ThresholdResult{
		{Threshold: 0.15, Precision: 1, Recall: 1.0 / 3, AbstentionRate: 1},
		{Threshold: 0.35, Precision: 0.75, Recall: 1, AbstentionRate: 1},
		{Threshold: 0.8, Precision: 0.5, Recall: 1, AbstentionRate: 0},
	}
	if got := BestThreshold(results); got != 0.35 {
		t.Fatalf("BestThreshold = %v, want 0.35", got)
	}
}

func TestBundledCorpusIsBilingualAndWellFormed(t *testing.T) {
	corpus, err := LoadCorpusFile("testdata/corpus.json")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[Kind]int{}
	languages := map[string]int{}
	for _, c := range corpus.Cases {
		kinds[c.Kind]++
		languages[c.Language]++
	}
	if kinds[KindAnswerable] < 6 || kinds[KindUnanswerable] < 3 || kinds[KindConflict] < 2 {
		t.Errorf("case kinds = %v, want >=6 answerable, >=3 unanswerable, >=2 conflict", kinds)
	}
	if languages["id"] < 4 || languages["en"] < 4 {
		t.Errorf("languages = %v, want at least 4 Indonesian and 4 English questions", languages)
	}
}

func TestLoadCorpusRejectsUnknownRelevantDocument(t *testing.T) {
	_, err := ParseCorpus([]byte(`{"docs":[{"key":"a","title":"A","text":"x"}],"cases":[{"id":"q","kind":"answerable","language":"en","question":"?","relevant":["zzz"]}]}`))
	if err == nil {
		t.Fatal("ParseCorpus accepted a relevant key that is not in docs")
	}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

type keywordEmbedder struct{}

// Axis 0 = "health", axis 1 = "backup"; anything else lands on axis 2.
func (keywordEmbedder) Embed(_ context.Context, inputs []string) ([][]float32, error) {
	out := make([][]float32, len(inputs))
	for i, s := range inputs {
		v := []float32{0, 0, 0.01}
		switch {
		case strings.Contains(s, "health"):
			v = []float32{1, 0, 0}
		case strings.Contains(s, "backup"):
			v = []float32{0, 1, 0}
		}
		out[i] = v
	}
	return out, nil
}

func TestMeasureEmbedsDocsAndQuestionsThenSweeps(t *testing.T) {
	corpus := Corpus{
		Docs: []Doc{{Key: "h", Title: "T", Text: "health check restarts"}, {Key: "b", Title: "T", Text: "backup nightly"}},
		Cases: []Case{
			{ID: "q1", Kind: KindAnswerable, Question: "health?", Relevant: []string{"h"}},
			{ID: "q2", Kind: KindUnanswerable, Question: "weather?"},
		},
	}
	got, err := Measure(context.Background(), corpus, keywordEmbedder{}, []float64{0.35})
	if err != nil {
		t.Fatal(err)
	}
	// q1 retrieves only "h" (distance 0); q2 sits on axis 2, distance 1 from both docs.
	if r := got[0]; r.Precision != 1 || r.Recall != 1 || r.AbstentionRate != 1 {
		t.Fatalf("Measure = %+v, want perfect separation", r)
	}
}

func TestFormatTableListsEveryThreshold(t *testing.T) {
	out := FormatTable([]ThresholdResult{{Threshold: 0.35, Precision: 0.75, Recall: 1, AbstentionRate: 1, ConflictBothRate: 0.5}})
	for _, want := range []string{"0.35", "0.750", "1.000", "0.500"} {
		if !strings.Contains(out, want) {
			t.Errorf("table %q missing %q", out, want)
		}
	}
}
