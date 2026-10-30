// The JUnit reader (plan 2.1(c), 2.6): core reads one capped regular file under the run's scratch and parses it with the vendored xmldom. No regex here.
// Breaches (a link, over 1 MB, outside the scratch) and malformed XML are `bad`, never a pass; a missing file is "no results".
import type { Host } from '../types'
// @ts-ignore the vendored bundle ships without types; this file is its only importer
import xmldom from './vendor/xmldom/xmldom.mjs'

export interface Result { name: string; status: 'pass' | 'fail' | 'error' | 'skip'; text?: string }
const LIMIT = 1 << 20
// node's reporter escapes a quote twice (&amp;quot;): the parser decodes once, a name is decoded once more (a literal & in a name stays). &amp; last, so &amp;lt; gives &lt;.
export const unxml = (s: string) => s.split('&lt;').join('<').split('&gt;').join('>').split('&quot;').join('"').split('&apos;').join("'").split('&amp;').join('&')
const STATUS: Record<string, Result['status']> = { failure: 'fail', error: 'error', skipped: 'skip' }

// <testcase> elements; a child <failure> / <error> / <skipped> decides the status (else pass); name = classname.name; text = the child's message + body. Throws on bad XML.
export function junit(xml: string): Result[] {
  if (xml.includes('<!DOCTYPE') || xml.includes('<!ENTITY')) throw new Error('a DOCTYPE or entity declaration is refused')
  const doc = new xmldom.DOMParser({ onError: (_l: string, m: string) => { throw new Error(m) } }).parseFromString(xml, 'text/xml')
  const root = doc.documentElement?.tagName; if (doc.doctype || (root !== 'testsuite' && root !== 'testsuites')) throw new Error('not a JUnit report')
  const out: Result[] = [], cases = doc.getElementsByTagName('testcase')
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i], cls = unxml(c.getAttribute('classname') ?? ''), name = unxml(c.getAttribute('name') ?? ''); let kind: any
    for (let k = c.firstChild; k && !kind; k = k.nextSibling) if (k.nodeType === 1 && STATUS[k.tagName]) kind = k
    out.push({ name: cls ? `${cls}.${name}` : name, status: kind ? STATUS[kind.tagName] : 'pass', ...(kind ? { text: `${kind.getAttribute('message') ?? ''} ${kind.textContent ?? ''}`.trim() } : {}) })
  }
  return out
}

// `file` is the host path core allocated (${scratch}/cadre/junit-<gate>.xml); `scratch` anchors the confinement. {} = no file.
export async function readJunit(h: Host, file: string, scratch: string): Promise<{ results?: Result[]; bad?: string }> {
  const st = await h.run(['stat', '-c', '%F %s', file]).catch(() => undefined); if (!st || st.exitCode || !st.stdout.trim()) return {}   // lstat (no -L): a symlink is not a regular file; no answer = no file
  const parts = st.stdout.trim().split(' '), size = Number(parts.pop())
  if (parts.join(' ') !== 'regular file') return { bad: 'the JUnit file is not a regular file' }
  if (!(size <= LIMIT)) return { bad: 'the JUnit file is over 1 MB' }
  const real = (await h.stat(file, { resolve: true }))?.realPath, root = (await h.stat(scratch, { resolve: true }))?.realPath ?? scratch
  if (file.split('/').includes('..') || !real?.startsWith(`${root}/`)) return { bad: 'the JUnit file lies outside its folder' }
  const text = await h.readText(file); if (text === null) return {}
  try { return { results: junit(text) } } catch (e) { return { bad: `the JUnit file is not valid: ${(e as Error).message.split('\n')[0].slice(0, 120)}` } }
}
