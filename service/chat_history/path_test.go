package chat_history

import "testing"

func TestIsChatPath(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"/v1/chat/completions", true},
		{"/v1/completions", true},
		{"/v1/responses", true},
		{"/v1/messages", true},

		// Trailing slash + casing should not defeat the gate; clients in the
		// wild send all of these variants.
		{"/v1/chat/completions/", true},
		{"/V1/Chat/Completions", true},

		// Out of scope for v1: image, audio, embedding, task, unknown paths.
		// If we ever expand scope, these stop returning false — make sure to
		// update both the path table and this test.
		{"/v1/images/generations", false},
		{"/v1/images/edits", false},
		{"/v1/audio/transcriptions", false},
		{"/v1/audio/speech", false},
		{"/v1/embeddings", false},
		{"/v1/realtime", false},
		{"/api/user/self", false},
		{"", false},
		{"/", false},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			if got := IsChatPath(tc.in); got != tc.want {
				t.Errorf("IsChatPath(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
