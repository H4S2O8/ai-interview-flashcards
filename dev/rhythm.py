"""讲稿节奏化辅助（手册 §10）。把平句里「短引子。展开说明」的第一个句号改成破折号 —— S2 的说话节奏。
只动没有任何语气标记的轮次，且引子长度在 3-14 字之间（太长的不是引子，是完整句）。
这是机械辅助，改完必须人眼扫一遍。"""
import importlib.util, pathlib, re, sys
INTERJ = list("啊诶欸哦噢呀嘛呢吧哎唉嗯") + ["……", "——", "！", "？！"]

def flat(t):
    return not any(i in t for i in INTERJ)

def fix(t):
    if not flat(t):
        return t
    m = re.search(r"^(.{3,14}?)。(?=.{6,})", t)
    return t[:m.end(1)] + "——" + t[m.end():] if m else t

def main(path, n):
    spec = importlib.util.spec_from_file_location("m", path)
    m = importlib.util.module_from_spec(spec); sys.modules["m"] = m; spec.loader.exec_module(m)
    src = pathlib.Path(path).read_text(encoding="utf-8")
    changed = 0
    for role, txt in m.EPS[n][1]:
        new = fix(txt)
        if new != txt and f'"{txt}"' in src:
            src = src.replace(f'"{txt}"', f'"{new}"', 1); changed += 1
    pathlib.Path(path).write_text(src, encoding="utf-8")
    print(f"E{n}: 节奏化 {changed} 处")

if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]))
