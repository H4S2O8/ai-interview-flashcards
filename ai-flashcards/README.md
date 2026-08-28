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

## 数据

数据库在 `FileManager.appGroupDocumentsDirectory/ai-flashcards.db`，放 App Group 目录是为了让小组件
（跑在独立扩展进程）也能读到。

卡片 id 由「题面文本的 FNV-1a 哈希」生成，所以在 `cards.json` 里增删、重排卡片都不会打乱已有复习进度，
只有改动题面才会被当成新卡。改完卡片记得把 `cards.json` 顶部的 `version` 加一，App 下次启动会自动增量导入。

## 评分

四档映射到 SM-2 的质量分：忘了 q=2 / 困难 q=3 / 良好 q=4 / 简单 q=5。答「忘了」的卡 10 分钟后当天重排。

## 版权

题库内容为小林面试笔记原创，此处仅作个人学习用途，请勿分发。
