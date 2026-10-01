package audit

import (
	"context"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/auditlog"
	"github.com/fudanda/zenith-admin/backend/ent/loginlog"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/validation"
)

type Dependencies struct {
	UserDataPredicate func(ctx context.Context, p *kernel.Principal) (predicate.User, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

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

func logBounds(q kernel.Values) (*time.Time, *time.Time, error) {
	var start, end *time.Time
	if raw := q.Get("startTime"); raw != "" {
		v, err := validation.DateBound(raw, false)
		if err != nil {
			return nil, nil, err
		}
		start = &v
	}
	if raw := q.Get("endTime"); raw != "" {
		v, err := validation.DateBound(raw, true)
		if err != nil {
			return nil, nil, err
		}
		end = &v
	}
	if start != nil && end != nil && start.After(*end) {
		return nil, nil, errors.New("结束时间不能早于开始时间")
	}
	return start, end, nil
}

func logUserID(q kernel.Values) (int, error) {
	if q.Get("userId") == "" {
		return 0, nil
	}
	return kernel.PositiveInt(q.Get("userId"), 0, 2147483647)
}

func validateLogFilters(q kernel.Values, keys ...string) error {
	allowed := map[string]bool{"page": true, "pageSize": true}
	for _, key := range keys {
		allowed[key] = true
	}
	for key, values := range q {
		if allowed[key] {
			continue
		}
		for _, value := range values {
			if value != "" {
				return errors.New("不支持的筛选字段: " + key)
			}
		}
	}
	return nil
}

func (f *Service) LoginStats(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	days, err := kernel.PositiveInt(inArgs.Filter.Get("days"), 90, 365)
	if err != nil || days < 7 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", "统计天数需要 7 至 365")
	}
	query, err := f.FilteredLoginLogs(ctx, kernel.FromContext(ctx), kernel.Values{})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
	}
	start := time.Now().AddDate(0, 0, -days)
	previous := start.AddDate(0, 0, -days)
	rows, err := query.Where(loginlog.CreatedAtGTE(previous)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计失败")
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
	return kernel.Success(200, map[string]any{"summary": summary, "prevSummary": prev, "dailyStats": dailyRows, "userStats": countRows(users, "username"), "ipStats": countRows(ips, "ip"), "ipFailStats": countRows(failIPs, "ip"), "browserStats": countRows(browsers, "browser"), "osStats": countRows(systems, "os"), "hourlyStats": numericCounts(hours, "hour"), "failReasonStats": countRows(reasons, "message"), "locationStats": []any{}, "dowHourStats": heatRows, "resolutionStats": []any{}, "gpuStats": []any{}})
}

func (f *Service) AuditStats(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	days, err := kernel.PositiveInt(inArgs.Filter.Get("days"), 7, 365)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	query, err := f.FilteredAuditLogs(ctx, kernel.FromContext(ctx), kernel.Values{})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
	}
	start := time.Now().AddDate(0, 0, -days)
	rows, err := query.Where(auditlog.CreatedAtGTE(start.AddDate(0, 0, -days))).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "统计失败")
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
		account, err := f.Store.Client.User.Get(ctx, row.ActorID)
		if err != nil && !ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "用户统计失败")
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
	return kernel.Success(200, map[string]any{"summary": auditSummary(current), "prevSummary": auditSummary(prev), "moduleStats": countRows(modules, "module"), "moduleTimingStats": timingRows(moduleTiming, "module", "avgMs", "maxMs"), "dailyStats": dailyRows, "userStats": countRows(users, "username"), "methodStats": countRows(methods, "method"), "hourlyStats": numericCounts(hours, "hour"), "statusClassStats": countRows(statuses, "statusClass"), "durationHistogram": countRows(buckets, "bucket"), "slowPaths": timingRows(paths, "path", "avgMs", "maxMs"), "failModuleStats": countRows(failModules, "module"), "userModuleFlows": flowRows})
}

func (f *Service) CleanLoginLogs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	days, err := kernel.PositiveInt(inArgs.Filter.Get("days"), 180, 3650)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	query, err := f.FilteredLoginLogs(ctx, kernel.FromContext(ctx), kernel.Values{})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
	}
	ids, err := query.Where(loginlog.CreatedAtLT(time.Now().AddDate(0, 0, -days))).IDs(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return f.CleanLogRows(ctx, inArgs, ids, true)
}

func (f *Service) CleanAuditLogs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	days, err := kernel.PositiveInt(inArgs.Filter.Get("days"), 180, 3650)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	query, err := f.FilteredAuditLogs(ctx, kernel.FromContext(ctx), kernel.Values{})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
	}
	ids, err := query.Where(auditlog.CreatedAtLT(time.Now().AddDate(0, 0, -days))).IDs(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return f.CleanLogRows(ctx, inArgs, ids, false)
}

