package logger

import (
	"log"
	"os"
)

type Logger struct {
	logger *log.Logger
}

func New() *Logger {
	return &Logger{logger: log.New(os.Stdout, "", log.LstdFlags)}
}

func (l *Logger) Printf(format string, args ...any) {
	l.logger.Printf(format, args...)
}

func (l *Logger) Fatalf(format string, args ...any) {
	l.logger.Fatalf(format, args...)
}
