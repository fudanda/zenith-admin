package httptransport

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/gorilla/mux"
)

func ReadInput(w http.ResponseWriter, r *http.Request) (kernel.Input, error) {
	p := mux.Vars(r)
	in := kernel.Input{Id: p["id"], ItemId: p["itemId"], TokenId: p["tokenId"], Code: p["code"], Entity: p["entity"], Type: p["type"], Key: p["key"], SectionKey: p["sectionKey"], UploadId: p["uploadId"], Filter: kernel.Values(r.URL.Query()), Update: r.Method == http.MethodPut, Remove: r.Method == http.MethodDelete, IP: ClientIP(r), UserAgent: r.UserAgent(), TraceID: kernel.TraceID(r.Context()), SourceValid: SameOrigin(r)}
	in.SessionToken = SessionToken(r)
	in.Flat = strings.HasSuffix(r.URL.Path, "/flat")
	in.Personal = strings.HasSuffix(r.URL.Path, "/me")
	for key, def := range contracts.Settings {
		if strings.TrimPrefix(def.Path, "/") == strings.TrimPrefix(r.URL.Path, "/api/v1/settings/") {
			in.SettingModule = key
			break
		}
	}
	if r.ContentLength != 0 && strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		if err := Decode(r, &in.Body); err != nil {
			return in, err
		}
	}
	return in, nil
}
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
func SameOrigin(r *http.Request) bool {
	raw := r.Header.Get("Origin")
	if raw == "" {
		raw = r.Header.Get("Referer")
	}
	u, err := url.Parse(raw)
	return err == nil && u.Host == r.Host && (u.Scheme == "https" || u.Scheme == "http")
}
func WriteOutcome(w http.ResponseWriter, r *http.Request, result kernel.Outcome, err error) {
	if err != nil {
		var fault *kernel.Fault
		if errors.As(err, &fault) {
			Fail(w, fault.Status, fault.Code, fault.Message)
		} else {
			Fail(w, 503, "service_unavailable", "服务不可用")
		}
		return
	}
	if result.Cookie != nil {
		secure := r.Context().Value(secureCookieKey{}) == true
		if result.Cookie.Clear {
			ExpireCookie(w, secure)
		} else {
			http.SetCookie(w, &http.Cookie{Name: "arcbase_session", Value: result.Cookie.Token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: result.Cookie.Expires})
			expireLegacyCookie(w, secure)
		}
	}
	if result.CSV != nil {
		StreamCSV(w, result.CSV.Name, result.CSV.Headers, result.CSV.Fetch)
		return
	}
	if result.Binary != nil {
		b := result.Binary
		if b.Close != nil {
			defer b.Close()
		}
		w.Header().Set("Content-Type", b.MIME)
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		disposition := "inline"
		if r.URL.Query().Get("download") == "1" {
			disposition = "attachment"
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disposition, url.PathEscape(b.Name)))
		http.ServeContent(w, r, b.Name, b.Modified, b.Reader)
		return
	}
	if result.Write != nil {
		w.Header().Set("Content-Type", result.ContentType)
		w.Header().Set("Content-Disposition", "attachment; filename="+result.Filename)
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if err := result.Write(w); err != nil {
			if observer, ok := w.(interface{ ExportFailed(error) }); ok {
				observer.ExportFailed(err)
			}
		}
		return
	}
	status := result.Status
	if status == 0 {
		status = 200
	}
	Respond(w, status, result.Data)
}

type secureCookieKey struct{}

func SecureCookieContext(r *http.Request, secure bool) *http.Request {
	return r.WithContext(withSecureCookie(r.Context(), secure))
}
func withSecureCookie(ctx context.Context, secure bool) context.Context {
	return context.WithValue(ctx, secureCookieKey{}, secure)
}

type multipartSource struct{ reader *multipart.Reader }

func NewUploadSource(reader *multipart.Reader) kernel.UploadSource { return &multipartSource{reader} }
func (s *multipartSource) Next() (kernel.Upload, error) {
	for {
		part, err := s.reader.NextPart()
		if err != nil {
			return kernel.Upload{}, err
		}
		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}
		return kernel.Upload{Reader: part, Name: part.FileName()}, nil
	}
}
func ReadMultipart(w http.ResponseWriter, r *http.Request, limit int64) (kernel.Input, func(), error) {
	in, err := ReadInput(w, r)
	if err != nil {
		return in, func() {}, err
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err = r.ParseMultipartForm(2 << 20); err != nil {
		return in, func() {}, err
	}
	cleanup := func() {
		if r.MultipartForm != nil {
			r.MultipartForm.RemoveAll()
		}
	}
	key := "file"
	if r.FormValue("uploadId") != "" {
		key = "chunk"
	}
	file, header, err := r.FormFile(key)
	if err != nil {
		cleanup()
		return in, func() {}, err
	}
	in.Upload = file
	in.Filename = header.Filename
	in.UploadId = r.FormValue("uploadId")
	in.Index = r.FormValue("index")
	in.DryRun = r.FormValue("dryRun")
	in.Duplicate = r.FormValue("duplicate")
	return in, func() { file.Close(); cleanup() }, nil
}

var _ = io.EOF
