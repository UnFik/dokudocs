// East-Asian Wide (W) and Fullwidth (F) code-point ranges. JavaScript's Unicode
// property escapes do not expose East_Asian_Width, so the ranges are inlined
// from the Unicode East Asian Width table. Each pair is an inclusive [start,
// end] range whose code points occupy two monospace columns.
const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals .. Kangxi Radicals .. CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK symbols and punctuation
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables / Radicals
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms / Small Form Variants
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoticons / Misc symbols and pictographs
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extension B and beyond
]

// Nonspacing (Mn) and enclosing (Me) combining marks render with zero advance.
const COMBINING_MARK = /\p{Mn}|\p{Me}/u

// Format characters that occupy no columns (zero-width space family and BOM).
function isZeroWidth(codePoint: number): boolean {
  return (
    codePoint === 0x200b || // zero width space
    (codePoint >= 0x200c && codePoint <= 0x200f) || // ZWNJ/ZWJ/marks
    codePoint === 0xfeff // zero width no-break space (BOM)
  )
}

function isWide(codePoint: number): boolean {
  return WIDE_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end
  )
}

/**
 * The number of monospace columns `str` occupies. Combining marks and
 * zero-width formatting characters contribute 0; East-Asian wide / fullwidth
 * code points contribute 2; everything else contributes 1.
 *
 * Iterating with `for...of` walks the string by code point, so astral
 * characters (surrogate pairs) are measured once rather than per code unit.
 */
export default function stringWidth(str: string): number {
  let width = 0

  for (const char of str) {
    const codePoint = char.codePointAt(0)!

    if (isZeroWidth(codePoint) || COMBINING_MARK.test(char)) continue

    width += isWide(codePoint) ? 2 : 1
  }

  return width
}
