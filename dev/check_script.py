#!/usr/bin/env python3
"""讲稿质量闸：硬约束 + 压缩比 + 人味指标 + 结构。

用法：
    python dev/check_script.py dev/讲稿/rag第01集.txt --deck rag --qno 1

人味区间取自 S2（tools 板块）全季实测 —— 见手册 §2.5。
低于下限通常意味着写成了信息交换而不是对话。
"""
import argparse, json, pathlib, re, statistics, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
INTERJ = list("啊诶欸哦噢呀嘛呢吧哎唉嗯") + ["……", "——", "！", "？！"]
KNOW = ["RAG","检索","生成","微调","参数","chunk","Chunking","切割","Embedding","向量","token","prompt",
        "Rerank","粗排","精排","知识库","模型","语义","召回","溯源","热更新","Cross-Encoder","Query",
        "协议","调用","缓存","索引","图谱","幻觉","评测"]
# S2 全季实测区间（手册 §2.5）
BANDS = {"语气词轮": (0.51, 0.93), "感叹号": (3, 15), "问号": (10, 31),
         "非知识轮": (0.50, 1.00), "短轮": (0.08, 0.45)}


def bare_digits(text):
    """孤立的阿拉伯数字（违反手册 §1.4）。紧邻拉丁字母的放行 —— A2A / R1 / BM25
    这类技术专名在 S1/S2 生产讲稿里是既成写法。"""
    out = []
    for m in re.finditer(r"\d+", text):
        before = text[m.start() - 1] if m.start() else ""
        after = text[m.end()] if m.end() < len(text) else ""
        if not (before.isalpha() and before.isascii()) and not (after.isalpha() and after.isascii()):
            out.append(m.group())
    return out

def turns(path):
    out = []
    for line in pathlib.Path(path).read_text(encoding="utf-8").split("\n"):
        if "：" not in line or line.startswith("="):
            continue
        role, text = line.split("：", 1)
        role = role.strip()
        if role in ("仁菜", "桑多涅"):
            out.append((role, text.strip()))
    return out


def source_chars(deck, qno):
    arts = json.loads((ROOT / "ai-flashcards" / "articles.json").read_text(encoding="utf-8"))["decks"]
    a = arts.get(deck, {}).get(str(qno))
    if a is None:
        return None
    return sum(len(re.sub(r"\s", "", b["v"])) for b in a["blocks"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--deck", default="rag")
    ap.add_argument("--qno", type=int)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    ts = turns(args.path)
    if not ts:
        print("✗ 没解析到任何台词行（格式应为「仁菜：…」）"); return 1
    texts = [t for _, t in ts]
    body = "".join(texts)
    lens = [len(t) for t in texts]
    fail = []

    # 1. 硬约束（手册 §1）
    hard = {
        "半角双引号": body.count('"'),
        "反斜杠": body.count("\\"),
        "孤立阿拉伯数字": len(bare_digits(body)),
    }
    for k, v in hard.items():
        if v: fail.append(f"{k} 出现 {v} 次")
    intent = [w for w in ["听完这一集","不用看原文","听众","这档节目","你口述一下","观众","本期节目"] if w in body]
    if intent: fail.append(f"台词含制作意图：{intent}")
    # 定式是仁菜说「我们下集见」，桑多涅再补最后一句 —— 所以看结尾三轮
    if not any("我们下集见" in t or "我们下季见" in t for t in texts[-3:]):
        fail.append("结尾三轮里没有节目惯例句")

    # 2. 人味（手册 §2.5）
    warm = {
        "语气词轮": sum(1 for t in texts if any(i in t for i in INTERJ)) / len(texts),
        "感叹号": sum(t.count("！") for t in texts),
        "问号": sum(t.count("？") for t in texts),
        "非知识轮": sum(1 for t in texts if not any(w in t for w in KNOW)) / len(texts),
        "短轮": sum(1 for L in lens if L <= 20) / len(lens),
    }
    for k, v in warm.items():
        lo, hi = BANDS[k]
        if v < lo: fail.append(f"人味 {k} = {v if isinstance(v,int) else format(v,'.0%')}，低于下限 {lo if isinstance(v,int) else format(lo,'.0%')}")

    # 3. 压缩比（手册 §3.2）
    ratio = None
    if args.qno:
        src = source_chars(args.deck, args.qno)
        if src:
            know = sum(len(t) for t in texts if any(w in t for w in KNOW))
            ratio = src / know if know else 0
            if ratio < 1.6:
                fail.append(f"知识压缩比 {ratio:.2f}x 低于 1.6x —— 接近照读原文")

    # 4. 人设：桑多涅不该长篇大论
    gl = [len(t) for r, t in ts if r == "桑多涅"]
    if gl and max(gl) > 110:
        fail.append(f"桑多涅有单轮 {max(gl)} 字，超过 110（她说话短）")

    if not args.quiet:
        print(f"── {pathlib.Path(args.path).name}")
        print(f"   {len(ts)} 轮 · 台词 {len(body)} 字 · 均 {statistics.mean(lens):.0f} 字 · 桑多涅最长 {max(gl) if gl else 0} 字")
        if ratio: print(f"   知识压缩比 {ratio:.2f}x")
        print("   " + " · ".join(
            f"{k} {v if isinstance(v,int) else format(v,'.0%')}" for k, v in warm.items()))
    if fail:
        print("   ✗ " + "\n   ✗ ".join(fail))
        return 1
    print("   ✓ 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
