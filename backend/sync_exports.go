package zenith

import (
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/filestorageconfig"
	"github.com/gorilla/mux"
	"github.com/xuri/excelize/v2"
)

type exportSource struct {
	permission, operation string
	handler               http.HandlerFunc
}

func (f *Framework) exportSources() map[string]exportSource {
	return map[string]exportSource{
		"system.users":                {"system:user:export", "usersExportCsv", f.exportUsersCSV},
		"system.departments":          {"system:department:list", "departmentsExportCsv", f.exportDepartmentsCSV},
		"system.positions":            {"system:position:list", "positionsExportCsv", f.exportPositionsCsv},
		"system.roles":                {"system:role:list", "rolesExportCsv", f.exportRolesCSV},
		"system.dicts":                {"system:dict:list", "dictsExportCsv", f.exportDictsCSV},
		"system.login-logs":           {"system:log:login", "loginLogsExportCsv", f.exportLoginLogsCSV},
		"system.operation-logs":       {"system:log:operation", "operationLogsExportCsv", f.exportAuditLogsCSV},
		"system.file-storage-configs": {"system:file:config", "fileConfigsList", f.exportFileConfigsCSV},
	}
}
func (f *Framework) permits(r *http.Request, permission string) (bool, error) {
	p := fromContext(r.Context())
	if p.SuperAdmin {
		return true, nil
	}
	permissions, err := f.permissions(r.Context(), p)
	if err != nil {
		return false, err
	}
	for _, candidate := range permissions {
		if candidate == permission {
			return true, nil
		}
	}
	return false, nil
}

type transferCapture struct {
	io.Writer
	header    http.Header
	status    int
	exportErr error
}

func (c *transferCapture) Header() http.Header { return c.header }
func (c *transferCapture) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
	}
}
func (c *transferCapture) Write(data []byte) (int, error) {
	if c.status == 0 {
		c.status = 200
	}
	return c.Writer.Write(data)
}
func exportFailed(w http.ResponseWriter, err error) {
	if c, ok := w.(*transferCapture); ok {
		c.exportErr = err
	}
}

func (f *Framework) syncExport(w http.ResponseWriter, r *http.Request) {
	entity := mux.Vars(r)["entity"]
	source, ok := f.exportSources()[entity]
	if !ok {
		fail(w, 404, "not_found", "导出对象不存在")
		return
	}
	allowed, err := f.permits(r, source.permission)
	if err != nil {
		fail(w, 503, "database_unavailable", "权限查询失败")
		return
	}
	if !allowed {
		fail(w, 403, "forbidden", "没有导出权限")
		return
	}
	format := r.URL.Query().Get("format")
	request := r.Clone(r.Context())
	copied := *r.URL
	request.URL = &copied
	q := r.URL.Query()
	q.Del("format")
	request.URL.RawQuery = q.Encode()
	request = mux.SetURLVars(request, nil)
	if err = validateContractRequest(request, source.operation); err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	if format == "csv" {
		source.handler(w, request)
		return
	}
	if format != "xlsx" {
		fail(w, 400, "invalid_format", "导出格式不支持")
		return
	}
	temp, err := os.CreateTemp("", "zenith-export-*.csv")
	if err != nil {
		fail(w, 503, "storage_unavailable", "导出暂存不可用")
		return
	}
	defer func() { temp.Close(); os.Remove(temp.Name()) }()
	captured := &transferCapture{Writer: temp, header: http.Header{}}
	source.handler(captured, request)
	if captured.exportErr != nil {
		fail(w, 503, "export_failed", "导出查询失败")
		return
	}
	if captured.status != 200 {
		temp.Seek(0, io.SeekStart)
		for key, value := range captured.header {
			w.Header()[key] = value
		}
		w.WriteHeader(captured.status)
		io.Copy(w, temp)
		return
	}
	if _, err = temp.Seek(3, io.SeekStart); err != nil {
		fail(w, 503, "storage_unavailable", "导出读取失败")
		return
	}
	book := excelize.NewFile()
	defer book.Close()
	stream, err := book.NewStreamWriter("Sheet1")
	if err != nil {
		fail(w, 500, "export_failed", "工作表创建失败")
		return
	}
	reader := csv.NewReader(temp)
	reader.FieldsPerRecord = -1
	for rowNumber := 1; ; rowNumber++ {
		if r.Context().Err() != nil {
			return
		}
		row, readErr := reader.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil || rowNumber > 1048576 {
			fail(w, 500, "export_failed", "导出行读取失败或超出 XLSX 上限")
			return
		}
		cells := make([]any, len(row))
		for i, value := range row {
			cells[i] = value
		}
		axis, _ := excelize.CoordinatesToCellName(1, rowNumber)
		if err = stream.SetRow(axis, cells); err != nil {
			fail(w, 500, "export_failed", "工作表写入失败")
			return
		}
	}
	if err = stream.Flush(); err != nil {
		fail(w, 500, "export_failed", "工作表生成失败")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename="+entity+".xlsx")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if err = book.Write(w); err != nil {
		exportFailed(w, err)
	}
}
func (f *Framework) exportFileConfigsCSV(w http.ResponseWriter, r *http.Request) {
	q := f.Store.Client.FileStorageConfig.Query()
	if status := r.URL.Query().Get("status"); status != "" {
		q = q.Where(filestorageconfig.StatusEQ(status))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := r.URL.Query().Get(bound.key); raw != "" {
			value, err := parseFilterDateBound(raw, bound.end)
			if err != nil {
				fail(w, 400, "invalid_filter", err.Error())
				return
			}
			if bound.end {
				q = q.Where(filestorageconfig.UpdatedAtLTE(value))
			} else {
				q = q.Where(filestorageconfig.UpdatedAtGTE(value))
			}
		}
	}
	q.Order(ent.Desc(filestorageconfig.FieldID))
	streamCSV(w, "file-storage-configs.csv", []string{"名称", "类型", "状态", "默认", "备注"}, func(offset int) ([][]string, error) {
		rows, err := q.Clone().Offset(offset).Limit(200).All(r.Context())
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			remark := ""
			if row.Remark != nil {
				remark = *row.Remark
			}
			result = append(result, []string{row.Name, "local", row.Status, strings.ToUpper(boolString(row.IsDefault)), remark})
		}
		return result, nil
	})
}
func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
