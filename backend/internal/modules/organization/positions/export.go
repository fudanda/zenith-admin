package positions

import (
	"context"

	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/validation"
)

// ExportCSV provides a transport-independent source for direct CSV and XLSX
// conversion, with the same filters as the position page.
func (s *Service) ExportCSV(ctx context.Context, input kernel.Input) (kernel.Outcome, error) {
	filter := Filter{Keyword: input.Filter.Get("keyword"), Status: input.Filter.Get("status")}
	if filter.Status != "" && filter.Status != "enabled" && filter.Status != "disabled" {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_status", "状态无效")
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := input.Filter.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_date_range", err.Error())
			}
			if bound.end {
				filter.End = &value
			} else {
				filter.Start = &value
			}
		}
	}
	return kernel.CSV("positions.csv", []string{"ID", "岗位名称", "岗位编码", "排序", "状态", "备注", "创建时间"}, func(offset int) ([][]string, error) { return s.ExportBatch(ctx, filter, offset, 200) })
}
