package mail

import (
	"bufio"
	"context"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	contract "backend/internal/domain/contract/mail"
)

type received struct {
	from, to string
	data     string
}

// fakeServer speaks just enough SMTP, without TLS or auth, to take one message.
// A non-empty rejectRcpt makes it refuse the recipient with a 550.
func fakeServer(t *testing.T, rejectRcpt bool) (port int, got chan received) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	got = make(chan received, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		write := func(s string) { _, _ = conn.Write([]byte(s + "\r\n")) }
		write("220 fake ready")
		var msg received
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			switch {
			case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
				write("250 fake")
			case strings.HasPrefix(line, "MAIL FROM:"):
				msg.from = line
				write("250 ok")
			case strings.HasPrefix(line, "RCPT TO:"):
				if rejectRcpt {
					write("550 no such user")
					continue
				}
				msg.to = line
				write("250 ok")
			case line == "DATA":
				write("354 go on")
				var data strings.Builder
				for {
					l, err := r.ReadString('\n')
					if err != nil || l == ".\r\n" {
						break
					}
					data.WriteString(l)
				}
				msg.data = data.String()
				write("250 queued")
			case line == "QUIT":
				write("221 bye")
				got <- msg
				return
			default:
				write("250 ok")
			}
		}
	}()
	_, p, _ := net.SplitHostPort(ln.Addr().String())
	port, _ = strconv.Atoi(p)
	return port, got
}

func TestSMTPSendsOneMessage(t *testing.T) {
	port, got := fakeServer(t, false)
	m := NewSMTP("127.0.0.1", port, "", "", "Dokudocs <no-reply@example.test>")

	err := m.Send(context.Background(), contract.Message{To: "ana@example.test", Subject: "Confirm your email", Text: "Open https://app.example.test/verify-email?token=abc_-123\n"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case msg := <-got:
		if !strings.Contains(msg.from, "<no-reply@example.test>") || !strings.Contains(msg.to, "<ana@example.test>") {
			t.Fatalf("envelope = %q / %q", msg.from, msg.to)
		}
		for _, want := range []string{"Subject: Confirm your email", "From: \"Dokudocs\" <no-reply@example.test>", "To: <ana@example.test>", "text/plain; charset=utf-8"} {
			if !strings.Contains(msg.data, want) {
				t.Errorf("message lacks %q:\n%s", want, msg.data)
			}
		}
		// Quoted-printable would split a long link; this one is short, so it survives whole.
		if !strings.Contains(msg.data, "https://app.example.test/verify-email?token=3Dabc_-123") && !strings.Contains(msg.data, "verify-email?token=3Dabc_-123") {
			t.Errorf("the link is not in the body:\n%s", msg.data)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the server never got a message")
	}
}

func TestSMTPReportsARejectedRecipient(t *testing.T) {
	port, _ := fakeServer(t, true)
	m := NewSMTP("127.0.0.1", port, "", "", "no-reply@example.test")
	if err := m.Send(context.Background(), contract.Message{To: "ana@example.test", Subject: "Hi", Text: "x"}); err == nil {
		t.Fatal("a refused recipient must be an error")
	}
}

func TestSMTPRefusesHeaderInjection(t *testing.T) {
	port, got := fakeServer(t, false)
	m := NewSMTP("127.0.0.1", port, "", "", "no-reply@example.test")
	for _, msg := range []contract.Message{
		{To: "ana@example.test\r\nBcc: evil@example.test", Subject: "Hi", Text: "x"},
		{To: "ana@example.test", Subject: "Hi\r\nBcc: evil@example.test", Text: "x"},
	} {
		if err := m.Send(context.Background(), msg); err == nil {
			t.Fatalf("message %+v was sent", msg)
		}
	}
	select {
	case <-got:
		t.Fatal("nothing should have reached the server")
	default:
	}
}

func TestSMTPGivesUpWhenTheServerIsDown(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	_, p, _ := net.SplitHostPort(ln.Addr().String())
	_ = ln.Close()
	port, _ := strconv.Atoi(p)
	m := NewSMTP("127.0.0.1", port, "", "", "no-reply@example.test")
	if err := m.Send(context.Background(), contract.Message{To: "ana@example.test", Subject: "Hi", Text: "x"}); err == nil {
		t.Fatal("want a connection error")
	}
}
