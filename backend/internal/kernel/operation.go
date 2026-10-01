// Package kernel contains transport-independent inputs, outcomes and shared
// domain values. It owns no connection pool and starts no runtime tasks.
package kernel

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"
)

type Values map[string][]string

func (v Values) Clone() Values {
	result := make(Values, len(v))
	for key, values := range v {
		result[key] = append([]string(nil), values...)
	}
	return result
}

func (v Values) Set(key, value string) { v[key] = []string{value} }

func (v Values) Get(key string) string {
	if len(v[key]) == 0 {
		return ""
	}
	return v[key][0]
}
func (v Values) Del(key string) { delete(v, key) }

// Input carries business parameters after HTTP decoding. Streams have bounded
// readers supplied by the caller; services never own the HTTP request or writer.
type Input struct {
	Personal                                                           bool
	Flat                                                               bool
	SettingModule                                                      string
	Id, ItemId, TokenId, Code, Entity, Type, Key, SectionKey, UploadId string
	Filter                                                             Values
	Body                                                               json.RawMessage
	Update, Remove                                                     bool
	IP, UserAgent, TraceID, SessionToken                               string
	SourceValid                                                        bool
	Upload                                                             io.Reader
	Filename, Duplicate, DryRun, Index                                 string
	Files                                                              UploadSource
}
type Upload struct {
	Reader io.ReadCloser
	Name   string
}
type UploadSource interface{ Next() (Upload, error) }
type Binary struct {
	Name, MIME string
	Modified   time.Time
	Reader     io.ReadSeeker
	Close      func() error
}
type CSVData struct {
	Name    string
	Headers []string
	Fetch   func(int) ([][]string, error)
}
type SessionCookie struct {
	Token   string
	Expires time.Time
	Clear   bool
}
type Outcome struct {
	Status                int
	Data                  any
	CSV                   *CSVData
	Binary                *Binary
	Write                 func(io.Writer) error
	Filename, ContentType string
	Cookie                *SessionCookie
}
type Fault struct {
	Status        int
	Code, Message string
}

func (e *Fault) Error() string                      { return e.Message }
func Fail(status int, code, message string) error   { return &Fault{status, code, message} }
func Success(status int, data any) (Outcome, error) { return Outcome{Status: status, Data: data}, nil }
func CSV(name string, headers []string, fetch func(int) ([][]string, error)) (Outcome, error) {
	return Outcome{Status: 200, CSV: &CSVData{name, headers, fetch}}, nil
}
func DecodeBody(raw json.RawMessage, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("请求体只能包含一个 JSON 值")
	}
	return nil
}
func IntParam(value string) (int, error) {
	id, err := strconv.Atoi(value)
	if err != nil || id < 1 {
		return 0, errors.New("无效 ID")
	}
	return id, nil
}
func PositiveInt(value string, fallback, limit int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > limit {
		return 0, errors.New("无效分页参数")
	}
	return n, nil
}
func LogPage(v Values) (int, int, error) {
	p, e := PositiveInt(v.Get("page"), 1, 1000000)
	if e != nil {
		return 0, 0, e
	}
	n, e := PositiveInt(v.Get("pageSize"), 10, 200)
	return p, n, e
}
func CSVCell(value string) string {
	if strings.ContainsAny(strings.TrimLeft(value, " \t\r\n")[:min(1, len(strings.TrimLeft(value, " \t\r\n")))], "=+-@") {
		return "'" + value
	}
	return value
}
func Secret() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}
func Digest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

type traceKey struct{}

func WithTrace(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, traceKey{}, id)
}
func TraceID(ctx context.Context) string { value, _ := ctx.Value(traceKey{}).(string); return value }
