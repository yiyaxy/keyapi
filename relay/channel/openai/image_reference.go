package openai

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"
)

// getImageFromURL is a seam for tests; it points at the SSRF-protected,
// size-limited downloader in the service package.
var getImageFromURL = service.GetImageFromUrl

// normalizeImageReferences rewrites http(s) URLs in the request's `image`
// field into base64 data URIs.
//
// `image` on /v1/images/generations is a vendor extension for reference
// images. Upstreams implement it by routing the call to their own edit
// pipeline, which needs the image bytes inline — handed a bare URL they
// report "at least one input image is required" instead of fetching it.
// Resolving the URL here keeps the client-facing contract permissive while
// giving every upstream the form it can actually read.
//
// The field is raw JSON holding either a single string or an array of them;
// both shapes round-trip unchanged. Values that are already data URIs, or
// that aren't URLs at all, are left alone.
func normalizeImageReferences(request *dto.ImageRequest) error {
	if len(request.Image) == 0 {
		return nil
	}

	var single string
	if err := json.Unmarshal(request.Image, &single); err == nil {
		converted, changed, err := imageReferenceToDataURI(single)
		if err != nil {
			return err
		}
		if !changed {
			return nil
		}
		raw, err := json.Marshal(converted)
		if err != nil {
			return err
		}
		request.Image = raw
		return nil
	}

	var list []string
	if err := json.Unmarshal(request.Image, &list); err != nil {
		// Some other shape (object, array of objects, ...). Leave it for the
		// upstream to interpret rather than guessing wrong.
		return nil
	}

	changedAny := false
	for i, item := range list {
		converted, changed, err := imageReferenceToDataURI(item)
		if err != nil {
			return err
		}
		if changed {
			list[i] = converted
			changedAny = true
		}
	}
	if !changedAny {
		return nil
	}
	raw, err := json.Marshal(list)
	if err != nil {
		return err
	}
	request.Image = raw
	return nil
}

// imageReferenceToDataURI resolves one reference-image value. The bool reports
// whether the value was rewritten.
func imageReferenceToDataURI(value string) (string, bool, error) {
	trimmed := strings.TrimSpace(value)
	if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
		return value, false, nil
	}

	mimeType, data, err := getImageFromURL(trimmed)
	if err != nil {
		// The URL may carry a signature or token, so keep it out of the error.
		return "", false, fmt.Errorf("failed to fetch reference image %s: %w", common.MaskSensitiveInfo(trimmed), err)
	}
	return fmt.Sprintf("data:%s;base64,%s", mimeType, data), true, nil
}
