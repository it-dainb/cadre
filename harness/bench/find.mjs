// Copied next to a hidden check as test/zz-find.mjs: the named exports from whichever src/**/*.mjs module exports them (behaviour, not file layout, is checked;
// the judge reports files outside the declared paths separately as offPath).
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const src = new URL('../src/', import.meta.url).pathname
const files = d => readdirSync(d, { withFileTypes: true }).flatMap(f => (f.isDirectory() ? files(join(d, f.name)) : f.name.endsWith('.mjs') ? [join(d, f.name)] : []))
const mods = await Promise.all(files(src).map(f => import(pathToFileURL(f)).catch(() => ({}))))
export const pick = (...names) => Object.fromEntries(names.map(n => [n, mods.find(m => n in m)?.[n]]))