func (f *Service) CleanLogRows(ctx context.Context, inArgs kernel.Input, ids []int, login bool) (kernel.Outcome, error) {
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if login {
			if _, err := tx.LoginLog.Delete().Where(loginlog.IDIn(ids...)).Exec(ctx); err != nil {
				return err
			}
		} else {
			if _, err := tx.AuditLog.Delete().Where(auditlog.IDIn(ids...)).Exec(ctx); err != nil {
				return err
			}
		}
		return tx.AuditLog.Create().SetActorID(kernel.FromContext(ctx).User.ID).SetRequestID(inArgs.TraceID).SetResource("logs").SetOperation("clean").Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "清理失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) LoginLogView(ctx context.Context, row *ent.LoginLog) (map[string]any, error) {
	status := "fail"
	if row.Success {
		status = "success"
	}
	var nickname any
	if row.UserID != nil {
		account, err := f.Store.Client.User.Get(ctx, *row.UserID)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
		if account != nil {
			nickname = account.Nickname
		}
	}
	return map[string]any{"id": row.ID, "userId": row.UserID, "username": row.Username, "nickname": nickname, "ip": row.IP, "location": nil, "browser": row.Browser, "os": row.Os, "userAgent": row.UserAgent, "eventType": row.EventType, "status": status, "message": row.Reason, "createdAt": row.CreatedAt}, nil
}

func (f *Service) AuditLogView(ctx context.Context, row *ent.AuditLog) (map[string]any, error) {
	var username, nickname any
	account, err := f.Store.Client.User.Get(ctx, row.ActorID)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if account != nil {
		username = account.Username
		nickname = account.Nickname
	}
	return map[string]any{"id": row.ID, "userId": row.ActorID, "username": username, "nickname": nickname, "module": row.Module, "description": row.Description, "method": row.Method, "path": row.Path, "requestId": row.RequestID, "requestBody": row.RequestBody, "beforeData": nil, "afterData": nil, "responseCode": row.ResponseCode, "responseBody": nil, "durationMs": row.DurationMs, "ip": row.IP, "location": nil, "userAgent": row.UserAgent, "os": row.Os, "browser": row.Browser, "createdAt": row.CreatedAt}, nil
}

func (f *Service) AuditLogDetail(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	query, err := f.FilteredAuditLogs(ctx, kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_query", err.Error())
	}
	row, err := query.Where(auditlog.IDEQ(id)).Only(ctx)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "操作记录不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.AuditLogView(ctx, row)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) MyLoginLogs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	q := inArgs.Filter
	q.Set("userId", strconv.Itoa(kernel.FromContext(ctx).User.ID))
	inArgs.Filter = q
	return f.ListLoginLogs(ctx, inArgs)
}

func (f *Service) MyOperationLogs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	q := inArgs.Filter
	q.Set("userId", strconv.Itoa(kernel.FromContext(ctx).User.ID))
	inArgs.Filter = q
	return f.ListAuditLogs(ctx, inArgs)
}

func (f *Service) FilteredLoginLogs(ctx context.Context, p *kernel.Principal, q kernel.Values) (*ent.LoginLogQuery, error) {
	if err := validateLogFilters(q, "userId", "username", "eventType", "status", "startTime", "endTime", "format"); err != nil {
		return nil, err
	}
	query := f.Store.Client.LoginLog.Query()
	if !p.SuperAdmin {
		scope, err := f.deps.UserDataPredicate(ctx, p)
		if err != nil {
			return nil, err
		}
		if scope != nil {
			ids, err := f.Store.Client.User.Query().Where(scope).IDs(ctx)
			if err != nil {
				return nil, err
			}
			query = query.Where(loginlog.UserIDIn(ids...))
		}
	}

	id, err := logUserID(q)
	if err != nil {
		return nil, err
	}
	if id > 0 {
		query = query.Where(loginlog.UserIDEQ(id))
	}
	if username := strings.TrimSpace(q.Get("username")); username != "" {
		query = query.Where(loginlog.UsernameContainsFold(username))
	}
	if event := q.Get("eventType"); event != "" {
		switch event {
		case "login", "logout", "kicked":
			query = query.Where(loginlog.EventTypeEQ(event))
		case "impersonate", "impersonate_end":
			query = query.Where(loginlog.IDEQ(0))
		default:
			return nil, errors.New("事件类型无效")
		}
	}
	if status := q.Get("status"); status != "" {
		if status != "success" && status != "fail" {
			return nil, errors.New("状态无效")
		}
		query = query.Where(loginlog.SuccessEQ(status == "success"))
	}
	start, end, err := logBounds(q)
	if err != nil {
		return nil, err
	}
	if start != nil {
		query = query.Where(loginlog.CreatedAtGTE(*start))
	}
	if end != nil {
		query = query.Where(loginlog.CreatedAtLTE(*end))
	}
	return query, nil
}

