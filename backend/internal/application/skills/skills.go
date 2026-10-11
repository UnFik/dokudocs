// Package skills holds Skills: instructions a Superadmin writes once for every User,
// called by name in a Conversation or from an outside AI client. A Skill never
// grants an AI permission.
package skills

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrForbidden = errors.New("only a superadmin can change skills")
	ErrInvalid   = errors.New("a skill needs a lowercase name of letters, digits and dashes (up to 48), and instructions")
	namePattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,47}$`)
)

type Skill struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Instructions string    `json:"instructions"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Store interface {
	ListSkills(ctx context.Context) ([]Skill, error)
	SkillByName(ctx context.Context, name string) (Skill, bool, error)
	SaveSkill(ctx context.Context, s Skill, by uuid.UUID) (Skill, error)
	DeleteSkill(ctx context.Context, id uuid.UUID) (bool, error)
}

type Superadmins interface {
	IsSuperadmin(ctx context.Context, userID uuid.UUID) (bool, error)
}

type Service struct {
	store  Store
	admins Superadmins
}

func NewService(store Store, admins Superadmins) *Service {
	return &Service{store: store, admins: admins}
}

func (s *Service) requireSuperadmin(ctx context.Context, actor uuid.UUID) error {
	ok, err := s.admins.IsSuperadmin(ctx, actor)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// List is every Skill; any signed-in User may see them.
func (s *Service) List(ctx context.Context) ([]Skill, error) { return s.store.ListSkills(ctx) }

// SkillInstructions implements agent.Skills.
func (s *Service) SkillInstructions(ctx context.Context, name string) (string, bool, error) {
	skill, ok, err := s.store.SkillByName(ctx, name)
	return skill.Instructions, ok, err
}

func (s *Service) Save(ctx context.Context, actor uuid.UUID, skill Skill) (Skill, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return Skill{}, err
	}
	skill.Name = strings.TrimSpace(skill.Name)
	skill.Description = strings.TrimSpace(skill.Description)
	skill.Instructions = strings.TrimSpace(skill.Instructions)
	if !namePattern.MatchString(skill.Name) || skill.Instructions == "" || len(skill.Instructions) > 20000 || len(skill.Description) > 300 {
		return Skill{}, ErrInvalid
	}
	return s.store.SaveSkill(ctx, skill, actor)
}

func (s *Service) Delete(ctx context.Context, actor, id uuid.UUID) (bool, error) {
	if err := s.requireSuperadmin(ctx, actor); err != nil {
		return false, err
	}
	return s.store.DeleteSkill(ctx, id)
}
