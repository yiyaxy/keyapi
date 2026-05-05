// Package chat_history wires up the "view conversation history" admin
// feature on the relay side: gating which routes get captured, buffering
// request/response bodies during a relay call, and uploading the captured
// envelope to object storage after the call completes.
//
// v1 scope (deliberate): chat-style relay paths only. We do not capture
// image generation, audio, embeddings, or task-platform routes here — those
// either have their own structured logging (imagegen.RequestJSONL) or carry
// large binary payloads that the admin UI is not designed to render yet.
//
// Adding new captured paths is a one-line change to capturedPaths below.
package chat_history

import "strings"

// capturedPaths lists the relay sub-paths (relative to the /v1 group) that
// should have their request + response bodies captured. Comparison is exact
// after stripping the prefix — wildcards are not used because the relay
// router uses literal POST paths only.
var capturedPaths = map[string]struct{}{
	"/v1/chat/completions": {},
	"/v1/completions":      {},
	"/v1/responses":        {},
	"/v1/messages":         {}, // Claude-format clients
}

// IsChatPath returns true when the given request path is one we record for
// the chat-history feature. Trailing slashes and case differences are
// normalized so a misconfigured client reaching `/v1/chat/completions/`
// still gets captured.
func IsChatPath(path string) bool {
	p := strings.ToLower(strings.TrimRight(strings.TrimSpace(path), "/"))
	if p == "" {
		return false
	}
	_, ok := capturedPaths[p]
	return ok
}
