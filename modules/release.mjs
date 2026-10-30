// The release hook (event `release`; `node release.mjs [changelog path]`). Dry (core asks which version a release would be): the version from our own commit headers, `!` -> major
// (0.x -> minor), feat -> minor, else patch, no tag -> 0.1.0. Real (core cut a working folder at dev): [Unreleased] becomes the release in that folder; core commits it and tags.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cut } from './changelog.mjs'

const input = JSON.parse(readFileSync(process.env.CADRE_INPUT, 'utf8')), file = process.argv[2] ?? 'CHANGELOG.md', git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const done = (r, code = 0) => { writeFileSync(process.env.CADRE_RESULT, JSON.stringify(r)); process.exit(code) }
function infer() {
  const tag = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n')[0]; if (!tag) return '0.1.0'
  const [a, b, c] = tag.replace(/^v/, '').split('.').map(Number), subjects = git('log', '--no-merges', '--format=%s', `${tag}..${input.at}`).split('\n')
  if (subjects.some(s => /^\w+(\([^)]*\))?!:/.test(s))) return a === 0 ? `0.${b + 1}.0` : `${a + 1}.0.0`
  return subjects.some(s => /^feat(\(|:|!)/.test(s)) ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`
}
try {
  if (input.dry) done({ version: input.version ?? infer() })
  if (!existsSync(file)) done({ note: `${file} is missing on dev` }, 1)
  writeFileSync(file, cut(readFileSync(file, 'utf8'), input.version, input.today)); done({ version: input.version })
} catch (e) { done({ note: e.message }, 1) }
