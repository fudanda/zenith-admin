package transfers

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"os"

	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/xuri/excelize/v2"
)

type ExportSource struct{ Permission, Operation string }

var Sources = map[string]ExportSource{
	"system.users":                {"system:user:export", "usersExportCsv"},
	"system.departments":          {"system:department:list", "departmentsExportCsv"},
	"system.positions":            {"system:position:list", "positionsExportCsv"},
	"system.roles":                {"system:role:list", "rolesExportCsv"},
	"system.dicts":                {"system:dict:list", "dictsExportCsv"},
	"system.login-logs":           {"system:log:login", "loginLogsExportCsv"},
	"system.operation-logs":       {"system:log:operation", "operationLogsExportCsv"},
	"system.file-storage-configs": {"system:file:config", "fileConfigsList"},
}

func (f *Service) SyncExport(ctx context.Context, input kernel.Input) (kernel.Outcome, error) {
	source, ok := Sources[input.Entity]
	if !ok {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "导出对象不存在")
	}
	allowed, err := f.deps.Permits(ctx, input, source.Permission)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "权限查询失败")
	}
	if !allowed {
		return kernel.Outcome{}, kernel.Fail(403, "forbidden", "没有导出权限")
	}
	format := input.Filter.Get("format")
	if format != "csv" && format != "xlsx" {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_format", "导出格式不支持")
	}
	input.Filter = input.Filter.Clone()
	input.Filter.Del("format")
	result, err := f.deps.Export(ctx, input.Entity, input)
	if err != nil {
		return result, err
	}
	if format == "csv" {
		return result, nil
	}
	if result.CSV == nil {
		return kernel.Outcome{}, kernel.Fail(500, "export_failed", "导出源无效")
	}
	temp, err := os.CreateTemp("", "arcbase-export-*.csv")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "导出暂存不可用")
	}
	defer func() { temp.Close(); os.Remove(temp.Name()) }()
	writer := csv.NewWriter(temp)
	if err = writer.Write(result.CSV.Headers); err != nil {
		return kernel.Outcome{}, err
	}
	for offset := 0; ; offset += 200 {
		if err = ctx.Err(); err != nil {
			return kernel.Outcome{}, err
		}
		rows, e := result.CSV.Fetch(offset)
		if e != nil {
			return kernel.Outcome{}, kernel.Fail(503, "export_failed", "导出查询失败")
		}
		for _, row := range rows {
			for i := range row {
				row[i] = kernel.CSVCell(row[i])
			}
			if e = writer.Write(row); e != nil {
				return kernel.Outcome{}, e
			}
		}
		if len(rows) < 200 {
			break
		}
	}
	writer.Flush()
	if err = writer.Error(); err != nil {
		return kernel.Outcome{}, err
	}
	if _, err = temp.Seek(0, io.SeekStart); err != nil {
		return kernel.Outcome{}, err
	}
	book := excelize.NewFile()
	defer book.Close()
	stream, err := book.NewStreamWriter("Sheet1")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(500, "export_failed", "工作表创建失败")
	}
	reader := csv.NewReader(temp)
	reader.FieldsPerRecord = -1
	for rowNumber := 1; ; rowNumber++ {
		if err = ctx.Err(); err != nil {
			return kernel.Outcome{}, err
		}
		row, e := reader.Read()
		if errors.Is(e, io.EOF) {
			break
		}
		if e != nil || rowNumber > 1048576 {
			return kernel.Outcome{}, kernel.Fail(500, "export_failed", "导出行读取失败或超出 XLSX 上限")
		}
		cells := make([]any, len(row))
		for i, v := range row {
			cells[i] = v
		}
		axis, _ := excelize.CoordinatesToCellName(1, rowNumber)
		if err = stream.SetRow(axis, cells); err != nil {
			return kernel.Outcome{}, err
		}
	}
	if err = stream.Flush(); err != nil {
		return kernel.Outcome{}, err
	}
	output, err := os.CreateTemp("", "arcbase-export-*.xlsx")
	if err != nil {
		return kernel.Outcome{}, err
	}
	cleanup := func() { output.Close(); os.Remove(output.Name()) }
	if err = book.Write(output); err != nil {
		cleanup()
		return kernel.Outcome{}, err
	}
	if _, err = output.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return kernel.Outcome{}, err
	}
	return kernel.Outcome{Status: 200, Filename: input.Entity + ".xlsx", ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Write: func(w io.Writer) error { defer cleanup(); _, err := io.Copy(w, output); return err }}, nil
}
