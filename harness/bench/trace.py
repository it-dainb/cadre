#!/usr/bin/env python3
"""Turn-level analysis of a captured run.

Cost totals say a run was expensive. This says which turn bought what, which
plugin and skill caused it, what the subagents were actually told, and where
the tokens went. Everything before this was inferred from the agent's closing
prose, which has been wrong in both directions.

Usage: trace.py <rundir>            # rundir contains transcripts.tar
       trace.py <rundir> --turns    # per-turn detail
"""
import json, sys, tarfile, tempfile, pathlib, collections

# $/Mtok: input, output, cache-write, cache-read.
PRICES = {
    'opus':   (5.0, 25.0, 6.25, 0.50),
    'sonnet': (3.0, 15.0, 3.75, 0.30),
    'haiku':  (1.0,  5.0, 1.25, 0.10),
}

def tier(model):
    for k in PRICES:
        if k in (model or ''):
            return k
    return 'opus'

def cost(u, model):
    i, o, cw, cr = PRICES[tier(model)]
    return (u.get('input_tokens', 0) * i
            + u.get('output_tokens', 0) * o
            + u.get('cache_creation_input_tokens', 0) * cw
            + u.get('cache_read_input_tokens', 0) * cr) / 1e6

def load(rundir):
    tar = pathlib.Path(rundir) / 'transcripts.tar'
    if not tar.exists():
        sys.exit(f'no transcripts.tar in {rundir}')
    tmp = tempfile.mkdtemp()
    with tarfile.open(tar) as t:
        t.extractall(tmp)
    out, meta = {}, {}
    for f in pathlib.Path(tmp).rglob('*.jsonl'):
        raw = []
        for line in f.open():
            line = line.strip()
            if not line:
                continue
            try: raw.append(json.loads(line))
            except json.JSONDecodeError: pass

        # One API response is split across several records — one per content
        # block — sharing a message id. Summing records double-counts usage;
        # keeping only the first drops the tool_use blocks and the final usage.
        # Fold each id into one record: max of each usage field, content
        # unioned — in place, appending a placeholder to `recs` only on first
        # sight of a message id. A prior version appended non-assistant
        # records as they were seen but held all assistant records back to
        # extend() at the very end, which put every non-assistant record
        # before every assistant one regardless of true file order — fatal
        # for anything (like a compact_boundary) whose *position* in the
        # stream is the signal.
        merged = {}
        recs = []
        for r in raw:
            if r.get('type') != 'assistant':
                recs.append(r)
                continue
            mid = r.get('message', {}).get('id')
            if mid not in merged:
                obj = json.loads(json.dumps(r))
                obj['_segment'] = 0
                merged[mid] = obj
                recs.append(obj)
                continue
            tgt = merged[mid]
            tu, su = tgt['message'].setdefault('usage', {}), r.get('message', {}).get('usage', {})
            for k, v in su.items():
                if isinstance(v, int):
                    tu[k] = max(tu.get(k, 0), v)
            tc = tgt['message'].get('content')
            sc = r.get('message', {}).get('content')
            if isinstance(tc, list) and isinstance(sc, list):
                have = {json.dumps(c, sort_keys=True) for c in tc}
                tc.extend(c for c in sc if json.dumps(c, sort_keys=True) not in have)

        # Compaction boundaries. The CLI's own canonical predicate: a
        # `system` record with subtype `compact_boundary`. On disk the
        # metadata is camelCase (`compactMetadata`, `preTokens`,
        # `durationMs`) — measured on a real compacted run, not assumed. A
        # reading of the binary's strings said snake_case; it was wrong, and
        # the mismatch surfaced as every field parsing to None rather than as
        # an error, so both spellings are accepted here. Each boundary starts a new
        # segment; assistant turns are stamped with the segment they fall in.
        # `microcompact_boundary` is lighter-weight tool-result trimming, not
        # a full compaction — counted separately, does not advance segment.
        # `isCompactSummary` on a user record is a different, in-memory-only
        # summary mechanism; reported if present, never used for segmenting.
        segment, boundaries, microcompacts, summaries = 0, [], 0, 0
        for r in recs:
            if r.get('type') == 'system' and r.get('subtype') == 'compact_boundary':
                cm = r.get('compactMetadata') or r.get('compact_metadata') or {}
                g = lambda *ks: next((cm[k] for k in ks if cm.get(k) is not None), None)
                boundaries.append({
                    'trigger': cm.get('trigger'),
                    'pre_tokens': g('preTokens', 'pre_tokens'),
                    'post_tokens': g('postTokens', 'post_tokens'),
                    'duration_ms': g('durationMs', 'duration_ms'),
                })
                segment += 1
            elif r.get('type') == 'system' and r.get('subtype') == 'microcompact_boundary':
                microcompacts += 1
            elif r.get('type') == 'user' and r.get('isCompactSummary'):
                summaries += 1
            elif r.get('type') == 'assistant':
                r['_segment'] = segment

        name = 'subagent:' + f.stem[:16] if 'subagents' in str(f) else 'lead'
        out[name] = recs
        meta[name] = {'boundaries': boundaries, 'microcompacts': microcompacts, 'summaries': summaries}
    return out, meta

