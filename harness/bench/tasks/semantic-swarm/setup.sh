#!/bin/bash
# The task the earlier set was missing.
#
# 24 modules, each with a DIFFERENT semantic bug. No shared pattern, so no sed
# script and no single regex can fix them — every file must actually be read
# and understood. Reading all 24 is the point: a single agent's context grows
# with each one, while a fan-out keeps each worker's context to one file.
#
# Deterministic: fixed table, no randomness.
set -euo pipefail
d=$1
mkdir -p "$d/src"

python3 - "$d" <<'PY'
import sys, pathlib, json
root = pathlib.Path(sys.argv[1])
src = root / "src"

# (name, broken body, fixed-behaviour spec used by the test)
MODS = [
    ("clamp",      "export const clamp=(v,lo,hi)=>v<lo?lo:v>hi?hi:lo;",            "clamp(5,0,10)==5"),
    ("median",     "export const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};", "median([1,2,3,4])==2.5"),
    ("titleCase",  "export const titleCase=s=>s.split(' ').map(w=>w.toUpperCase()).join(' ');", "titleCase('a bc')=='A Bc'"),
    ("uniq",       "export const uniq=a=>a.filter((x,i)=>a.indexOf(x)!==i);",      "uniq([1,1,2])==[1,2]"),
    ("chunk",      "export const chunk=(a,n)=>{const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,n));return o;};", "chunk([1,2,3,4],2)==[[1,2],[3,4]]"),
    ("zip",        "export const zip=(a,b)=>a.map((x,i)=>[x,b[i+1]]);",            "zip([1,2],[3,4])==[[1,3],[2,4]]"),
    ("sum",        "export const sum=a=>a.reduce((x,y)=>x+y);",                    "sum([])==0"),
    ("average",    "export const average=a=>a.reduce((x,y)=>x+y,0)/a.length-1;",   "average([2,4])==3"),
    ("range",      "export const range=(a,b)=>{const o=[];for(let i=a;i<=b;i++)o.push(i);return o;};", "range(1,3)==[1,2]"),
    ("last",       "export const last=a=>a[a.length];",                            "last([1,2])==2"),
    ("flatten",    "export const flatten=a=>a.reduce((x,y)=>x.concat(y),[]).flat(9);", "flatten([1,[2,[3]]])==[1,2,3]"),
    ("countBy",    "export const countBy=(a,f)=>a.reduce((m,x)=>{m[f(x)]=1;return m;},{});", "countBy([1,2,3],x=>x%2)=={'1':2,'0':1}"),
    ("isPalin",    "export const isPalin=s=>s===s.split('').reverse();",           "isPalin('aba')==true"),
    ("truncate",   "export const truncate=(s,n)=>s.length>n?s.slice(0,n):s+'...';", "truncate('abcdef',3)=='abc...'"),
    ("slugify",    "export const slugify=s=>s.trim().toLowerCase().replace(/ /,'-');", "slugify('a b c')=='a-b-c'"),
    ("pick",       "export const pick=(o,ks)=>ks.reduce((a,k)=>{a[k]=o[k];return a;},{});", "pick({a:1},['a','b']) has no b key"),
    ("deepGet",    "export const deepGet=(o,p)=>p.split('.').reduce((a,k)=>a[k],o);", "deepGet({a:{}},'a.b.c')==undefined"),
    ("parseBool",  "export const parseBool=s=>Boolean(s);",                        "parseBool('false')==false"),
    ("clampDate",  "export const clampDate=(d,lo,hi)=>d<lo?lo:d>hi?hi:d;",         "works on numbers, returns hi when above"),
    ("retryCount", "export const retryCount=n=>{let c=0;for(let i=0;i<n;i++)c++;return c-1;};", "retryCount(3)==3"),
    ("capitalize", "export const capitalize=s=>s.charAt(0).toUpperCase()+s.slice(0);", "capitalize('ab')=='Ab'"),
    ("dedupeBy",   "export const dedupeBy=(a,f)=>{const s=new Set();return a.filter(x=>s.has(f(x)));};", "dedupeBy([{i:1},{i:1}],x=>x.i).length==1"),
    ("safeJson",   "export const safeJson=s=>JSON.parse(s);",                      "safeJson('nope')==null instead of throwing"),
    ("pctChange",  "export const pctChange=(a,b)=>(b-a)/b*100;",                   "pctChange(50,100)==100"),
]

for name, body, spec in MODS:
    (src / f"{name}.mjs").write_text(f"// spec: {spec}\n{body}\n")

# The suite. Each assertion targets one module; all must pass.
tests = """
import assert from 'node:assert/strict';
"""
for name, _, _ in MODS:
    tests += f"import {{ {name} }} from './src/{name}.mjs';\n"

tests += """
const eq = (a, b, m) => assert.deepEqual(a, b, m);

eq(clamp(5, 0, 10), 5, 'clamp mid');
eq(clamp(-1, 0, 10), 0, 'clamp low');
eq(clamp(99, 0, 10), 10, 'clamp high');
eq(median([1, 2, 3, 4]), 2.5, 'median even');
eq(median([1, 2, 3]), 2, 'median odd');
eq(titleCase('a bc'), 'A Bc', 'titleCase');
eq(uniq([1, 1, 2]), [1, 2], 'uniq');
eq(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]], 'chunk');
eq(zip([1, 2], [3, 4]), [[1, 3], [2, 4]], 'zip');
eq(sum([]), 0, 'sum empty');
eq(sum([1, 2]), 3, 'sum');
eq(average([2, 4]), 3, 'average');
eq(range(1, 3), [1, 2, 3], 'range inclusive');
eq(last([1, 2]), 2, 'last');
eq(flatten([1, [2, [3]]]), [1, 2, 3], 'flatten');
eq(countBy([1, 2, 3], (x) => x % 2), { 1: 2, 0: 1 }, 'countBy');
eq(isPalin('aba'), true, 'isPalin true');
eq(isPalin('ab'), false, 'isPalin false');
eq(truncate('abcdef', 3), 'abc...', 'truncate long');
eq(truncate('ab', 5), 'ab', 'truncate short');
eq(slugify('a b c'), 'a-b-c', 'slugify all spaces');
eq(Object.keys(pick({ a: 1 }, ['a', 'b'])), ['a'], 'pick skips missing');
eq(deepGet({ a: {} }, 'a.b.c'), undefined, 'deepGet safe');
eq(parseBool('false'), false, 'parseBool false');
eq(parseBool('true'), true, 'parseBool true');
eq(clampDate(5, 1, 3), 3, 'clampDate high');
eq(retryCount(3), 3, 'retryCount');
eq(capitalize('ab'), 'Ab', 'capitalize');
eq(dedupeBy([{ i: 1 }, { i: 1 }], (x) => x.i).length, 1, 'dedupeBy');
eq(safeJson('nope'), null, 'safeJson invalid');
eq(safeJson('{"a":1}'), { a: 1 }, 'safeJson valid');
eq(pctChange(50, 100), 100, 'pctChange');
console.log('PASS');
"""
(root / "test.mjs").write_text(tests)
(root / "README.md").write_text(
    "# utils\n\n24 small modules in `src/`. Each file's first line is a `// spec:`\n"
    "comment describing the intended behaviour. Run the suite with:\n\n    node test.mjs\n"
)
PY
