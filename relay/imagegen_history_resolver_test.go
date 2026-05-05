package relay

import "testing"

func TestParsePublicTaskContentURL_Recognizes(t *testing.T) {
	cases := []struct {
		name   string
		url    string
		taskID string
		idx    int
	}{
		{
			name:   "https with signature",
			url:    "https://o.cymoon.cn/public/images/async/task_abc/content/0?expires=1&sig=2",
			taskID: "task_abc",
			idx:    0,
		},
		{
			name:   "tenant subdomain, multi-digit index",
			url:    "https://acme.example.com/public/images/async/task_xyz/content/12",
			taskID: "task_xyz",
			idx:    12,
		},
		{
			name:   "no scheme",
			url:    "/public/images/async/task_qq/content/3",
			taskID: "task_qq",
			idx:    3,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, idx, ok := parsePublicTaskContentURL(tc.url)
			if !ok {
				t.Fatalf("expected match for %q", tc.url)
			}
			if id != tc.taskID || idx != tc.idx {
				t.Fatalf("got task=%q idx=%d, want task=%q idx=%d", id, idx, tc.taskID, tc.idx)
			}
		})
	}
}

func TestParsePublicTaskContentURL_Rejects(t *testing.T) {
	cases := []string{
		"",
		"https://example.com/some/other/path",
		"https://example.com/public/images/async/task_abc",                  // no content/idx
		"https://example.com/public/images/async/task_abc/content/notanint", // bad idx
		"https://example.com/public/images/async/task_abc/content/-1",       // negative
		"https://example.com/public/images/async//content/0",                // empty task id
		"https://oss-cn-hangzhou.aliyuncs.com/bucket/key.png",               // not our path
		"data:image/png;base64,xxxx",
	}
	for _, u := range cases {
		t.Run(u, func(t *testing.T) {
			if _, _, ok := parsePublicTaskContentURL(u); ok {
				t.Fatalf("did not expect match for %q", u)
			}
		})
	}
}

func TestResolveHistoryImageURL_PassesThroughUnknownURLs(t *testing.T) {
	// When the URL doesn't match our public proxy shape, resolver returns it
	// untouched without touching the DB or storage client. This is important
	// because the rewrite layer calls the resolver for every Markdown image,
	// including data: URLs and external CDN URLs.
	cases := []string{
		"https://oss-cn-hangzhou.aliyuncs.com/bucket/key.png?Expires=1&Signature=abc",
		"data:image/png;base64,iVBORw0KGgo=",
		"https://cdn.openai.com/something.png",
		"",
	}
	for _, u := range cases {
		if got := resolveHistoryImageURL(u); got != u {
			t.Errorf("expected pass-through for %q, got %q", u, got)
		}
	}
}
