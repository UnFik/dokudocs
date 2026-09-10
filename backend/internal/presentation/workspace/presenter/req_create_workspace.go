package presenter

type CreateWorkspaceRequest struct {
	Name    string `json:"name" validate:"required"`
	Plan    string `json:"plan"`
	LogoURL string `json:"logoUrl"`
}
