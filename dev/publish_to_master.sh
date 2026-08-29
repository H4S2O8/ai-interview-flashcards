#!/bin/bash
# 把 json 和 lrc 从 dev 工作区回流到 master 工作区并提交（手册 §8 第 2、3 路）。
# mp3 不走这里 —— 它们进 R2，不进 git（.gitignore 有 *.mp3）。
# 用法：dev/publish_to_master.sh <deck 前缀...>   例：dev/publish_to_master.sh rag llm
set -eu
DEV="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="$DEV/../flashcards"
[ -d "$MASTER/.git" ] || { echo "找不到 master 工作区 $MASTER"; exit 1; }

echo "=== 回流前核对 ==="
"$MASTER/.venv/bin/python" - "$DEV" "$MASTER" <<'PY'
import json,sys,pathlib
dev,mas=sys.argv[1],sys.argv[2]
d=json.loads((pathlib.Path(dev)/"ai-flashcards/podcasts_renna.json").read_text(encoding="utf-8"))["decks"]
m=json.loads((pathlib.Path(mas)/"ai-flashcards/podcasts_renna.json").read_text(encoding="utf-8"))["decks"]
print("  dev   :", {k:len(v) for k,v in d.items()})
print("  master:", {k:len(v) for k,v in m.items()})
missing=[f"{k}[{n}]" for k,v in d.items() for n,e in v.items() if not e.get("ms")]
if missing: sys.exit(f"  ✗ 有 {len(missing)} 集缺 ms（时间轴未写入），先跑完 TTS：{missing[:5]}")
print("  ✓ 所有集都有时间轴")
PY

cp "$DEV/ai-flashcards/podcasts_renna.json" "$MASTER/ai-flashcards/podcasts_renna.json"
for p in "$@"; do
  n=$(ls "$DEV"/ai-flashcards/audio/renna/${p}*.lrc 2>/dev/null | wc -l | tr -d ' ')
  cp "$DEV"/ai-flashcards/audio/renna/${p}*.lrc "$MASTER/ai-flashcards/audio/renna/"
  echo "  已回流 ${p}*.lrc（$n 个）"
done

cd "$MASTER"
cur=$(grep -o '"version": "[^"]*"' ai-flashcards/script.json | head -1 | sed 's/.*: "//;s/"//')
next=$(echo "$cur" | awk -F. '{printf "%s.%s.%d", $1,$2,$3+1}')
sed -i '' "s/\"version\": \"$cur\"/\"version\": \"$next\"/" ai-flashcards/script.json
echo "  版本号 $cur -> $next"
echo
echo "=== master 待提交 ==="
git status -s | head -40
echo
echo "未提交。核对无误后自行 git add / commit / push。"
