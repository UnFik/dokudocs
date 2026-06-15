package validator

import (
	"fmt"
	"reflect"
	"strings"
)

type Validator struct{}

func New() *Validator { return &Validator{} }

func (v *Validator) Struct(value any) error {
	rv := reflect.Indirect(reflect.ValueOf(value))
	if !rv.IsValid() || rv.Kind() != reflect.Struct {
		return nil
	}
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		if !strings.Contains(field.Tag.Get("validate"), "required") {
			continue
		}
		if isZero(rv.Field(i)) {
			name := field.Tag.Get("json")
			if idx := strings.IndexByte(name, ','); idx >= 0 {
				name = name[:idx]
			}
			if name == "" || name == "-" {
				name = field.Name
			}
			return fmt.Errorf("%s is required", name)
		}
	}
	return nil
}

func isZero(value reflect.Value) bool {
	if value.Kind() == reflect.String {
		return strings.TrimSpace(value.String()) == ""
	}
	return value.IsZero()
}
