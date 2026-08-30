#!/usr/bin/env python3
"""讲稿质量闸：硬约束 + 压缩比 + 人味指标 + 结构。

用法：
    python dev/check_script.py dev/讲稿/rag第01集.txt --deck rag --qno 1

人味区间取自 S2（tools 板块）全季实测 —— 见手册 §2.5。
低于下限通常意味着写成了信息交换而不是对话。
"""
import argparse, json, pathlib, re, statistics, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SENT_SPLIT = re.compile(r"[。！？]|——|……")
INTERJ = list("啊诶欸哦噢呀嘛呢吧哎唉嗯") + ["……", "——", "！", "？！"]
# 知识术语不再写死：从该集原文自动抽取（拉丁词 + 常见中文技术词），
# 这样换 deck 不用改代码。写死过一次，llm 板块的 Transformer/Attention 全不认，
# 导致非知识轮虚高、压缩比虚高。
CN_TECH = ["模型","参数","训练","推理","向量","检索","生成","注意力","编码","解码","梯度","缓存",
           "量化","微调","分词","显存","算力","采样","蒸馏","对齐","专家","路由","精度","延迟",
           "吞吐","上下文","语义","预训练","涌现","幻觉","评测","部署","并行","归一化","激活"]

def deck_terms(deck, qno):
    """该集原文里出现的技术术语集合。"""
    arts = json.loads((ROOT / "ai-flashcards" / "articles.json").read_text(encoding="utf-8"))["decks"]
    a = arts.get(deck, {}).get(str(qno))
    if a is None:
        return set(CN_TECH)
    src = " ".join(b["v"] for b in a["blocks"])
    terms = {w for w in re.findall(r"[A-Za-z][A-Za-z0-9_.\-]{1,}", src) if len(w) > 1}
    terms |= {w for w in CN_TECH if w in src}
    return terms
# S2 全季实测区间（手册 §2.5）
# 非知识轮下限 0.25：用「按原文抽术语」的新方法重算 S1+S2，实际区间是 21%–85%。
# 老的 0.50 是拿写死的 rag 关键词表算出来的假阈值，会误杀正常集子。
BANDS = {"语气词轮": (0.51, 0.93), "感叹号": (3, 15), "问号": (10, 31),
         "非知识轮": (0.25, 1.00), "短轮": (0.08, 0.45)}


def bare_digits(text):
    """孤立的阿拉伯数字（违反手册 §1.4）。
    判定：取数字所在的最大 [A-Za-z0-9.-] 记号，记号里含拉丁字母就算技术专名，放行。
    这样 A2A / R1 / BM25 / GPT-4 / INT8 / V3 都过，而「40」「2023」这种量词被拦。
    A2A、R1 在 S1/S2 生产讲稿里是既成写法。"""
    out = []
    for m in re.finditer(r"[A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*", text):
        if not re.search(r"[A-Za-z]", m.group()):
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

    global TERMS
    TERMS = deck_terms(args.deck, args.qno) if args.qno else set(CN_TECH)
    ts = turns(args.path)
    if not ts:
        print("✗ 没解析到任何台词行（格式应为「仁菜：…」）"); return 1
    texts = [t for _, t in ts]
    body = "".join(texts)
    lens = [len(t) for t in texts]
    fail = []
    warn = []

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
    # 定式是仁菜说「我们下集见」，桑多涅再补几句 —— 软化点常挂在签名之后：
    # S2E16「干得不错」隔了四轮，S4E22 的季终软化点隔了五轮。放宽到六轮，
    # 规则的意图是「签名不能被埋掉」，差一格不构成被埋。
    if not any("我们下集见" in t or "我们下季见" in t for t in texts[-6:]):
        fail.append("结尾六轮里没有节目惯例句")

    # 2. 人味（手册 §2.5）
    warm = {
        "语气词轮": sum(1 for t in texts if any(i in t for i in INTERJ)) / len(texts),
        "感叹号": sum(t.count("！") for t in texts),
        "问号": sum(t.count("？") for t in texts),
        "非知识轮": sum(1 for t in texts if not any(w in t for w in TERMS)) / len(texts),
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
            # 句级而非轮级：轮级口径依赖分轮方式 —— 同一段文字，短轮拆开算「非知识」，
            # 并成段落就整段计进知识字数。改稿时把快问快答并回讲解，比值会凭空掉。
            # 实测上线季轮级下限：tools 1.34（长轮季），已低于原来写死的 1.6。
            # 句级下限：agent 2.67 / tools 1.83 / rag 2.05 —— 取 1.8 作闸。
            sents = [x for t in texts for x in SENT_SPLIT.split(t)]
            know = sum(len(x) for x in sents if any(w in x for w in TERMS))
            ratio = src / know if know else 0
            if ratio < 1.8:
                fail.append(f"知识压缩比 {ratio:.2f}x 低于 1.8x —— 接近照读原文")
            elif ratio > 8.0:
                # 只警告不判失败：分母靠关键词表估算，剧情重的集子（非知识轮高）会被高估。
                # 见到这条要人工核一遍原文覆盖，别直接当漏。
                warn.append(f"知识压缩比 {ratio:.2f}x 高于 8.0x —— 需人工核对原文覆盖"
                            f"（剧情重的集子此值会虚高）")

    # 4. 人设：桑多涅不该长篇大论
    gl = [len(t) for r, t in ts if r == "桑多涅"]
    # 单轮上限：曾经写死 110「她说话短」，与上线季直接矛盾 ——
    # S1 最长 191、S2 最长 318、S3 最长 109。她讲解时本来就是整段。
    # 320 只挡真正失控的一轮，不再逼着把讲解切碎。
    if gl and max(gl) > 320:
        fail.append(f"桑多涅有单轮 {max(gl)} 字，超过 320")
    # 反向闸：桑多涅平均轮长。上线三季 60.7 / 86.2 / 49.1，
    # 我写的 S4 只有 30.5、S5 旧稿 25.3 —— 把讲解绞成一句一问的快问快答，
    # 仁菜退化成提问机。低于 40 一律打回。
    # 下限按上线季逐集实测最小值定（agent 46.8 / tools 38.0 / rag 29.3），取 30。
    # 别再拍脑袋 —— 剧情重的集子（大量一两个字的短打）本来就会压低这个值。
    # 但全季均值应落在上线季中位区间 48–90，低于 40 要人工看一遍是不是又切碎了。
    if gl and statistics.mean(gl) < 30:
        fail.append(f"桑多涅均轮长 {statistics.mean(gl):.1f} 字，低于 30 —— 对白被切碎成快问快答")
    elif gl and statistics.mean(gl) < 40:
        warn.append(f"桑多涅均轮长 {statistics.mean(gl):.1f} 字，低于 40（上线季中位 48–90）—— 人工看一遍讲解是否被拆散")

    if not args.quiet:
        print(f"── {pathlib.Path(args.path).name}")
        print(f"   {len(ts)} 轮 · 台词 {len(body)} 字 · 均 {statistics.mean(lens):.0f} 字 · 桑多涅最长 {max(gl) if gl else 0} 字")
        if ratio: print(f"   知识压缩比 {ratio:.2f}x")
        print("   " + " · ".join(
            f"{k} {v if isinstance(v,int) else format(v,'.0%')}" for k, v in warm.items()))
    for w in warn:
        print("   ! " + w)
    if fail:
        print("   ✗ " + "\n   ✗ ".join(fail))
        return 1
    print("   ✓ 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
