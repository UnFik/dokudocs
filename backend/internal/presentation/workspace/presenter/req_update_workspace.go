package presenter

type UpdateWorkspaceRequest struct {
	Name    string `json:"name"`
	Plan    string `json:"plan"`
	LogoURL string `json:"logoUrl"`
}
