# submodule-unit (S, `single ready scripted/submodule`, LANDED=1, LAND_RE=lib): a lite task in the lib submodule lands in lib's dev, then the parent's dev carries the pointer
# bump. submodule.json: lib's dev tip, whether it has the function, the parent dev's recorded lib commit (oracle: submodule)
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"; snapshots
goal "$GOAL"; until_plan; landed
L=$D/work/lib; node -e 'const [dev, has, ptr] = process.argv.slice(1); console.log(JSON.stringify({ dev, has: has === "0", ptr }))' \
  "$(git -C "$L" rev-parse dev 2>/dev/null)" "$(git -C "$L" cat-file -e dev:src/titleCase.mjs 2>/dev/null; echo $?)" "$(git -C "$D/work" ls-tree dev lib 2>/dev/null | awk '{print $3}')" >"$O/submodule.json"
