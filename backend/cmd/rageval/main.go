// Command rageval sweeps the semantic cosine cutoff against the bundled
// bilingual corpus using the configured embedding provider.
//
//	OPENAI_API_KEY=... go run ./cmd/rageval [-corpus path]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"backend/internal/infrastructure/openai"
	"backend/internal/rageval"
)

type providerEmbedder interface {
	rageval.Embedder
	Provider() string
	Model() string
}

var sweep = []float64{0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60}

func main() {
	corpus := flag.String("corpus", "internal/rageval/testdata/corpus.json", "evaluation corpus JSON")
	flag.Parse()
	var embedder providerEmbedder
	if key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY")); key != "" {
		model := strings.TrimSpace(os.Getenv("RAG_EMBEDDING_MODEL"))
		if model == "" {
			model = "text-embedding-3-small"
		}
		embedder = openai.NewEmbeddingModel(key, model)
	}
	if err := run(context.Background(), *corpus, embedder, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "rageval:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, corpusPath string, embedder providerEmbedder, out io.Writer) error {
	if embedder == nil {
		return errors.New("OPENAI_API_KEY is required: no embedding provider is configured, so nothing was measured")
	}
	corpus, err := rageval.LoadCorpusFile(corpusPath)
	if err != nil {
		return err
	}
	results, err := rageval.Measure(ctx, corpus, embedder, sweep)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "provider %s/%s, %d docs, %d cases (semantic leg only; lexical leg not included)\n", embedder.Provider(), embedder.Model(), len(corpus.Docs), len(corpus.Cases))
	fmt.Fprint(out, rageval.FormatTable(results))
	fmt.Fprintf(out, "suggested cutoff: %.2f\n", rageval.BestThreshold(results))
	return nil
}
