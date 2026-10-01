package zenith

import (
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
)

func countRows(values map[string]int, key string) []map[string]any {
	keys := make([]string, 0, len(values))
	for value := range values {
		keys = append(keys, value)
	}
	sort.Slice(keys, func(i, j int) bool {
		if values[keys[i]] == values[keys[j]] {
			return keys[i] < keys[j]
		}
		return values[keys[i]] > values[keys[j]]
	})
	rows := make([]map[string]any, 0, len(keys))
	for _, value := range keys {
		rows = append(rows, map[string]any{key: value, "count": values[value]})
	}
	return rows
}
func numericCounts(values map[int]int, key string) []map[string]any {
	keys := make([]int, 0, len(values))
	for value := range values {
		keys = append(keys, value)
	}
	sort.Ints(keys)
	rows := make([]map[string]any, 0, len(keys))
	for _, value := range keys {
		rows = append(rows, map[string]any{key: value, "count": values[value]})
	}
	return rows
}
func (f *Framework) loginStats(w http.ResponseWriter, r *http.Request) {
	days, err := positiveInt(r.URL.Query().Get("days"), 90, 365)
	if err != nil || days < 7 {
		fail(w, 400, "invalid_query", "统计天数需要 7 至 365")
		return
	}
	query, err := f.filteredLoginLogs(r.Context(), fromContext(r.Context()), url.Values{})
	if err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	start := time.Now().AddDate(0, 0, -days)
	previous := start.AddDate(0, 0, -days)
	rows, err := query.Where(loginlog.CreatedAtGTE(previous)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "统计失败")
		return
	}
	summary, prev := map[string]int{"total": 0, "successCount": 0, "failCount": 0}, map[string]int{"total": 0, "successCount": 0, "failCount": 0}
	daily := map[string]map[string]any{}
	users, ips, failIPs, browsers, systems, reasons := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	hours := map[int]int{}
	heat := map[int]int{}
	for _, row := range rows {
		target := summary
		if row.CreatedAt.Before(start) {
			target = prev
		}
		target["total"]++
		if row.Success {
			target["successCount"]++
		} else {
			target["failCount"]++
		}
		if row.CreatedAt.Before(start) {
			continue
		}
		date := row.CreatedAt.UTC().Format("2006-01-02")
		if daily[date] == nil {
			daily[date] = map[string]any{"date": date, "count": 0, "successCount": 0, "failCount": 0}
		}
		item := daily[date]
		item["count"] = item["count"].(int) + 1
		status := "failCount"
		if row.Success {
			status = "successCount"
		}
		item[status] = item[status].(int) + 1
		users[row.Username]++
		ips[row.IP]++
		browsers[row.Browser]++
		systems[row.Os]++
		hours[row.CreatedAt.UTC().Hour()]++
		dow := int(row.CreatedAt.UTC().Weekday())
		if dow == 0 {
			dow = 7
		}
		heat[dow*24+row.CreatedAt.UTC().Hour()]++
		if !row.Success {
			failIPs[row.IP]++
			reasons[row.Reason]++
		}
	}
	dates := make([]string, 0, len(daily))
	for date := range daily {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	dailyRows := make([]map[string]any, 0, len(dates))
	for _, date := range dates {
		dailyRows = append(dailyRows, daily[date])
	}
	heatRows := make([]map[string]int, 0, len(heat))
	for _, row := range numericCounts(heat, "key") {
		key := row["key"].(int)
		heatRows = append(heatRows, map[string]int{"dow": key / 24, "hour": key % 24, "count": row["count"].(int)})
	}
	respond(w, 200, map[string]any{"summary": summary, "prevSummary": prev, "dailyStats": dailyRows, "userStats": countRows(users, "username"), "ipStats": countRows(ips, "ip"), "ipFailStats": countRows(failIPs, "ip"), "browserStats": countRows(browsers, "browser"), "osStats": countRows(systems, "os"), "hourlyStats": numericCounts(hours, "hour"), "failReasonStats": countRows(reasons, "message"), "locationStats": []any{}, "dowHourStats": heatRows, "resolutionStats": []any{}, "gpuStats": []any{}})
}
func quantile(values []float64, q float64) any {
	if len(values) == 0 {
		return nil
	}
	sort.Float64s(values)
	index := float64(len(values)-1) * q
	low := int(math.Floor(index))
	high := int(math.Ceil(index))
	return values[low] + (values[high]-values[low])*(index-float64(low))
}
func auditSummary(rows []*ent.AuditLog) map[string]any {
	success, totalTime := 0, 0
	users := map[int]bool{}
	durations := make([]float64, 0, len(rows))
	for _, row := range rows {
		if row.ResponseCode < 400 {
			success++
		}
		totalTime += row.DurationMs
		users[row.ActorID] = true
		durations = append(durations, float64(row.DurationMs))
	}
	var average any
	if len(rows) > 0 {
		average = float64(totalTime) / float64(len(rows))
	}
	return map[string]any{"total": len(rows), "successCount": success, "failCount": len(rows) - success, "avgDurationMs": average, "uniqueUsers": len(users), "p50DurationMs": quantile(durations, .5), "p95DurationMs": quantile(durations, .95), "p99DurationMs": quantile(durations, .99)}
}

