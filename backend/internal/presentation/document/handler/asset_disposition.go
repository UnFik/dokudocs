package handler

import (
	"mime"
	"time"
)

const uploadDeadline = 2 * time.Minute

func timeNowPlus(d time.Duration) time.Time { return time.Now().Add(d) }

func attachment(name string) string {
	return mime.FormatMediaType("attachment", map[string]string{"filename": name})
}
