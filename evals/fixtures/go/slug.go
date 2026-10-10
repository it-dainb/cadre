package slug

import (
	"regexp"
	"strings"
)

var non = regexp.MustCompile(`[^a-z0-9]+`)

func Slug(s string) string { return strings.Trim(non.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "-"), "-") }
