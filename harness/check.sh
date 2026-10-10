# sourced by run.sh and tui.sh: the scripts mount state under /cchome, so the image must have HOME=/cchome (Dockerfile label cadre.harness.home).
[ "$(docker image inspect -f '{{index .Config.Labels "cadre.harness.home"}}' cadre-harness 2>/dev/null)" = /cchome ] || {
  echo "harness: image cadre-harness is missing or stale (HOME is not /cchome). Rebuild: docker build -t cadre-harness $H" >&2; exit 3; }
