# AI 面试闪卡

跑在 [Scripting](https://apps.apple.com/app/apple-store/id6479691128) 上的间隔重复闪卡，题库来自
[小林面试笔记的大模型面试题](https://xiaolinnote.com/ai/)。

当前收录全部五个专题，共 86 道题、556 张卡片、86 篇原文：

| 专题 | 题数 | 卡片 | 平均 |
| --- | --- | --- | --- |
| Agent | 16 | 132 | 8.2 |
| LLM 工具调用 | 16 | 98 | 6.1 |
| RAG | 20 | 92 | 4.6 |
| 大模型工程 | 22 | 134 | 6.1 |
| LangChain 框架 | 12 | 100 | 8.3 | 12 |

## 仓库结构：开发 / 生产分离

| 目录 | 角色 |
| --- | --- |
| `ai-flashcards/` | **生产环境**：手机通过 `remoteResource` 同步的唯一范围，只放 App 运行需要的文件 |
| `dev/` | **开发环境**：生成脚本、静态检查、制作手册、讲稿对白、TTS 缓存等，不会同步到手机 |

给 `ai-flashcards/` 增删文件前先想想：手机上用得到吗？用不到就放 `dev/`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `ai-flashcards/index.tsx` | 主 App：复习 / 题库 / 原文 / 统计四个 Tab |
| `ai-flashcards/widget.tsx` | 桌面小组件，显示今日待复习张数 |
| `ai-flashcards/db.ts` | SQLite 建表、导入、查询、评分写回、LLM 配置与问答记录 |
| `ai-flashcards/srs.ts` | SM-2 调度算法 |
| `ai-flashcards/llm.ts` | 调用 OpenAI 兼容 Chat Completions（默认 SpaceXAI） |
| `ai-flashcards/ask.tsx` | 询问 AI 页：编辑题干、发送、按题保存记录 |
| `ai-flashcards/cards.json` | 卡片数据 |
| `ai-flashcards/articles.json` | 五个专题共 86 篇原文正文（不含配图），可选资源 |
| `ai-flashcards/article.tsx` | 原文阅读器；Agent 专题带播客播放器与讲稿 |
| `ai-flashcards/podcasts_renna.json` | 《Agent 面试课》讲稿（16 集，仁菜 / 桑多涅） |
| `ai-flashcards/audio/renna/*.mp3` | 各集 TTS 音频（同名 `.lrc` 为同步歌词，App 会读） |
| `dev/讲稿/*.txt` | 与 json 同源的可读对白（仅开发参考） |
| `dev/gen_podcast_renna.py` | 用 Fish Audio 重新生成讲稿 JSON 和 mp3 |
| `dev/check.py` | 静态检查：未定义组件、Hooks 规则、几类文档零用例的高危写法 |
| `dev/播客讲稿制作手册.md` | 后续板块讲稿生成的交接文档 |

## 自动更新

`script.json` 里配了 `remoteResource`，指向本仓库的 `ai-flashcards/` 目录，`autoUpdateInterval` 为 86400 秒
（24 小时）。脚本会按这个间隔自己拉取更新，不用再手动导入。

复习页右下角显示 `v<脚本版本> · 题库 v<cards.json 版本>`，可以据此确认手机上跑的是哪一版。

## 数据

数据库在 `FileManager.appGroupDocumentsDirectory/ai-flashcards.db`，放 App Group 目录是为了让小组件
（跑在独立扩展进程）也能读到。

卡片 id 由「题面文本的 FNV-1a 哈希」生成，所以在 `cards.json` 里增删、重排卡片都不会打乱已有复习进度，
只有改动题面才会被当成新卡。改完卡片记得把 `cards.json` 顶部的 `version` 加一，App 下次启动会自动增量导入。

## 交互

- 点「显示答案」翻面；答案没显示时左右滑动也能翻面
- 翻面后 **左滑 = 忘了，右滑 = 良好**，卡片跟手位移 + 轻微旋转，过阈值会提示这一松手打哪一档
- 「困难 / 简单」保留在按钮上：上下滑会和答案区的纵向滚动抢手势，没有绑定

## 评分

四档映射到 SM-2 的质量分：忘了 q=2 / 困难 q=3 / 良好 q=4 / 简单 q=5。答「忘了」的卡 10 分钟后当天重排。

## 询问 AI

每张卡都可以进「询问 AI」。默认输入是本题题干，系统提示会要求模型直接回答，而不是只复述题目。

入口：

- 复习页翻面前后的「询问 AI」
- 题库 → 每个题号分组的「询问 AI」
- 单张卡详情页

问答按「一道题」保存（`deck` + 题号），同一题拆出的多张卡共享记录。清空复习进度不会删这些记录；可在询问页清空本题记录。

接口在「统计 → LLM 接口」或询问页底部：可保存多套端点/Key/模型，点列表切换，询问用打勾的那套。主界面已经全屏 present，不能再用 `Dialog.prompt`（会静默失败）。

询问走 **OpenAI 兼容 Chat Completions**，`stream: true`，按 SSE 边收边显示，回答用 Scripting 的 `Markdown` 组件渲染。

| 项 | 默认 |
| --- | --- |
| 端点 | `https://api.x.ai/v1`（SpaceXAI，OpenAI 兼容） |
| 模型 | `grok-4.5` |
| Key | 空，需自行填写 |

端点填 base URL 即可，例如 `https://api.openai.com/v1`、`https://api.x.ai/v1`，或完整 `…/v1/chat/completions`。只填主机名时会补 `/v1/chat/completions`。Key 存在本机 `meta` 表，不随脚本更新上传。

## 原文对照

`articles.json` 收录五个专题共 86 篇正文（标题、段落、列表、代码块），**不含配图** ——
配图是作者的手绘素材，走 CDN 外链且带水印，未抓取；看图请点页面底部链接去原网页。

入口三处，注意层级 —— 原文对应的是「一道题」，不是「一张卡」（一道题拆成 2~11 张卡）：

- 独立的「原文」Tab：按五个专题分组（每组标题为「专题名 · N 篇」），组内按题号列出
- 题库 → 每个题号分组的首行「阅读原文」
- 复习页翻面后底部的「原文」（这是情境入口：当前这张卡出自哪道题）

`articles.json` 约 1.3MB，启动时预热，避免首次翻卡时同步解析造成卡顿。
文件缺失时降级为提示 + 网页链接，不影响 App 其余功能。

## Agent 面试课（播客）

Agent 专题 16 道题被改写成双人播客课《Agent 面试课》：仁菜主理，桑多涅以面试官视角拆题。音频用 Fish Audio `s2.1-pro-free` 合成，mp3 放在 `audio/renna/`。播放器固定在原文页顶部，下面可切「歌词 / 原文」。歌词按 `audio/renna/*.lrc` 时间轴跟随播放滚动，点某一句或拖进度条可跳转。

入口：原文 Tab 里标了「播客课 · 含讲稿」的篇目、题库分组的「听课 · 原文」、复习翻面后的「听课」。

重新生成（仓库根目录，`.env` 里要有 `FISH_KEY`）：

```
.venv/bin/python dev/gen_podcast_renna.py
```

## 内容出处与署名

`cards.json` 里的卡片是对 **[小林面试笔记](https://xiaolinnote.com/ai/)「大模型面试题」全部五个专题**
（Agent、LLM 工具调用、RAG、大模型工程、LangChain 框架）的要点提炼，
**原始内容与著作权归公众号 @小林面试笔记 所有**。
卡片只保留便于记忆的结论性要点；`articles.json` 收录对应正文的文本块，不含配图，
并未复刻原文的完整讲解、手绘配图或代码示例 —— 想真正学懂请去读原文：

<https://xiaolinnote.com/ai/>

本仓库仅供个人学习复习使用。如果著作权方希望移除这部分内容，请提 issue，会立即删除。

## 代码许可

`index.tsx` / `widget.tsx` / `article.tsx` / `ask.tsx` / `db.ts` / `srs.ts` / `llm.ts` 为本仓库自有代码，MIT 许可。
此许可不适用于 `cards.json` / `articles.json` 的内容。
