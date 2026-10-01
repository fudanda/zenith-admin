package validation

import (
	"errors"
	"time"
)

// parseFilterDateBound follows the shared date-range query convention. A
// date-only upper bound includes that whole local calendar day.
func DateBound(raw string, end bool) (time.Time, error) {
	layout := "2006-01-02"
	if len(raw) == len("2006-01-02 15:04:05") {
		layout = "2006-01-02 15:04:05"
	}
	value, err := time.ParseInLocation(layout, raw, time.Local)
	if err != nil {
		return time.Time{}, errors.New("时间格式必须为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss")
	}
	if end && layout == "2006-01-02" {
		value = value.Add(24*time.Hour - time.Millisecond)
	}
	return value, nil
}
