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
    "LanguageModelSession","Crypto","UUID","fetch","Response","Headers",
    "AbortController","AbortSignal","TextDecoder","URL","Symbol",
    "AVPlayer","SharedAudioSession","MediaPlayer",
}

fail = 0
# 默认检查生产目录（手机同步的 ai-flashcards/），也可传参指定别的目录
TARGET = (pathlib.Path(sys.argv[1]) if len(sys.argv) > 1
          else pathlib.Path(__file__).resolve().parent.parent / "ai-flashcards")
for f in sorted(TARGET.glob("*.tsx")) + sorted(TARGET.glob("*.ts")):
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

    # 必须从 "scripting" 导入的模块对象。文档的 import 语句里出现过它们，
    # 而 FileManager / SQLite / Animation / DateComponents 等是真全局、不用导入。
    # 漏导入不会有语法错，只在运行到那一行时抛 ReferenceError ——
    # 若发生在 Navigation.present 之前，表现为「脚本在跑但前台一片空白」。
    MUST_IMPORT = ["Path", "Script", "Navigation", "Notification", "Widget", "Dialog"]
    for name in MUST_IMPORT:
        if re.search(r'\b' + name + r'\.', code) and name not in imported:
            fail += 1
            print(f"✗ {f}: 用了 {name}.* 但没有从 \"scripting\" 导入 {name}")

    # Hooks 规则：hook 不能出现在提前 return 之后。
    # 首次渲染若走了提前 return，该 hook 不会执行；后续渲染执行到它时
    # hook 数量对不上，渲染直接失败（症状：界面卡在上一次成功渲染的状态）。
    funcs = re.split(r'\n(?=(?:export\s+)?function\s)', code)
    for fn in funcs:
        m = re.match(r'(?:export\s+)?function\s+(\w+)', fn)
        if not m: continue
        name = m.group(1)
        # 提前 return 通常写在 if 块里（缩进 4 空格），不只是函数顶层（2 空格）
        ret = re.search(r'\n {2,4}return[\s(;]', fn)
        if not ret: continue
        tail = fn[ret.end():]
        late = re.findall(r'\b(use[A-Z]\w*)\s*\(', tail)
        # 排除定义在回调里的（粗略：只看缩进 2 空格的顶层声明）
        late_top = re.findall(r'\n  (?:const|let)\s+\w+\s*=\s*(use[A-Z]\w*)\s*\(', tail)
        late_top += re.findall(r'\n  (use[A-Z]\w*)\s*\(', tail)
        if late_top:
            fail += 1
            print(f"✗ {f}: {name}() 在提前 return 之后调用了 {', '.join(sorted(set(late_top)))} —— 违反 Hooks 规则")

sys.exit(1 if fail else 0)
