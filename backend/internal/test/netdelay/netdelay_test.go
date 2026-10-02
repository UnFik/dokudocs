package netdelay

import (
	"net"
	"testing"
	"time"
)

func TestProxyAddsRoundTripLatencyAndForwardsBytes(t *testing.T) {
	echo, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		c, err := echo.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		buf := make([]byte, 16)
		n, _ := c.Read(buf)
		_, _ = c.Write(buf[:n])
	}()

	proxy, err := Start(echo.Addr().String(), 40*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()

	conn, err := net.Dial("tcp", proxy.Addr())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	begin := time.Now()
	_, _ = conn.Write([]byte("ping"))
	buf := make([]byte, 4)
	if _, err := conn.Read(buf); err != nil {
		t.Fatalf("read through proxy: %v", err)
	}
	rtt := time.Since(begin)
	if string(buf) != "ping" {
		t.Fatalf("got %q, want ping", buf)
	}
	if rtt < 40*time.Millisecond || rtt > 200*time.Millisecond {
		t.Fatalf("round trip %v, want about 40ms", rtt)
	}
}
