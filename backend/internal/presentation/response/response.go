package response

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

type Envelope struct {
	Data any `json:"data,omitempty"`
}

type ErrorEnvelope struct {
	Title string `json:"title"`
}

func Data(w http.ResponseWriter, status int, payload any) error {
	return writeJSON(w, status, Envelope{Data: payload})
}

func Error(w http.ResponseWriter, status int, title string) {
	_ = writeJSON(w, status, ErrorEnvelope{Title: title})
}

func DecodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("empty body")
		}
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("body must contain one JSON value")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
