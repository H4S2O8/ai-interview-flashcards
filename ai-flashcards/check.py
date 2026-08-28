#!/usr/bin/env python3
"""静态检查：JSX 里用到的组件、以及顶层引用的标识符，是否都有来源。
esbuild 只查语法，抓不到「引用了一个不存在的组件」这类错误。"""
import re, sys, pathlib

# Scripting 提供的全局对象（不需要 import）
GLOBALS = {
    "SQLite","FileManager","DateComponents","CalendarNotificationTrigger",
    "TimeIntervalNotificationTrigger","LocationNotificationTrigger","Animation",
    "Data","console","JSON","Math","Date","Number","String","Object","Array",
    "Promise","Set","Map","setTimeout","clearTimeout","setInterval","clearInterval",
    "LanguageModelSession","Crypto","UUID",
}

fail = 0
for f in sorted(pathlib.Path(".").glob("*.tsx")) + sorted(pathlib.Path(".").glob("*.ts")):
    src = f.read_text(encoding="utf-8")

    imported = set()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', src):
        for part in m.group(1).split(","):
            name = part.strip().replace("type ", "").split(" as ")[-1].strip()
            if name: imported.add(name)

    defined = set(re.findall(r'^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)', src, re.M))
    defined |= set(re.findall(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)', src, re.M))
    defined |= set(re.findall(r'^\s*(?:export\s+)?type\s+([A-Za-z_]\w*)', src, re.M))

    known = imported | defined | GLOBALS

    # JSX 里用到的大写开头组件
    # 要求 < 前面是空白/括号/逗号，才算 JSX 标签；
    # 这样 useState<Card[]> 和 type Observable<T> 这类泛型不会被误判
    used = set(re.findall(r'(?<=[\s(){}>,])<([A-Z]\w*)[\s/>]', src))
    missing = sorted(used - known)
    if missing:
        fail += 1
        print(f"✗ {f}: JSX 引用了未定义的组件 -> {', '.join(missing)}")
    else:
        print(f"✓ {f}: {len(used)} 个组件全部有来源")

    # 扫描高危写法前先剥掉注释，否则注释里提到某个 API 也会被误报
    code = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    code = re.sub(r'//[^\n]*', '', code)

    # 文档里查不到用例的写法，用一次踩一次坑，直接列黑名单
    RISKY = [
        (r'<RoundedRectangle[^>]*padding=', "RoundedRectangle 直接带 padding（文档无用例，请套一层 HStack）"),
        (r'overlay=\{[^}]*undefined',       "overlay 传 undefined（文档无用例，请常驻渲染 + opacity 控制）"),
        (r'<ProgressView[^>]*padding=',     "ProgressView 直接带 padding（文档无用例，请套一层 HStack）"),
        (r'<(VStack|HStack|ZStack)[^>]*shadow=', "容器上用 shadow（文档唯一用例在 Text 上）"),
        (r'set[A-Z]\w*\(\s*\w+\s*=>', "函数式 setState（文档只出现过 setX(x + 1)，此框架未必支持）"),
        (r'DragGesture\s*\(', "DragGesture() 链式构造（文档零用例，实测卡片完全不动；请用 onDragGesture 属性形式）"),
        (r'(simultaneous|highPriority)Gesture=', "simultaneous/highPriorityGesture（文档只有 Tap/LongPress 用例，配 DragGesture 实测失效）"),
    ]
    for pat, why in RISKY:
        if re.search(pat, code, re.S):
            fail += 1
            print(f"✗ {f}: {why}")

sys.exit(1 if fail else 0)
