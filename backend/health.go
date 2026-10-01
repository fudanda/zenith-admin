package zenith

import (
	"context"
	"net/http"
	"time"
)

func (f *Framework) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if f.Store == nil || f.Store.DB == nil {
		fail(w, 503, "database_unavailable", "数据库未就绪")
		return
	}
	if err := f.Store.DB.PingContext(ctx); err != nil {
		fail(w, 503, "database_unavailable", "数据库未就绪")
		return
	}
	respond(w, 200, map[string]string{"status": "ok"})
}
