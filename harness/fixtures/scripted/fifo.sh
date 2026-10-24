# overlay on `single ready`: concurrency.default 1 in the repo's config, and the scripted model plays `pair` (two independent full-lane tasks)
. "$(dirname "$0")/../_base.sh"
node -e 'const f=".cadre/config.json",c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.concurrency={default:1};require("fs").writeFileSync(f,JSON.stringify(c))'
commit 'chore: one task at a time'; git branch -f dev main
echo '{"script":"pair"}' > .git/scripted.json
