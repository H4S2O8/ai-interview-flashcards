# -*- coding: utf-8 -*-
"""把 dev/草稿/s5_eps.py 的 EPS 注入 gen 脚本的 langchain 区段（替换式）。"""
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('s5', HERE / 's5_eps.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

lines = ['CURRENT_DECK = "langchain"   # S5：框架与工程化（langchain deck）', '']
for n in sorted(m.EPS):
    title, turns = m.EPS[n]
    for _, t in turns:
        assert '"' not in t and '\\' not in t, f'ep{n} 非法字符'
    lines.append(f'# ============ 第 {n} 集 ============')
    lines.append(f'ep({n}, "{title}", [')
    for role, t in turns:
        lines.append(f'    T("{role}", "{t}"),')
    lines.append(']),')
    lines.append('')
block = '\n'.join(lines)

path = HERE.parent / 'gen_podcast_renna.py'
src = path.read_text(encoding='utf-8')
start = src.index('CURRENT_DECK = "langchain"')
end = src.index('def main() -> None:')
path.write_text(src[:start] + block + '\n' + src[end:], encoding='utf-8')

g2spec = importlib.util.spec_from_file_location('gen', path)
g = importlib.util.module_from_spec(g2spec)
g2spec.loader.exec_module(g)
g.select_deck('langchain')
same = all(
    [(t['s'], t['t']) for t in g.EPISODES[n]['turns']] == [(r, t) for r, t in m.EPS[n][1]]
    for n in m.EPS
)
print(f'注入 {len(m.EPS)} 集，逐字一致: {same}')
assert same
