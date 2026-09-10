package user

import (
	"backend/internal/infrastructure/database"
)

type Repository struct {
	db database.Queryer
}

func NewRepository(db database.Queryer) *Repository {
	return &Repository{db: db}
}
