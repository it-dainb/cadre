# overlay on `single ready`: the worker's routing names a model the gate refuses (the repo's config); the scripted model plays `lite`
. "$(dirname "$0")/../_base.sh"
node -e 'const f=".cadre/config.json",c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.roles={worker:{byRisk:{light:{model:"gpt-5"}}}};require("fs").writeFileSync(f,JSON.stringify(c))'
commit 'chore: a model the gate refuses'; git branch -f dev main
echo '{"script":"lite"}' > .git/scripted.json
