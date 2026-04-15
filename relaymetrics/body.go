package relaymetrics

import "io"

type instrumentedReadCloser struct {
	s *Session
	r io.ReadCloser
}

func InstrumentReadCloser(body io.ReadCloser, s *Session) io.ReadCloser {
	if body == nil || s == nil {
		return body
	}
	return &instrumentedReadCloser{s: s, r: body}
}

func (b *instrumentedReadCloser) Read(p []byte) (n int, err error) {
	n, err = b.r.Read(p)
	if n > 0 {
		b.s.MarkFirstUpstreamByte()
	}
	if err == io.EOF {
		b.s.MarkUpstreamDone()
	}
	return n, err
}

func (b *instrumentedReadCloser) Close() error {
	b.s.MarkUpstreamDone()
	return b.r.Close()
}
