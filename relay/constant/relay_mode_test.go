package constant

import "testing"

func TestPath2RelayModeSupportsPlaygroundRoutes(t *testing.T) {
	cases := []struct {
		path string
		want int
	}{
		{path: "/pg/chat/completions", want: RelayModeChatCompletions},
		{path: "/pg/responses", want: RelayModeResponses},
		{path: "/pg/images/generations", want: RelayModeImagesGenerations},
		{path: "/pg/images/async", want: RelayModeImagesAsyncSubmit},
		{path: "/pg/images/async/task_abc", want: RelayModeImagesAsyncFetchByID},
		{path: "/pg/embeddings", want: RelayModeEmbeddings},
		{path: "/pg/rerank", want: RelayModeRerank},
	}

	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			if got := Path2RelayMode(tc.path); got != tc.want {
				t.Fatalf("Path2RelayMode(%q) = %d, want %d", tc.path, got, tc.want)
			}
		})
	}
}