func (f *Service) FilteredAuditLogs(ctx context.Context, p *kernel.Principal, q kernel.Values) (*ent.AuditLogQuery, error) {
	if err := validateLogFilters(q, "userId", "module", "description", "startTime", "endTime", "resource", "username", "method", "path", "ip", "status", "content", "impersonated", "minDurationMs", "maxDurationMs", "format"); err != nil {
		return nil, err
	}
	query := f.Store.Client.AuditLog.Query()
	if !p.SuperAdmin {
		scope, err := f.deps.UserDataPredicate(ctx, p)
		if err != nil {
			return nil, err
		}
		if scope != nil {
			ids, err := f.Store.Client.User.Query().Where(scope).IDs(ctx)
			if err != nil {
				return nil, err
			}
			query = query.Where(auditlog.ActorIDIn(ids...))
		}
	}

	id, err := logUserID(q)
	if err != nil {
		return nil, err
	}
	if id > 0 {
		query = query.Where(auditlog.ActorIDEQ(id))
	}
	resource := strings.TrimSpace(q.Get("module"))
	if resource == "" {
		resource = strings.TrimSpace(q.Get("resource"))
	}
	if resource != "" {
		query = query.Where(auditlog.Or(auditlog.ModuleContainsFold(resource), auditlog.ResourceContainsFold(resource)))
	}
	if operation := strings.TrimSpace(q.Get("description")); operation != "" {
		query = query.Where(auditlog.Or(auditlog.DescriptionContainsFold(operation), auditlog.OperationContainsFold(operation)))
	}
	if keyword := strings.TrimSpace(q.Get("username")); keyword != "" {
		ids, err := f.Store.Client.User.Query().Where(user.Or(user.UsernameContainsFold(keyword), user.NicknameContainsFold(keyword))).IDs(ctx)
		if err != nil {
			return nil, err
		}
		query = query.Where(auditlog.ActorIDIn(ids...))
	}
	for _, filter := range []struct {
		key       string
		predicate func(string) predicate.AuditLog
	}{{"method", auditlog.MethodContainsFold}, {"path", auditlog.PathContainsFold}, {"ip", auditlog.IPContainsFold}, {"content", auditlog.RequestBodyContainsFold}} {
		if value := q.Get(filter.key); value != "" {
			query = query.Where(filter.predicate(value))
		}
	}
	if status := q.Get("status"); status != "" {
		if status == "success" {
			query = query.Where(auditlog.ResponseCodeLT(400))
		} else if status == "fail" {
			query = query.Where(auditlog.ResponseCodeGTE(400))
		} else {
			return nil, errors.New("结果状态无效")
		}
	}
	if value := q.Get("impersonated"); value != "" && value != "false" && value != "0" {
		if value == "true" || value == "1" {
			query = query.Where(auditlog.IDEQ(0))
		} else {
			return nil, errors.New("模拟操作筛选无效")
		}
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"minDurationMs", false}, {"maxDurationMs", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 0 {
				return nil, errors.New("耗时筛选无效")
			}
			if bound.end {
				query = query.Where(auditlog.DurationMsLTE(value))
			} else {
				query = query.Where(auditlog.DurationMsGTE(value))
			}
		}
	}
	start, end, err := logBounds(q)
	if err != nil {
		return nil, err
	}
	if start != nil {
		query = query.Where(auditlog.CreatedAtGTE(*start))
	}
	if end != nil {
		query = query.Where(auditlog.CreatedAtLTE(*end))
	}
	return query, nil
}

func (f *Service) ListLoginLogs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	page, size, err := kernel.LogPage(inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page", err.Error())
	}
	query, err := f.FilteredLoginLogs(ctx, kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Order(ent.Desc(loginlog.FieldCreatedAt), ent.Desc(loginlog.FieldID)).Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.LoginLogView(ctx, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "用户资料查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) ListAuditLogs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	page, size, err := kernel.LogPage(inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page", err.Error())
	}
	query, err := f.FilteredAuditLogs(ctx, kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Order(ent.Desc(auditlog.FieldCreatedAt), ent.Desc(auditlog.FieldID)).Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.AuditLogView(ctx, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "用户资料查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) ExportLoginLogsCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	query, err := f.FilteredLoginLogs(ctx, kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	query.Order(ent.Desc(loginlog.FieldCreatedAt), ent.Desc(loginlog.FieldID))
	return kernel.CSV("login-logs.csv", []string{"ID", "用户ID", "用户名", "事件类型", "IP", "状态", "说明", "时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			id := ""
			if row.UserID != nil {
				id = strconv.Itoa(*row.UserID)
			}
			status := "fail"
			if row.Success {
				status = "success"
			}
			result = append(result, []string{strconv.Itoa(row.ID), id, row.Username, "login", row.IP, status, row.Reason, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}

func (f *Service) ExportAuditLogsCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	query, err := f.FilteredAuditLogs(ctx, kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	query.Order(ent.Desc(auditlog.FieldCreatedAt), ent.Desc(auditlog.FieldID))
	return kernel.CSV("operation-logs.csv", []string{"ID", "操作人ID", "操作", "资源", "资源ID", "请求ID", "时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			resourceID := ""

			if row.ResourceID != nil {
				resourceID = strconv.Itoa(*row.ResourceID)
			}
			result = append(result, []string{strconv.Itoa(row.ID), strconv.Itoa(row.ActorID), row.Operation, row.Resource, resourceID, row.RequestID, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}
