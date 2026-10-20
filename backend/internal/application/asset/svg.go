package asset

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"regexp"
	"strings"
)

// ErrInvalidSVG means the file is not an SVG we can make safe.
var ErrInvalidSVG = errors.New("asset: not a valid svg")

const svgNamespace = "http://www.w3.org/2000/svg"

// maxSVGDepth stops a deeply nested file from costing more than it is worth.
const maxSVGDepth = 64

// svgElements is every element an upload may keep. Anything else, with
// everything inside it, is dropped: script, foreignObject, a, image, use,
// animate, set, iframe and the like are not here on purpose.
var svgElements = setOf(
	"svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse",
	"line", "polyline", "polygon", "text", "tspan", "textPath", "symbol",
	"linearGradient", "radialGradient", "stop", "clipPath", "mask", "marker",
	"pattern", "style",
)

var svgAttributes = setOf(
	"id", "class", "style", "viewBox", "width", "height", "x", "y", "x1", "y1",
	"x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
	"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
	"stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
	"stroke-dashoffset", "stroke-miterlimit", "opacity", "offset", "stop-color",
	"stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "fx",
	"fy", "clip-path", "clip-rule", "clipPathUnits", "mask", "maskUnits",
	"maskContentUnits", "marker-start", "marker-mid", "marker-end", "markerWidth",
	"markerHeight", "markerUnits", "refX", "refY", "orient", "patternUnits",
	"patternContentUnits", "patternTransform", "preserveAspectRatio",
	"font-family", "font-size", "font-weight", "font-style", "text-anchor",
	"dominant-baseline", "letter-spacing", "dx", "dy", "textLength",
	"lengthAdjust", "startOffset", "role", "aria-label", "aria-hidden",
	"version", "xml:space", "href", "xlink:href",
)

// references are attributes that point at something; they may only point inside the file.
var svgReferences = setOf("href", "xlink:href", "fill", "stroke", "clip-path", "mask", "marker-start", "marker-mid", "marker-end", "filter", "style")

// cssBlocked finds what a stylesheet or style attribute must not carry: another
// file (url), a stylesheet include (@import), or script-like values.
var cssBlocked = regexp.MustCompile(`(?i)@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding`)

var cssURL = regexp.MustCompile(`(?i)url\s*\(\s*['"]?\s*([^'")\s]*)`)

func setOf(items ...string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		set[item] = true
	}
	return set
}

// looksLikeSVG says whether the first element is <svg>, without trusting the name.
func looksLikeSVG(data []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	for {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		if start, ok := token.(xml.StartElement); ok {
			return start.Name.Local == "svg"
		}
	}
}

// SanitizeSVG rewrites an SVG from an allowlist: only known elements and
// attributes survive, event handlers and scripts are gone, and nothing may
// refer to anything outside the file. The result is what gets stored.
func SanitizeSVG(data []byte) ([]byte, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = true
	// No DOCTYPE entities: encoding/xml does not expand them, and we drop the directive.
	var out bytes.Buffer
	var open []string // names of kept elements, to close them
	skip := 0         // depth inside a dropped element
	sawRoot := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, ErrInvalidSVG
		}
		switch t := token.(type) {
		case xml.StartElement:
			if skip > 0 {
				skip++
				continue
			}
			if !sawRoot {
				if t.Name.Local != "svg" {
					return nil, ErrInvalidSVG
				}
				sawRoot = true
			}
			if !keepElement(t.Name) || len(open) >= maxSVGDepth {
				skip = 1
				continue
			}
			out.WriteString("<" + t.Name.Local)
			if len(open) == 0 {
				out.WriteString(` xmlns="` + svgNamespace + `" xmlns:xlink="http://www.w3.org/1999/xlink"`)
			}
			for _, attr := range t.Attr {
				name, value, ok := keepAttribute(attr)
				if ok {
					out.WriteString(" " + name + `="`)
					_ = xml.EscapeText(&out, []byte(value))
					out.WriteString(`"`)
				}
			}
			out.WriteString(">")
			open = append(open, t.Name.Local)
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			out.WriteString("</" + open[len(open)-1] + ">")
			open = open[:len(open)-1]
		case xml.CharData:
			if skip > 0 || len(open) == 0 {
				continue
			}
			text := string(t)
			if open[len(open)-1] == "style" && hasExternalURL("style", text) {
				return nil, ErrInvalidSVG
			}
			_ = xml.EscapeText(&out, t)
		}
		// Comments, processing instructions and directives are dropped.
	}
	if !sawRoot || len(open) != 0 {
		return nil, ErrInvalidSVG
	}
	return out.Bytes(), nil
}

func keepElement(name xml.Name) bool {
	if name.Space != "" && name.Space != svgNamespace {
		return false
	}
	return svgElements[name.Local]
}

func keepAttribute(attr xml.Attr) (string, string, bool) {
	name := attr.Name.Local
	switch attr.Name.Space {
	case "", svgNamespace:
	case "http://www.w3.org/1999/xlink":
		if name != "href" {
			return "", "", false
		}
		name = "xlink:href"
	case "xml":
		if name != "space" {
			return "", "", false
		}
		name = "xml:space"
	case "xmlns":
		return "", "", false
	default:
		return "", "", false
	}
	if attr.Name.Space == "" && name == "xmlns" {
		return "", "", false
	}
	if strings.HasPrefix(strings.ToLower(name), "on") || !svgAttributes[name] {
		return "", "", false
	}
	value := attr.Value
	if svgReferences[name] && hasExternalURL(name, value) {
		return "", "", false
	}
	if name == "style" && cssBlocked.MatchString(value) {
		return "", "", false
	}
	return name, value, true
}

// hasExternalURL is true when a value refers to anything but an id in this file.
func hasExternalURL(name, value string) bool {
	if name == "href" || name == "xlink:href" {
		return !strings.HasPrefix(strings.TrimSpace(value), "#")
	}
	if cssBlocked.MatchString(value) {
		return true
	}
	for _, match := range cssURL.FindAllStringSubmatch(value, -1) {
		if !strings.HasPrefix(match[1], "#") {
			return true
		}
	}
	return false
}
