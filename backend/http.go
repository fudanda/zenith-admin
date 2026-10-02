package arcbase

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	httptransport "github.com/fudanda/arcbase/backend/internal/transport/http"
)

var (
	respond      = httptransport.Respond
	fail         = httptransport.Fail
	decode       = httptransport.Decode
	intParam     = httptransport.IntParam
	positiveInt  = httptransport.PositiveInt
	expireCookie = httptransport.ExpireCookie
)

func secret() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func digest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}
