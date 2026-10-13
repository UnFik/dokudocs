# DokuDocs logo

The mark is a D cut by one diagonal into two halves: a document and the version beside it. The upper-left half is the ink colour, the lower-right half is the accent.

## Files

| File | Use |
|---|---|
| `dokudocs-symbol.svg`, `-dark.svg` | Full-colour mark on light / dark backgrounds |
| `dokudocs-symbol-small.svg` | Mark below 24 px: wider cut |
| `dokudocs-horizontal.svg`, `-dark.svg` | Mark and wordmark side by side. Default lockup |
| `dokudocs-stacked.svg`, `-dark.svg` | Mark above wordmark, for square spaces |
| `mono/` | One-colour black, white and azure for print, stamps, single-ink use |
| `web/` | favicon (`.ico`, `.svg`, PNG sizes), app icon, maskable icon, `site.webmanifest`, `head-snippet.html` |

## Colour

| | Light background | Dark background |
|---|---|---|
| Ink half and wordmark | `#14171A` | `#E6E8EB` |
| Accent half | `#0369A1` | `#38BDF8` |
| App icon tile | `#0369A1` with white mark | same |

Values match `DESIGN.md` (`--ink`, `--signal`). Contrast of the accent half against `#FFFFFF` is 5.9:1, against `#0F1114` the lighter azure is 8.8:1.

## Clear space and size

- Clear space on every side: a quarter of the mark's height (40 units on the 256 grid).
- Minimum size: symbol 16 px with `dokudocs-symbol-small.svg` (full drawing from 24 px); horizontal lockup 96 px wide.
- Use the small cut for favicons and anything under 24 px.

## Do not

- Recolour the halves in any other pair, or swap which half holds the accent.
- Close the gap, rotate the cut, or add outlines, shadows or gradients.
- Stretch, or set the wordmark in another typeface.
- Place the full-colour mark on a mid-tone or photographic background; use the one-colour versions.

## Notes

- Wordmark: Inter SemiBold (SIL Open Font License), converted to outlines, no custom letter edits.
- No trademark or reverse-image search has been run. Do that before launch.
