package relaymetrics

var monitoredExactPaths = []string{
	"/v1/chat/completions",
}

func PathMonitored(path string) bool {
	for _, p := range monitoredExactPaths {
		if path == p {
			return true
		}
	}
	return false
}
