package presenter

type CreateProjectRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	LogoURL     string   `json:"logoUrl"`
	ColorBadge  string   `json:"colorBadge"`
	Visibility  string   `json:"visibility"`
	Categories  []string `json:"categories"`
}
