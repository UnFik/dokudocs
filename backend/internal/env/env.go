package env

import (
	"log"
	"os"
	"strconv"
	"time"
)

func GetString(key, fallback string) string {
	val, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}

	return val
}

func GetInt(key string, fallback int) int {
	valStr, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}

	valInt, err := strconv.Atoi(valStr)
	if err != nil {
		return fallback
	}

	return valInt
}

func GetBool(key string, fallback bool) bool {
	valStr, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}

	valBool, err := strconv.ParseBool(valStr)
	if err != nil {
		return fallback
	}

	return valBool
}

func GetFloat(key string, fallback float64) float64 {
	valStr, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}

	valFloat, err := strconv.ParseFloat(valStr, 64)
	if err != nil {
		return fallback
	}

	return valFloat
}

// MustGetEnv to get an env with k is the variable key and if it's null make the system exited.
func MustGetEnv(k string) (v string) {
	v, ok := os.LookupEnv(k)
	if !ok {
		log.Fatalf("fatal err: %s environment variable not set.\n", k)
	}

	return
}

func GetDuration(key string, fallback time.Duration) time.Duration {
	valStr, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}

	valDuration, err := time.ParseDuration(valStr)
	if err != nil || valDuration <= 0 {
		return fallback
	}

	return valDuration
}
