package routes

import (
	"net/http"
	"os"

	"backend/docs"
)

// ScalarHTML returns the modern HTML page for Scalar API reference.
const ScalarHTML = `<!doctype html>
<html>
  <head>
    <title>Dokudocs API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/></svg>" />
    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/docs/swagger.json"
      data-configuration='{
        "theme": "deepSpace",
        "layout": "modern",
        "showSidebar": true,
        "searchHotKey": "k",
        "hideDownloadButton": false
      }'></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`

func addDocsRoutes(mux *http.ServeMux) {
	docsHandler := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(ScalarHTML))
	}

	mux.HandleFunc("GET /docs", docsHandler)
	mux.HandleFunc("GET /docs/", docsHandler)

	mux.HandleFunc("GET /docs/swagger.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		paths := []string{
			"docs/swagger.json",
			"./docs/swagger.json",
			"../docs/swagger.json",
			"../../docs/swagger.json",
			"../../../docs/swagger.json",
			"../../../../docs/swagger.json",
			"backend/docs/swagger.json",
		}
		for _, p := range paths {
			if content, err := os.ReadFile(p); err == nil {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(content)
				return
			}
		}
		if doc := docs.SwaggerInfo.ReadDoc(); doc != "" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(doc))
			return
		}
		http.Error(w, "swagger spec not found", http.StatusNotFound)
	})

	mux.HandleFunc("GET /docs/swagger.yaml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-yaml; charset=utf-8")
		paths := []string{
			"docs/swagger.yaml",
			"./docs/swagger.yaml",
			"../docs/swagger.yaml",
			"../../docs/swagger.yaml",
			"../../../docs/swagger.yaml",
			"../../../../docs/swagger.yaml",
			"backend/docs/swagger.yaml",
		}
		for _, p := range paths {
			if content, err := os.ReadFile(p); err == nil {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(content)
				return
			}
		}
		http.Error(w, "swagger yaml not found", http.StatusNotFound)
	})
}
