// Package netdelay is a TCP proxy that delays traffic, to emulate a database
// that sits across a network hop. Loopback only; for tests.
package netdelay

import (
	"net"
	"sync"
	"time"
)

type Proxy struct {
	listener net.Listener
	target   string
	oneWay   time.Duration
	wg       sync.WaitGroup
}

// Start listens on a free loopback port and forwards to target. rtt is the
// added round-trip time; each direction is delayed by half of it.
func Start(target string, rtt time.Duration) (*Proxy, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &Proxy{listener: l, target: target, oneWay: rtt / 2}
	p.wg.Add(1)
	go p.accept()
	return p, nil
}

func (p *Proxy) Addr() string { return p.listener.Addr().String() }

func (p *Proxy) Close() {
	_ = p.listener.Close()
	p.wg.Wait()
}

func (p *Proxy) accept() {
	defer p.wg.Done()
	for {
		client, err := p.listener.Accept()
		if err != nil {
			return
		}
		upstream, err := net.Dial("tcp", p.target)
		if err != nil {
			_ = client.Close()
			continue
		}
		p.wg.Add(2)
		go p.pipe(upstream, client)
		go p.pipe(client, upstream)
	}
}

type chunk struct {
	data []byte
	at   time.Time
}

// pipe copies src to dst, releasing each chunk oneWay after it was read so
// that ordering is kept and throughput is not serialized on the delay.
func (p *Proxy) pipe(dst, src net.Conn) {
	defer p.wg.Done()
	queue := make(chan chunk, 1024)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for c := range queue {
			time.Sleep(time.Until(c.at))
			if _, err := dst.Write(c.data); err != nil {
				for range queue {
				}
				return
			}
		}
	}()
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			queue <- chunk{data: append([]byte(nil), buf[:n]...), at: time.Now().Add(p.oneWay)}
		}
		if err != nil {
			break
		}
	}
	close(queue)
	<-done
	_ = dst.Close()
	_ = src.Close()
}
