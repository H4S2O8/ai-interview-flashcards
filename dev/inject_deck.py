#!/usr/bin/env python3
"""把草稿 EPS 注入 gen_podcast_renna.py。

草稿里每一轮是 (role, 显示文本) 或 (role, 显示文本, 合成文本)。
合成文本可带 Fish Audio 方括号情感标记，只进 TTS，不进字幕。

用法：python dev/inject_deck.py dev/草稿/s5_eps.py langchain "S5：框架与工程化"
"""
import importlib.util, pathlib, sys

def q(t: str) -> str:
    assert '"' not in t and "\\" not in t, t
    return '"' + t + '"'

def main(draft: str, deck: str, comment: str) -> None:
    spec = importlib.util.spec_from_file_location("draft", draft)
    m = importlib.util.module_from_spec(spec)
    sys.modules["draft"] = m
    spec.loader.exec_module(m)

    out = [f'CURRENT_DECK = "{deck}"   # {comment}', ""]
    for n in sorted(m.EPS):
        title, turns = m.EPS[n]
        out.append(f"ep({n}, {q(title)}, [")
        for turn in turns:
            role, disp = turn[0], turn[1]
            tts = turn[2] if len(turn) > 2 else None
            if tts:
                out.append(f"    T({q(role)}, {q(disp)}, {q(tts)}),")
            else:
                out.append(f"    T({q(role)}, {q(disp)}),")
        out.append("])")
        out.append("")

    p = pathlib.Path("dev/gen_podcast_renna.py")
    s = p.read_text(encoding="utf-8")
    marker = f'CURRENT_DECK = "{deck}"'
    if marker in s:
        i = s.index(marker)
        j = s.index("\ndef main() -> None:", i)
        s = s[:i] + "\n".join(out) + s[j:]
    else:
        s = s.replace("\ndef main() -> None:", "\n" + "\n".join(out) + "\ndef main() -> None:", 1)
    p.write_text(s, encoding="utf-8")
    print(f"注入 {len(m.EPS)} 集到 deck={deck}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
