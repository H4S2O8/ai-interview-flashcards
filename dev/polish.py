#!/usr/bin/env python3
"""草稿定稿前的收尾：省略号减量 + 整轮省略号补合成文本。

背景（手册 §11）：「……」对 Fish Audio 完全无效，只影响字幕；整轮只有它会
合成出数秒有声乱码。S1 的省略号率是 8%，S4/S5 第一版是 18% 和 38%。

用法：python dev/polish.py dev/草稿/s5_eps.py 1
     python dev/polish.py dev/草稿/s5_eps.py --all
"""
import re, sys, pathlib

LEAD = re.compile(r'\((\"host\"|\"guest\"),(\s+)\"……([^\"]{3,})\"')
BARE = re.compile(r'\((\"host\"|\"guest\"),(\s+)\"……\"\),')


def polish(path: str, keep_lead: int = 0) -> None:
    p = pathlib.Path(path)
    s = p.read_text(encoding="utf-8")

    # 1. 整轮只有省略号 → 补 [sighing]（字幕仍是「……」）
    s, n_bare = BARE.subn(lambda m: f'({m.group(1)},{m.group(2)}"……", "[sighing]"),', s)

    # 2. 去掉开头的省略号（保留句中的和整轮的）
    hits = list(LEAD.finditer(s))
    out, last, n_lead = [], 0, 0
    for i, m in enumerate(hits):
        out.append(s[last:m.start()])
        if i < keep_lead:                      # 留前几处，保住犹豫感
            out.append(m.group(0))
        else:
            out.append(f'({m.group(1)},{m.group(2)}"{m.group(3)}"')
            n_lead += 1
        last = m.end()
    out.append(s[last:])
    p.write_text("".join(out), encoding="utf-8")
    print(f"  整轮省略号补合成文本 {n_bare} 处 · 去掉开头省略号 {n_lead} 处")


if __name__ == "__main__":
    polish(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0)
