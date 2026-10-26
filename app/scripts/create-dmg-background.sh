#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source="$root/assets/dmg-background.png"
dimensions="$(sips -g pixelWidth -g pixelHeight "$source" | awk '/pixelWidth/ { width = $2 } /pixelHeight/ { print width "x" $2 }')"
case "$dimensions" in
  654x422|1308x844) ;;
  *) printf 'Unsupported DMG background size: %s\n' "$dimensions" >&2; exit 1 ;;
esac
work_dir="$(mktemp -d /tmp/libfurry-dmg-background.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT

# The reference has a 654x422 content area and a 22-point title bar.
# electron-builder uses the background's pixel size for the entire window,
# including that title bar. Pad only the bottom; Finder clips the extra strip.
for scale in 1 2; do
  width=$((654 * scale))
  height=$((422 * scale))
  title_bar=$((22 * scale))
  frame="$work_dir/background-$scale.png"
  sips -z "$height" "$width" "$source" --out "$frame" >/dev/null
  # A one-pixel horizontal inset avoids sips ignoring a crop with a zero offset.
  sips --padToHeightWidth "$((height + 2 * title_bar))" "$((width + 2))" --padColor 000000 "$frame" >/dev/null
  sips --cropToHeightWidth "$((height + title_bar))" "$width" --cropOffset "$title_bar" 1 "$frame" >/dev/null
  sips --setProperty dpiWidth "$((72 * scale))" --setProperty dpiHeight "$((72 * scale))" "$frame" >/dev/null
done

tiffutil -cathidpicheck "$work_dir/background-1.png" "$work_dir/background-2.png" -out "$root/assets/dmg-background.tiff"
