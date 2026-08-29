#!/bin/bash
# 把 mp3 传到 Cloudflare R2（手册 §8）。对象键与仓库内路径一致。
# 坑：wrangler 的 r2 object put 默认 --local（本地模拟器，产物写进 CWD 的 .wrangler/），
# 必须显式 --remote 才真的上传。
set -u
export XDG_CONFIG_HOME=/tmp/xdg-config
W=/tmp/wrtools/node_modules/.bin/wrangler
BUCKET=ai-flashcards-audio
ok=0; fail=0
for f in "$@"; do
  key="audio/renna/$(basename "$f")"
  if timeout 300 "$W" r2 object put "$BUCKET/$key" --file "$f" --content-type audio/mpeg --remote >/dev/null 2>&1; then
    printf "  ✓ %s\n" "$key"; ok=$((ok+1))
  else
    printf "  ✗ %s\n" "$key"; fail=$((fail+1))
  fi
done
echo "上传完成：成功 $ok，失败 $fail"
