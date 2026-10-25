# base: a uv project (pyproject.toml + uv.lock, no dependencies yet) with cadre already set up (like `single` + `ready`); the task needs `six`, which is not installed.
# uv.lock is made here from the real registry, so `uv add six` only has to extend it.
. "$(dirname "$0")/_base.sh"
mkdir -p src/textlib test .cadre
cat >pyproject.toml <<'T'
[project]
name = "textlib"
version = "0.0.0"
requires-python = ">=3.9"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/textlib"]
T
printf '"""textlib: small text helpers."""\n\n\ndef shout(s):\n    return s.upper() + "!"\n' >src/textlib/__init__.py
# the tests find the src layout and the project's own .venv (where the dependency lands) without an install of the project itself
cat >test/__init__.py <<'T'
import glob, os, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path[:0] = [os.path.join(ROOT, "src"), *glob.glob(os.path.join(ROOT, ".venv", "lib", "python*", "site-packages"))]
T
printf 'import unittest\nfrom textlib import shout\n\n\nclass T(unittest.TestCase):\n    def test_shout(self):\n        self.assertEqual(shout("hi"), "HI!")\n' >test/test_shout.py
printf '# textlib\n' >README.md
uv lock -q --python python3 || exit 1
gi
echo '{ "units": [{"root":".","setup":[],"checks":{"test":["python3","-m","unittest","discover","-s","test","-t","."]},"tdd":{"paths":["test/**"]}}] }' >.cadre/config.json
printf '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n' >CHANGELOG.md
printf '.cadre/state/\n__pycache__/\n.venv/\n' >>.git/info/exclude
mkdir -p .claude && echo '{ "env": { "CLAUDE_CODE_ENABLE_TASKS": "false", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }' >.claude/settings.local.json
printf '.claude/settings.local.json\n' >>.git/info/exclude
commit 'chore: cadre config'
git branch dev main