type timingAggregate struct{ sum, max, count int }

func (f *Framework) auditStats(w http.ResponseWriter, r *http.Request) {
	days, err := positiveInt(r.URL.Query().Get("days"), 7, 365)
	if err != nil {
		fail(w, 400, "invalid_query", err.Error())
		return
	}
	query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), url.Values{})
	if err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	start := time.Now().AddDate(0, 0, -days)
	rows, err := query.Where(auditlog.CreatedAtGTE(start.AddDate(0, 0, -days))).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "统计失败")
		return
	}
	current, prev := make([]*ent.AuditLog, 0), make([]*ent.AuditLog, 0)
	for _, row := range rows {
		if row.CreatedAt.Before(start) {
			prev = append(prev, row)
		} else {
			current = append(current, row)
		}
	}
	modules, methods, statuses, failModules, buckets, users := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	hours := map[int]int{}
	moduleTiming, paths := map[string]*timingAggregate{}, map[string]*timingAggregate{}
	daily := map[string][]*ent.AuditLog{}
	flows := map[string]map[string]any{}
	timing := func(values map[string]*timingAggregate, key string, ms int) {
		if values[key] == nil {
			values[key] = &timingAggregate{}
		}
		value := values[key]
		value.count++
		value.sum += ms
		if ms > value.max {
			value.max = ms
		}
	}
	for _, row := range current {
		modules[row.Module]++
		methods[row.Method]++
		statuses[strconv.Itoa(row.ResponseCode/100)+"xx"]++
		hours[row.CreatedAt.UTC().Hour()]++
		date := row.CreatedAt.UTC().Format("2006-01-02")
		daily[date] = append(daily[date], row)
		if row.ResponseCode >= 400 {
			failModules[row.Module]++
		}
		bucket := "<100ms"
		switch {
		case row.DurationMs >= 5000:
			bucket = ">=5s"
		case row.DurationMs >= 1000:
			bucket = "1-5s"
		case row.DurationMs >= 500:
			bucket = "500ms-1s"
		case row.DurationMs >= 100:
			bucket = "100-500ms"
		}
		buckets[bucket]++
		timing(moduleTiming, row.Module, row.DurationMs)
		timing(paths, row.Path, row.DurationMs)
		account, err := f.Store.Client.User.Get(r.Context(), row.ActorID)
		if err != nil && !ent.IsNotFound(err) {
			fail(w, 503, "database_unavailable", "用户统计失败")
			return
		}
		username := "已删除用户"
		nickname := ""
		if account != nil {
			username = account.Username
			nickname = account.Nickname
		}
		users[username]++
		key := username + "\x00" + row.Module
		if flows[key] == nil {
			flows[key] = map[string]any{"username": username, "nickname": nickname, "module": row.Module, "count": 0}
		}
		flows[key]["count"] = flows[key]["count"].(int) + 1
	}
	timingRows := func(values map[string]*timingAggregate, key, avg, max string) []map[string]any {
		keys := make([]string, 0, len(values))
		for value := range values {
			keys = append(keys, value)
		}
		sort.Strings(keys)
		result := make([]map[string]any, 0, len(keys))
		for _, value := range keys {
			row := values[value]
			result = append(result, map[string]any{key: value, avg: float64(row.sum) / float64(row.count), max: row.max, "count": row.count})
		}
		return result
	}
	dates := make([]string, 0, len(daily))
	for date := range daily {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	dailyRows := make([]map[string]any, 0, len(dates))
	for _, date := range dates {
		summary := auditSummary(daily[date])
		dailyRows = append(dailyRows, map[string]any{"date": date, "count": summary["total"], "successCount": summary["successCount"], "failCount": summary["failCount"], "avgMs": summary["avgDurationMs"]})
	}
	flowRows := make([]map[string]any, 0, len(flows))
	for _, row := range flows {
		flowRows = append(flowRows, row)
	}
	respond(w, 200, map[string]any{"summary": auditSummary(current), "prevSummary": auditSummary(prev), "moduleStats": countRows(modules, "module"), "moduleTimingStats": timingRows(moduleTiming, "module", "avgMs", "maxMs"), "dailyStats": dailyRows, "userStats": countRows(users, "username"), "methodStats": countRows(methods, "method"), "hourlyStats": numericCounts(hours, "hour"), "statusClassStats": countRows(statuses, "statusClass"), "durationHistogram": countRows(buckets, "bucket"), "slowPaths": timingRows(paths, "path", "avgMs", "maxMs"), "failModuleStats": countRows(failModules, "module"), "userModuleFlows": flowRows})
}
func (f *Framework) cleanLoginLogs(w http.ResponseWriter, r *http.Request) {
	days, err := positiveInt(r.URL.Query().Get("days"), 180, 3650)
	if err != nil {
		fail(w, 400, "invalid_query", err.Error())
		return
	}
	query, err := f.filteredLoginLogs(r.Context(), fromContext(r.Context()), url.Values{})
	if err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	ids, err := query.Where(loginlog.CreatedAtLT(time.Now().AddDate(0, 0, -days))).IDs(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	f.cleanLogRows(w, r, ids, true)
}
func (f *Framework) cleanAuditLogs(w http.ResponseWriter, r *http.Request) {
	days, err := positiveInt(r.URL.Query().Get("days"), 180, 3650)
	if err != nil {
		fail(w, 400, "invalid_query", err.Error())
		return
	}
	query, err := f.filteredAuditLogs(r.Context(), fromContext(r.Context()), url.Values{})
	if err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	ids, err := query.Where(auditlog.CreatedAtLT(time.Now().AddDate(0, 0, -days))).IDs(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	f.cleanLogRows(w, r, ids, false)
}
func (f *Framework) cleanLogRows(w http.ResponseWriter, r *http.Request, ids []int, login bool) {
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if login {
			if _, err := tx.LoginLog.Delete().Where(loginlog.IDIn(ids...)).Exec(r.Context()); err != nil {
				return err
			}
		} else {
			if _, err := tx.AuditLog.Delete().Where(auditlog.IDIn(ids...)).Exec(r.Context()); err != nil {
				return err
			}
		}
		return tx.AuditLog.Create().SetActorID(fromContext(r.Context()).User.ID).SetRequestID(requestID(r)).SetResource("logs").SetOperation("clean").Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "清理失败")
		return
	}
	respond(w, 200, nil)
}
