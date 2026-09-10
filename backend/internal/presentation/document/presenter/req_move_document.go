package presenter

import "github.com/google/uuid"

type MoveRequest struct {
	TargetProjectID *uuid.UUID `json:"targetProjectId"`
}
