#!/bin/sh
# Runs inside the verify image: starts Polybar with examples/config.ini and
# themes/mistpine.ini, unchanged, on i3 on Xvfb, and leaves its version, its
# log and a screenshot in /out for verify.ts.
#   /themes, /examples  this repository's files (read-only)
set -u
export LANG=C.UTF-8
mkdir -p "$HOME/.config/polybar" "$HOME/.config/fontconfig"
# Grayscale antialiasing: subpixel fringes would leave thin text with no
# pixel in its own color.
cat > "$HOME/.config/fontconfig/fonts.conf" <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <match target="font"><edit name="rgba" mode="assign"><const>none</const></edit></match>
</fontconfig>
XML
cp /themes/mistpine.ini /examples/config.ini "$HOME/.config/polybar/"
polybar --version | head -1 > /out/version

Xvfb :9 -screen 0 1600x200x24 -nolisten tcp >/dev/null 2>&1 &
for _ in $(seq 50); do [ -e /tmp/.X11-unix/X9 ] && break; sleep 0.1; done
export DISPLAY=:9
hsetroot -solid '#0b1f27' >/dev/null
printf 'font pango:monospace 8\ndefault_border none\n' > /tmp/i3.conf
i3 -c /tmp/i3.conf >/tmp/i3.log 2>&1 &
for _ in $(seq 100); do i3-msg -t get_version >/dev/null 2>&1 && break; sleep 0.1; done

# The bar's colors as Polybar resolves them through the references.
for key in background foreground separator-foreground; do
  printf '%s %s\n' $key "$(polybar -c "$HOME/.config/polybar/config.ini" --dump=$key mistpine 2>/dev/null)"
done > /out/dump
polybar -c "$HOME/.config/polybar/config.ini" mistpine > /out/polybar.log 2>&1 &
sleep 3
import -window root /out/bar.png
convert /out/bar.png -depth 8 rgb:/out/bar.rgb
identify -format '%w %h\n' /out/bar.png > /out/bar.size
exit 0
