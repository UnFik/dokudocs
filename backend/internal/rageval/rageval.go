// Package rageval measures semantic retrieval quality for the RAG cosine cutoff.
// It is pure computation over embeddings so the same code runs against a fake
// embedder in tests and a real provider in cmd/rageval.
package rageval

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
)

type Kind string

const (
	KindAnswerable   Kind = "answerable"
	KindUnanswerable Kind = "unanswerable"
	KindConflict     Kind = "conflict"
)

type Doc struct {
	Key      string `json:"key"`
	Title    string `json:"title"`
	Language string `json:"language"`
	Text     string `json:"text"`
}

type Case struct {
	ID       string   `json:"id"`
	Kind     Kind     `json:"kind"`
	Language string   `json:"language"`
	Question string   `json:"question"`
	Relevant []string `json:"relevant"`
}

type Corpus struct {
	Docs  []Doc  `json:"docs"`
	Cases []Case `json:"cases"`
}

func ParseCorpus(data []byte) (Corpus, error) {
	var corpus Corpus
	if err := json.Unmarshal(data, &corpus); err != nil {
		return Corpus{}, err
	}
	keys := make(map[string]struct{}, len(corpus.Docs))
	for _, doc := range corpus.Docs {
		if doc.Key == "" || doc.Text == "" {
			return Corpus{}, errors.New("every doc needs a key and text")
		}
		keys[doc.Key] = struct{}{}
	}
	for _, c := range corpus.Cases {
		switch c.Kind {
		case KindAnswerable, KindConflict:
			if len(c.Relevant) == 0 {
				return Corpus{}, fmt.Errorf("case %s needs relevant docs", c.ID)
			}
		case KindUnanswerable:
			if len(c.Relevant) > 0 {
				return Corpus{}, fmt.Errorf("case %s is unanswerable but lists relevant docs", c.ID)
			}
		default:
			return Corpus{}, fmt.Errorf("case %s has unknown kind %q", c.ID, c.Kind)
		}
		for _, key := range c.Relevant {
			if _, ok := keys[key]; !ok {
				return Corpus{}, fmt.Errorf("case %s references unknown doc %q", c.ID, key)
			}
		}
	}
	return corpus, nil
}

func LoadCorpusFile(path string) (Corpus, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Corpus{}, err
	}
	return ParseCorpus(data)
}

// CosineDistance is 1 - cosine similarity, the value pgvector's <=> returns.
func CosineDistance(a, b []float32) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	return 1 - dot/(math.Sqrt(na)*math.Sqrt(nb))
}

type ThresholdResult struct {
	Threshold float64
	// Precision and Recall are micro-averaged over answerable and conflict cases.
	Precision float64
	Recall    float64
	// AbstentionRate is the share of unanswerable cases where nothing passes the cutoff.
	AbstentionRate float64
	// ConflictBothRate is the share of conflict cases where every conflicting source passes.
	ConflictBothRate float64
}

func (r ThresholdResult) F1() float64 {
	if r.Precision+r.Recall == 0 {
		return 0
	}
	return 2 * r.Precision * r.Recall / (r.Precision + r.Recall)
}

// Evaluate applies each cutoff to measured distances[caseID][docKey].
func Evaluate(corpus Corpus, distances map[string]map[string]float64, thresholds []float64) ([]ThresholdResult, error) {
	for _, c := range corpus.Cases {
		for _, doc := range corpus.Docs {
			if _, ok := distances[c.ID][doc.Key]; !ok {
				return nil, fmt.Errorf("no distance for case %s and doc %s", c.ID, doc.Key)
			}
		}
	}
	results := make([]ThresholdResult, 0, len(thresholds))
	for _, t := range thresholds {
		var tp, fp, fn, unanswerable, abstained, conflicts, conflictsBoth int
		for _, c := range corpus.Cases {
			relevant := make(map[string]struct{}, len(c.Relevant))
			for _, key := range c.Relevant {
				relevant[key] = struct{}{}
			}
			retrieved := 0
			found := 0
			for _, doc := range corpus.Docs {
				if distances[c.ID][doc.Key] > t {
					continue
				}
				retrieved++
				if _, ok := relevant[doc.Key]; ok {
					found++
				}
			}
			switch c.Kind {
			case KindUnanswerable:
				unanswerable++
				if retrieved == 0 {
					abstained++
				}
				continue
			case KindConflict:
				conflicts++
				if found == len(relevant) {
					conflictsBoth++
				}
			}
			tp += found
			fp += retrieved - found
			fn += len(relevant) - found
		}
		result := ThresholdResult{Threshold: t}
		if tp+fp > 0 {
			result.Precision = float64(tp) / float64(tp+fp)
		}
		if tp+fn > 0 {
			result.Recall = float64(tp) / float64(tp+fn)
		}
		if unanswerable > 0 {
			result.AbstentionRate = float64(abstained) / float64(unanswerable)
		}
		if conflicts > 0 {
			result.ConflictBothRate = float64(conflictsBoth) / float64(conflicts)
		}
		results = append(results, result)
	}
	return results, nil
}

// BestThreshold picks the cutoff with the highest mean of F1 and abstention rate;
// the earliest threshold wins ties so the stricter cutoff is preferred.
func BestThreshold(results []ThresholdResult) float64 {
	best, bestScore := 0.0, -1.0
	for _, r := range results {
		if score := (r.F1() + r.AbstentionRate) / 2; score > bestScore+1e-12 {
			best, bestScore = r.Threshold, score
		}
	}
	return best
}
