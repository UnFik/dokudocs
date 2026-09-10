package presenter

type AddAccessRequest struct {
	Email string `json:"email"`
	Level string `json:"level"`
}
