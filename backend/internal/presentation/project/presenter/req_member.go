package presenter

type AddMemberRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}
