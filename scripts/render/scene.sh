#!/bin/sh
# Runs inside the render image: shows the example bar (render.ini) in real
# Polybar on i3 on Xvfb, at 288 dpi, and screenshots it.
#   /themes    this repository's themes/ (read-only)
#   /examples  this repository's examples/ (read-only)
#   /scene     this directory (read-only)
#   /out       where bar.png goes, with raw pixels and the log
# Workspaces 1-3 hold an xterm each (an empty one would vanish); 3 rings
# the bell while unfocused, so i3 marks it urgent; i3 is in its resize mode.
set -eu
export LANG=C.UTF-8
CANVAS='#0b1f27' # bg1, the spec's canvas
mkdir -p "$HOME/.config/polybar" "$HOME/.config/fontconfig"
cp /themes/mistpine.ini /examples/config.ini /scene/render.ini "$HOME/.config/polybar/"
# Grayscale antialiasing, as on most screenshots.
cat > "$HOME/.config/fontconfig/fonts.conf" <<'XML'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <match target="font"><edit name="rgba" mode="assign"><const>none</const></edit></match>
</fontconfig>
XML

Xvfb :9 -screen 0 3000x400x24 -dpi 288 -nolisten tcp >/dev/null 2>&1 &
for _ in $(seq 50); do [ -e /tmp/.X11-unix/X9 ] && break; sleep 0.1; done
export DISPLAY=:9
hsetroot -solid "$CANVAS" >/dev/null
# Each xterm goes to its workspace by instance name, however late it starts.
cat > /tmp/i3.conf <<'CFG'
font pango:monospace 8
default_border none
assign [instance="^ws1$"] number 1
assign [instance="^ws2$"] number 2
assign [instance="^ws3$"] number 3
mode "resize" {
    bindsym Escape mode "default"
}
CFG
i3 -c /tmp/i3.conf >/tmp/i3.log 2>&1 &
for _ in $(seq 100); do i3-msg -t get_version >/dev/null 2>&1 && break; sleep 0.1; done

for ws in 1 2 3; do
  bell=""
  [ $ws = 3 ] && bell='while [ ! -e /tmp/ring ]; do sleep 0.1; done; printf "\a";'
  xterm -name ws$ws -bw 0 -fa 'JetBrains Mono' -bg "$CANVAS" -cr "$CANVAS" \
    -xrm 'XTerm*bellIsUrgent: true' -e sh -c "printf '\033[?25l'; $bell exec sleep 600" &
done
count() { i3-msg -t get_tree | grep -o '"window":[0-9]' | wc -l; }
for _ in $(seq 300); do [ "$(count)" -ge 3 ] && break; sleep 0.1; done
# i3 marks windows that open on a hidden workspace urgent: visit each to
# clear that, then let workspace 3 ring for real.
for ws in 2 3 1; do i3-msg -q workspace number $ws; sleep 0.3; done
touch /tmp/ring
sleep 1

polybar -c "$HOME/.config/polybar/render.ini" render > /out/polybar.log 2>&1 &
sleep 3
i3-msg -q mode resize
sleep 1
import -window root /out/bar.png
convert /out/bar.png -depth 8 rgb:/out/bar.rgb
identify -format '%w %h\n' /out/bar.png > /out/bar.size
