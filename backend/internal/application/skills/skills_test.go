package skills

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type mem struct {
	admins map[uuid.UUID]bool
	rows   map[string]Skill
}

func (m *mem) IsSuperadmin(_ context.Context, id uuid.UUID) (bool, error) { return m.admins[id], nil }
func (m *mem) ListSkills(context.Context) ([]Skill, error) {
	out := []Skill{}
	for _, s := range m.rows {
		out = append(out, s)
	}
	return out, nil
}
func (m *mem) SkillByName(_ context.Context, name string) (Skill, bool, error) {
	s, ok := m.rows[name]
	return s, ok, nil
}
func (m *mem) SaveSkill(_ context.Context, s Skill, _ uuid.UUID) (Skill, error) {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	for name, existing := range m.rows {
		if existing.ID == s.ID {
			delete(m.rows, name)
		}
	}
	m.rows[s.Name] = s
	return s, nil
}
func (m *mem) DeleteSkill(_ context.Context, id uuid.UUID) (bool, error) {
	for name, s := range m.rows {
		if s.ID == id {
			delete(m.rows, name)
			return true, nil
		}
	}
	return false, nil
}

func TestOnlyASuperadminWritesSkillsButEveryoneCanUseThem(t *testing.T) {
	store := &mem{admins: map[uuid.UUID]bool{}, rows: map[string]Skill{}}
	admin := uuid.New()
	store.admins[admin] = true
	svc := NewService(store, store)
	skill := Skill{Name: "write-adr", Description: "Draft an ADR", Instructions: "Write one paragraph: context, decision, why."}
	if _, err := svc.Save(context.Background(), uuid.New(), skill); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a member saved a skill: %v", err)
	}
	saved, err := svc.Save(context.Background(), admin, skill)
	if err != nil || saved.ID == uuid.Nil {
		t.Fatalf("Save() = %+v, %v", saved, err)
	}
	text, ok, err := svc.SkillInstructions(context.Background(), "write-adr")
	if err != nil || !ok || text != skill.Instructions {
		t.Fatalf("SkillInstructions() = %q, %v, %v", text, ok, err)
	}
	list, _ := svc.List(context.Background())
	if len(list) != 1 {
		t.Fatalf("List() = %+v", list)
	}
	if ok, err := svc.Delete(context.Background(), uuid.New(), saved.ID); ok || !errors.Is(err, ErrForbidden) {
		t.Fatalf("a member deleted a skill: %v %v", ok, err)
	}
	if ok, err := svc.Delete(context.Background(), admin, saved.ID); !ok || err != nil {
		t.Fatalf("Delete() = %v, %v", ok, err)
	}
}

func TestASkillNeedsAShortLowercaseNameAndInstructions(t *testing.T) {
	store := &mem{admins: map[uuid.UUID]bool{}, rows: map[string]Skill{}}
	admin := uuid.New()
	store.admins[admin] = true
	svc := NewService(store, store)
	for _, bad := range []Skill{
		{Name: "Write ADR", Instructions: "x"},
		{Name: "-start", Instructions: "x"},
		{Name: "ok", Instructions: "   "},
		{Name: "toolongtoolongtoolongtoolongtoolongtoolongtoolong1", Instructions: "x"},
	} {
		if _, err := svc.Save(context.Background(), admin, bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("Save(%+v) error = %v", bad, err)
		}
	}
}
