# sourced by every fixture; cwd = the empty work dir (mounted at /work/run). Base fixtures make the repo, overlays (named after them) change it.
set -euo pipefail
TS=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../evals/fixtures/ts" && pwd)
commit() { git add -A && git commit -qm "$1"; }
gi() { git init -q -b main && git config user.email dev@example.com && git config user.name dev && commit 'chore: initial commit'; }
# seed <key> <json>: one key of the plugin's $.store (tui.sh copies .harness-store.json into the container before claude starts)
seed() { node -e 'const f=".harness-store.json",fs=require("fs"),o=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):{};o[process.argv[1]]=JSON.parse(process.argv[2]);fs.writeFileSync(f,JSON.stringify(o))' "$1" "$2"; }
# cadre's per-repo $.store key prefix for a container path: <basename>-<fnv1a64(path)[:6]> (commands/init.repoKeyOf)
repokey() { node -e 'let h=0xcbf29ce484222325n;for(const b of Buffer.from(process.argv[1]))h=((h^BigInt(b))*0x100000001b3n)&0xffffffffffffffffn;console.log(process.argv[1].split("/").pop()+"-"+h.toString(16).padStart(16,"0").slice(0,6))' "$1"; }