def tools_of(rec):
    return [c.get('name') for c in rec.get('message', {}).get('content', [])
            if isinstance(c, dict) and c.get('type') == 'tool_use']

def summarize(rundir):
    """Machine-readable digest for the harness row, pulled with the same
    segmentation logic as the human report. Kept separate from main() so run.sh
    can capture one JSON line instead of scraping the printed report.

    Note the two fields are scoped differently, which is easy to misread:
    peak_ctx is the max over EVERY session including subagents, while
    boundaries/microcompacts count the lead only. That is deliberate — an arm
    that offloads to subagents moves context out of the lead rather than
    removing it, and a lead-only peak would score that relocation as a saving.
    Only the lead has an autocompact trigger, so only the lead can have
    boundaries. Comparing a row's peak_ctx against the configured trigger is
    therefore NOT valid for multi-session arms: use the per-session peak_ctx
    printed by main() for that."""
    sessions, boundary_meta = load(rundir)
    out = {'peak_ctx': 0, 'boundaries': 0, 'microcompacts': 0}
    # A subagent session existing at all means the lead issued a Task
    # dispatch — true for cadre's cheapest, most common rung (`doer`, no
    # worktree, no spec file, no .cadre/tasks/) just as much as for the full
    # planner/worker/reviewer loop. `.cadre/tasks/<id>/` is a planner
    # artifact, written only by the escalated path; using it as "did cadre
    # engage" reads the majority case as a harness error. Session splitting
    # already exists in load() (subagent transcripts land under a
    # `subagents` path) — this reuses that split rather than re-deriving it.
    out['engaged'] = any(name.startswith('subagent:') for name in sessions)
    for name, recs in sessions.items():
        asst = [r for r in recs if r.get('type') == 'assistant']
        if not asst:
            continue
        peaks = [r['message'].get('usage', {}).get('input_tokens', 0)
                 + r['message'].get('usage', {}).get('cache_read_input_tokens', 0)
                 + r['message'].get('usage', {}).get('cache_creation_input_tokens', 0)
                 for r in asst]
        out['peak_ctx'] = max(out['peak_ctx'], max(peaks, default=0))
        if name == 'lead':
            m = boundary_meta.get(name, {})
            out['boundaries'] = len(m.get('boundaries', []))
            out['microcompacts'] = m.get('microcompacts', 0)
    return out

