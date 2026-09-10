package presenter

import "encoding/json"

type UpdateSettingsRequest struct {
	Theme             string          `json:"theme"`
	FontFamily        string          `json:"fontFamily"`
	Direction         string          `json:"direction"`
	Language          string          `json:"language"`
	NotificationPrefs json.RawMessage `json:"notificationPrefs"`
	EditorPrefs       json.RawMessage `json:"editorPrefs"`
}
