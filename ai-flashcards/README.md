# AI 面试闪卡

跑在 [Scripting](https://apps.apple.com/app/apple-store/id6479691128) 上的间隔重复闪卡，题库来自
[小林面试笔记的大模型面试题](https://xiaolinnote.com/ai/)。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.tsx` | 主 App：复习 / 题库 / 统计三个 Tab |
| `widget.tsx` | 桌面小组件，显示今日待复习张数 |
| `db.ts` | SQLite 建表、导入、查询、评分写回 |
| `srs.ts` | SM-2 调度算法 |
| `cards.json` | 卡片数据 |

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

## 内容出处与署名

`cards.json` 里的卡片是对 **[小林面试笔记](https://xiaolinnote.com/ai/)「大模型面试题 · Agent 面试专题」** 的
要点提炼，**原始内容与著作权归公众号 @小林面试笔记 所有**。这里只保留了便于记忆的结论性要点，
没有收录原文的讲解、配图和代码示例 —— 想真正学懂请去读原文，每道题都有完整的原理拆解：

<https://xiaolinnote.com/ai/agent/>

本仓库仅供个人学习复习使用。如果著作权方希望移除这部分内容，请提 issue，会立即删除。

## 代码许可

`index.tsx` / `widget.tsx` / `db.ts` / `srs.ts` 为本仓库自有代码，MIT 许可。此许可不适用于 `cards.json`。
