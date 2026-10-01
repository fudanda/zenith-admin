package validation

import "net/http"

// DetectContentType recognizes file signatures; it performs no network I/O.
func DetectContentType(sample []byte) string { return http.DetectContentType(sample) }
