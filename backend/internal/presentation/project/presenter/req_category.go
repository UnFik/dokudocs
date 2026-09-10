package presenter

import "github.com/google/uuid"

type AddCategoryRequest struct {
	Name    string `json:"name"`
	ColorID string `json:"colorId"`
}

type UpdateCategoryRequest struct {
	Name    string `json:"name"`
	ColorID string `json:"colorId"`
}

type ReorderCategoriesRequest struct {
	CategoryIDs []uuid.UUID `json:"categoryIds"`
}
