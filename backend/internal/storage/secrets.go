package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
)

func SecretKey(raw string) ([]byte, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := hex.DecodeString(raw)
	if err != nil || len(value) != 32 {
		return nil, errors.New("ZENITH_STORAGE_KEY must be 64 hex characters")
	}
	return value, nil
}
func Encrypt(key []byte, secret string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("配置 S3 前需设置 ZENITH_STORAGE_KEY（32 字节十六进制）")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(secret), []byte("zenith:s3:v1"))), nil
}
func Decrypt(key []byte, value string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("S3 存储密钥未配置")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("存储凭据无效")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte("zenith:s3:v1"))
	return string(plain), err
}
