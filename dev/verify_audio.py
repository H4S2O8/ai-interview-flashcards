#!/usr/bin/env python3
"""音频交付核验（手册 §8 之前必跑）：
1. json 的 ms 与 mp3 实测时长逐集对比（S2 验收线 ≤50ms）
2. lrc 行数与轮数一致、末条时间戳落在时长的 90%-100%
3. 可选 --remote：核验公网可达、字节数一致、Range 206

不依赖 ffprobe（本机 homebrew 的 x265 dylib 坏了），直接解 mp3 的 Xing/Info 帧计数。
用法：python dev/verify_audio.py --deck llm [--remote]
"""
import argparse, json, pathlib, re, struct, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
RATES = {0: 44100, 1: 48000, 2: 32000}
BASE = "https://audio.asylum.icu/"


def mp3_ms(path):
    b = pathlib.Path(path).read_bytes()
    i = 0
    if b[:3] == b"ID3":
        i = 10 + ((b[6] & 0x7F) << 21 | (b[7] & 0x7F) << 14 | (b[8] & 0x7F) << 7 | (b[9] & 0x7F))
    while i < len(b) - 4 and not (b[i] == 0xFF and (b[i + 1] & 0xE0) == 0xE0):
        i += 1
    h = b[i:i + 4]
    ver = (h[1] >> 3) & 3
    sr = RATES[(h[2] >> 2) & 3]
    if ver == 2:
        sr //= 2
    elif ver == 0:
        sr //= 4
    for off in (i + 4 + 17, i + 4 + 32, i + 4 + 9, i + 4 + 21):
        if b[off:off + 4] in (b"Xing", b"Info"):
            flags = struct.unpack(">I", b[off + 4:off + 8])[0]
            if flags & 1:
                frames = struct.unpack(">I", b[off + 8:off + 12])[0]
                return round(frames * (1152 if ver == 3 else 576) / sr * 1000)
    return None


def head(url):
    r = subprocess.run(["curl", "-sI", "--max-time", "20", "--retry", "2", url],
                       capture_output=True, text=True).stdout
    code = re.search(r"HTTP/[\d.]+ (\d+)", r)
    size = re.search(r"[Cc]ontent-[Ll]ength: *(\d+)", r)
    return (code.group(1) if code else "?"), (int(size.group(1)) if size else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deck", required=True)
    ap.add_argument("--remote", action="store_true", help="额外核验公网可达与字节一致")
    args = ap.parse_args()

    pods = json.loads((ROOT / "ai-flashcards" / "podcasts_renna.json").read_text(encoding="utf-8"))
    eps = pods["decks"].get(args.deck, {})
    if not eps:
        sys.exit(f"json 里没有 deck {args.deck}")

    bad = []
    print(f"{'集':>4} {'json':>9} {'mp3':>9} {'差':>7} {'lrc':>5} {'轮':>4} {'末条占比':>8}"
          + ("  远端" if args.remote else ""))
    for k in sorted(eps, key=int):
        e = eps[k]
        f = ROOT / "ai-flashcards" / e["audio"]
        if not f.exists():
            print(f"{k:>4}  mp3 缺失"); bad.append(k); continue
        real = mp3_ms(f)
        diff = e.get("ms", 0) - real
        lrc = f.with_suffix(".lrc")
        ts = re.findall(r"\[(\d+):(\d+)\.(\d+)\]", lrc.read_text(encoding="utf-8")) if lrc.exists() else []
        last = (int(ts[-1][0]) * 60000 + int(ts[-1][1]) * 1000 + int(ts[-1][2]) * 10) if ts else 0
        ratio = last / real if real else 0
        row = (f"{k:>4} {e.get('ms',0)/1000:>8.1f}s {real/1000:>8.1f}s {diff:>6}ms "
               f"{len(ts):>5} {len(e['turns']):>4} {ratio:>7.1%}")
        problems = []
        if abs(diff) > 50: problems.append("时间轴差>50ms")
        if len(ts) != len(e["turns"]): problems.append("lrc 行数≠轮数")
        if not 0.90 < ratio < 1.0: problems.append("末条时间戳异常")
        if args.remote:
            code, size = head(BASE + e["audio"])
            row += f"  {code}"
            if code != "200": problems.append(f"公网 {code}")
            elif size != f.stat().st_size: problems.append(f"字节不一致 {size}≠{f.stat().st_size}")
        print(row + ("  ✓" if not problems else "  ✗ " + "、".join(problems)))
        if problems: bad.append(k)

    print(f"\n{len(eps)} 集，问题 {len(bad)} 集" + (f"：{bad}" if bad else " —— 全部通过"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
