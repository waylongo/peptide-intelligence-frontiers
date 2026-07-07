#!/usr/bin/env bash
# export-slides-pdf.sh - Convert /pif slides HTML to a 16:9 landscape PDF.
# Usage: bash scripts/export-slides-pdf.sh <input.html> [output.pdf]
set -euo pipefail

INPUT="${1:?Usage: export-slides-pdf.sh <input.html> [output.pdf]}"
OUTPUT="${2:-${INPUT%.html}.pdf}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_HTML="$SKILL_ROOT/templates/slides.html"

if [ ! -f "$INPUT" ]; then
  echo "Error: input HTML not found: $INPUT" >&2
  exit 1
fi

CHROME=""
for cmd in \
  "google-chrome" \
  "google-chrome-stable" \
  "chromium-browser" \
  "chromium" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if command -v "$cmd" >/dev/null 2>&1 || [ -x "$cmd" ]; then
    CHROME="$cmd"
    break
  fi
done

if [ -z "$CHROME" ]; then
  echo "Error: Chrome/Chromium not found. Install Chrome, or print the HTML from a browser with 960x540px pages, no margins, and background graphics enabled." >&2
  exit 1
fi

PRINT_HTML="$(mktemp /tmp/pif-slides-print-XXXXXX.html)"
trap "rm -f '$PRINT_HTML'" EXIT

python3 - "$INPUT" "$PRINT_HTML" "$TEMPLATE_HTML" <<'PYEOF'
import os
import re
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    html = f.read()

template_path = sys.argv[3]
if "@media print" not in html and os.path.exists(template_path):
    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()
    template_style = re.search(r"<style>[\s\S]*?</style>", template)
    if template_style:
        if re.search(r"<style>[\s\S]*?</style>", html):
            html = re.sub(r"<style>[\s\S]*?</style>", template_style.group(0), html, count=1)
        else:
            html = html.replace("</head>", template_style.group(0) + "\n</head>")

print_patch = """
<script>
document.querySelectorAll(".slide").forEach(function(slide) {
  slide.classList.add("active");
  slide.classList.remove("exit-up");
});
</script>
"""

if "</body>" not in html:
    raise SystemExit("input HTML is missing </body>")

html = html.replace("</body>", print_patch + "</body>")

with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write(html)
PYEOF

"$CHROME" --headless --disable-gpu --no-sandbox \
  --print-to-pdf="$OUTPUT" \
  --print-to-pdf-no-header \
  --run-all-compositor-stages-before-draw \
  --virtual-time-budget=8000 \
  "file://$PRINT_HTML" >/dev/null 2>&1

if [ -f "$OUTPUT" ]; then
  SIZE="$(du -h "$OUTPUT" | cut -f1)"
  PAGES="$(pdfinfo "$OUTPUT" 2>/dev/null | awk '/Pages:/ {print $2}' || true)"
  if [ -n "$PAGES" ]; then
    echo "$OUTPUT ($SIZE, $PAGES pages)"
  else
    echo "$OUTPUT ($SIZE)"
  fi
else
  echo "Error: PDF export failed" >&2
  exit 1
fi
