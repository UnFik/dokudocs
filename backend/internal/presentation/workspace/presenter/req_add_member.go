package presenter

type AddMemberRequest struct {
	Email string `json:"email" validate:"required"`
	Role  string `json:"role"`
}
