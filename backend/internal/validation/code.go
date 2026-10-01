package validation

import "regexp"

var businessCode = regexp.MustCompile(`^\w+$`)

func BusinessCode(value string) bool { return businessCode.MatchString(value) }
