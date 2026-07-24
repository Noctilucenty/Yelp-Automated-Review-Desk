#!/usr/bin/env bash
# Build a pre-configured ZIP that installs and works with no setup screen.
#
#   ./build-configured.sh <desk-url> <dashboard-token> [business-name]
#
# The resulting ZIP contains a config.json the extension reads on first install.
# That token grants full read/write access to your Review Desk, so treat the ZIP
# like a password: share it directly with staff, never post it publicly and
# never commit it.

set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

DESK_URL="${1%/}"
TOKEN="$2"
BUSINESS="${3:-}"

OUT="dist"
NAME="review-desk-helper-configured"

rm -rf "$OUT/$NAME" "$OUT/$NAME.zip"
mkdir -p "$OUT/$NAME"

cp manifest.json background.js content.js options.html options.js README.md LICENSE "$OUT/$NAME/"

# python3 rather than a heredoc so the token is JSON-escaped correctly.
DESK_URL="$DESK_URL" TOKEN="$TOKEN" BUSINESS="$BUSINESS" python3 - "$OUT/$NAME/config.json" <<'PY'
import json, os, sys
json.dump({
    "deskUrl": os.environ["DESK_URL"],
    "deskToken": os.environ["TOKEN"],
    "businessName": os.environ["BUSINESS"],
}, open(sys.argv[1], "w"), indent=2)
PY

( cd "$OUT" && zip -qr "$NAME.zip" "$NAME" )

echo "✓ $OUT/$NAME.zip"
echo
echo "  Staff install: unzip, open chrome://extensions, enable Developer mode,"
echo "  click Load unpacked, select the unzipped folder. It is ready immediately —"
echo "  no options screen, nothing to paste."
echo
echo "  This ZIP contains a live token. Share it directly; never post it publicly."
