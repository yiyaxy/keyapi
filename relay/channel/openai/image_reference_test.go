package openai

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

// stubImageFetch swaps the downloader for the duration of the test.
func stubImageFetch(t *testing.T, fn func(string) (string, string, error)) {
	t.Helper()
	prev := getImageFromURL
	getImageFromURL = fn
	t.Cleanup(func() { getImageFromURL = prev })
}

func TestNormalizeImageReferencesConvertsSingleURL(t *testing.T) {
	var requested string
	stubImageFetch(t, func(url string) (string, string, error) {
		requested = url
		return "image/png", "AAAB", nil
	})

	req := &dto.ImageRequest{Image: json.RawMessage(`"https://example.com/a.png"`)}
	require.NoError(t, normalizeImageReferences(req))

	require.Equal(t, "https://example.com/a.png", requested)
	var got string
	require.NoError(t, json.Unmarshal(req.Image, &got))
	require.Equal(t, "data:image/png;base64,AAAB", got)
}

func TestNormalizeImageReferencesKeepsDataURIUntouched(t *testing.T) {
	stubImageFetch(t, func(string) (string, string, error) {
		t.Fatal("must not download a data URI")
		return "", "", nil
	})

	original := json.RawMessage(`"data:image/png;base64,QUJD"`)
	req := &dto.ImageRequest{Image: original}
	require.NoError(t, normalizeImageReferences(req))
	require.JSONEq(t, string(original), string(req.Image))
}

func TestNormalizeImageReferencesConvertsOnlyURLsInArray(t *testing.T) {
	stubImageFetch(t, func(url string) (string, string, error) {
		return "image/jpeg", "SkpK", nil
	})

	req := &dto.ImageRequest{Image: json.RawMessage(
		`["https://example.com/a.png","data:image/png;base64,QUJD"]`)}
	require.NoError(t, normalizeImageReferences(req))

	var got []string
	require.NoError(t, json.Unmarshal(req.Image, &got))
	require.Len(t, got, 2, "array shape must be preserved")
	require.Equal(t, "data:image/jpeg;base64,SkpK", got[0])
	require.Equal(t, "data:image/png;base64,QUJD", got[1], "non-URL entry must be untouched")
}

func TestNormalizeImageReferencesEmptyIsNoop(t *testing.T) {
	stubImageFetch(t, func(string) (string, string, error) {
		t.Fatal("must not download when image is absent")
		return "", "", nil
	})

	req := &dto.ImageRequest{}
	require.NoError(t, normalizeImageReferences(req))
	require.Empty(t, req.Image)
}

func TestNormalizeImageReferencesPropagatesDownloadError(t *testing.T) {
	stubImageFetch(t, func(string) (string, string, error) {
		return "", "", errors.New("request reject: private ip blocked")
	})

	req := &dto.ImageRequest{Image: json.RawMessage(`"https://169.254.169.254/latest/meta-data"`)}
	err := normalizeImageReferences(req)

	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to fetch reference image")
	require.Contains(t, err.Error(), "private ip blocked")
}

func TestNormalizeImageReferencesLeavesUnknownShapeAlone(t *testing.T) {
	stubImageFetch(t, func(string) (string, string, error) {
		t.Fatal("must not download an unrecognized shape")
		return "", "", nil
	})

	original := json.RawMessage(`{"url":"https://example.com/a.png"}`)
	req := &dto.ImageRequest{Image: original}
	require.NoError(t, normalizeImageReferences(req))
	require.JSONEq(t, string(original), string(req.Image))
}
