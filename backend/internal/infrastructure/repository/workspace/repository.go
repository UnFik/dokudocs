package workspace

import (
	"backend/internal/infrastructure/database"
)

type Repository struct {
	db database.Queryer
	tx database.DB
}

func NewRepository(db database.DB) *Repository {
	return &Repository{db: db, tx: db}
}
