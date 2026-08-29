# -*- coding: utf-8 -*-
"""把 dev/草稿/s3_eps.py 的 EPS 注入 dev/gen_podcast_renna.py 的 rag 区段（替换式）。
每次改完草稿跑一次；注入前断言无半角双引号和反斜杠。"""
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('s3', HERE / 's3_eps.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

lines = ['CURRENT_DECK = "rag"   # S3：RAG（rag deck）', '']
for n in sorted(m.EPS):
    title, turns = m.EPS[n]
    for _, t in turns:
        assert '"' not in t and '\\' not in t, f'ep{n} 非法字符: {t[:40]}'
    lines.append(f'# ============ 第 {n} 集 ============')
    lines.append(f'ep({n}, "{title}", [')
    for role, t in turns:
        lines.append(f'    T("{role}", "{t}"),')
    lines.append(']),')
    lines.append('')
block = '\n'.join(lines)

path = HERE.parent / 'gen_podcast_renna.py'
src = path.read_text(encoding='utf-8')
start = src.index('CURRENT_DECK = "rag"')
end = src.index('# ── 讲稿体检')
path.write_text(src[:start] + block + '\n' + src[end:], encoding='utf-8')

# 回读校验：注入内容与草稿逐字一致
g = importlib.util.module_from_spec(importlib.util.spec_from_file_location('gen', path))
importlib.util.spec_from_file_location
g2spec = importlib.util.spec_from_file_location('gen', path)
g = importlib.util.module_from_spec(g2spec)
g2spec.loader.exec_module(g)
g.select_deck('rag')
same = all(
    [(t['s'], t['t']) for t in g.EPISODES[n]['turns']] == [(r, t) for r, t in m.EPS[n][1]]
    for n in m.EPS
)
print(f'注入 {len(m.EPS)} 集，逐字一致: {same}')
assert same