def main():
    rundir = sys.argv[1]
    if '--summary-json' in sys.argv:
        print(json.dumps(summarize(rundir)))
        return
    detail = '--turns' in sys.argv
    sessions, boundary_meta = load(rundir)

    # The local price table cannot know every tier's exact rates (opus-5[1m]
    # priced 24% above the table on a checked run), so absolute dollars come
    # from the CLI's own total and the transcript supplies the split. Shares are
    # measured; the scale factor is borrowed.
    scale, auth = 1.0, None
    aj = pathlib.Path(rundir) / 'agent.json'
    if aj.exists():
        try:
            auth = json.load(aj.open()).get('total_cost_usd')
        except Exception:
            auth = None
    if auth:
        raw_total = sum(
            cost(r['message'].get('usage', {}), r['message'].get('model'))
            for recs in sessions.values() for r in recs if r.get('type') == 'assistant')
        if raw_total > 0:
            scale = auth / raw_total

    grand = 0.0
    print(f"{'session':22}{'turns':>6}{'cost':>9}{'out tok':>9}{'cacheR':>10}  models")
    for name, recs in sorted(sessions.items()):
        asst = [r for r in recs if r.get('type') == 'assistant']
        c = scale * sum(cost(r['message'].get('usage', {}), r['message'].get('model')) for r in asst)
        grand += c
        out = sum(r['message'].get('usage', {}).get('output_tokens', 0) for r in asst)
        cr = sum(r['message'].get('usage', {}).get('cache_read_input_tokens', 0) for r in asst)
        models = sorted({(r['message'].get('model') or '?').replace('claude-', '') for r in asst})
        print(f'{name:22}{len(asst):>6}{c:>9.4f}{out:>9}{cr:>10}  {",".join(models)}')
    print(f"{'TOTAL':22}{'':>6}{grand:>9.4f}" + (f"   (CLI reported ${auth:.4f})" if auth else ""))

    if 'lead' in sessions:
        print(f"lead turns: {len([r for r in sessions['lead'] if r.get('type') == 'assistant'])}")

    # Which plugin and skill caused the spend.
    attr = collections.defaultdict(float)
    for recs in sessions.values():
        for r in recs:
            if r.get('type') != 'assistant':
                continue
            k = (r.get('attributionPlugin') or 'base', r.get('attributionSkill') or '-')
            attr[k] += scale * cost(r['message'].get('usage', {}), r['message'].get('model'))
    if attr:
        print('\nattributed spend:')
        for (p, s), c in sorted(attr.items(), key=lambda x: -x[1]):
            print(f'  {p:24} skill={s:14} ${c:.4f}')

    # Tool mix — where turns go.
    tc = collections.Counter()
    for recs in sessions.values():
        for r in recs:
            if r.get('type') == 'assistant':
                tc.update(tools_of(r))
    if tc:
        print('\ntool calls: ' + ', '.join(f'{k}x{v}' for k, v in tc.most_common()))

    # Calls-per-turn (batching vs. one-tool-at-a-time) and peak context (how
    # close a run got to the compaction threshold), per session.
    print('\nturn stats:')
    for name, recs in sorted(sessions.items()):
        asst = [r for r in recs if r.get('type') == 'assistant']
        if not asst:
            continue
        usages = [r['message'].get('usage', {}) for r in asst]
        calls = [len(tools_of(r)) for r in asst]
        # Zero-call (pure-text/end_turn) turns are excluded from the mean —
        # otherwise a chatty agent reads as a non-batching one.
        nonzero = [c for c in calls if c > 0]
        mean = sum(nonzero) / len(nonzero) if nonzero else 0.0
        dist = collections.Counter(min(c, 3) for c in calls)
        peaks = [u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0)
                 + u.get('cache_creation_input_tokens', 0) for u in usages]
        peak_i = max(range(len(peaks)), key=lambda i: peaks[i])
        print(f'  {name:20} calls/turn={mean:.2f} (excl. {dist[0]} zero-call turns)  '
              f'dist[0,1,2,3+]={dist[0]},{dist[1]},{dist[2]},{dist[3]}  '
              f'peak_ctx={peaks[peak_i]} @turn={peak_i}')

    # (d) compaction. A boundary starts a new segment and is reported with
    # its metadata; microcompacts and isCompactSummary sightings are counted
    # but never advance the segment — see load().
    for name, recs in sorted(sessions.items()):
        m = boundary_meta.get(name, {})
        b = m.get('boundaries', [])
        if b:
            print(f'\n{name} compaction boundaries:')
            for i, bnd in enumerate(b, 1):
                parts = [f"trigger={bnd['trigger']}", f"pre_tokens={bnd['pre_tokens']}"]
                if bnd.get('post_tokens') is not None:
                    parts.append(f"post_tokens={bnd['post_tokens']}")
                if bnd.get('duration_ms') is not None:
                    parts.append(f"duration_ms={bnd['duration_ms']}")
                print(f'  {i}: ' + ' '.join(parts))
            asst = [r for r in recs if r.get('type') == 'assistant']
            for s in sorted({r.get('_segment', 0) for r in asst}):
                seg_asst = [r for r in asst if r.get('_segment', 0) == s]
                c = scale * sum(cost(r['message'].get('usage', {}), r['message'].get('model')) for r in seg_asst)
                print(f'  segment {s}: turns={len(seg_asst)} cost=${c:.4f}')
        if m.get('microcompacts'):
            print(f'{name} microcompact_boundary events: {m["microcompacts"]} '
                  '(tool-result trimming, not full compaction)')
        if m.get('summaries'):
            print(f'{name} isCompactSummary user records: {m["summaries"]}')

    # What a subagent was actually told, and how big that prompt was.
    for name, recs in sorted(sessions.items()):
        if not name.startswith('subagent'):
            continue
        first = next((r for r in recs if r.get('type') == 'user'), None)
        if not first:
            continue
        content = first.get('message', {}).get('content')
        text = content if isinstance(content, str) else ' '.join(
            c.get('text', '') for c in content if isinstance(c, dict))
        print(f'\n{name} spawn prompt ({len(text)} chars):')
        print('  ' + text[:400].replace('\n', '\n  '))

    if detail:
        print('\nper-turn:')
        for name, recs in sorted(sessions.items()):
            for r in recs:
                if r.get('type') != 'assistant':
                    continue
                u = r['message'].get('usage', {})
                m = (r['message'].get('model') or '?').replace('claude-', '')
                t = ','.join(tools_of(r)) or '-'
                print(f"  {name:20} {m:18} ${cost(u, m):.4f} out={u.get('output_tokens',0):>5} "
                      f"cacheR={u.get('cache_read_input_tokens',0):>7} {t}")

main()
