#!/usr/bin/env python3
"""把 Agent 面试专题改写成双人播客讲稿，调用 Fish Audio TTS 生成 mp3。

用法（仓库根目录）：
  .venv/bin/python ai-flashcards/gen_podcast_audio.py
  .venv/bin/python ai-flashcards/gen_podcast_audio.py --only 1,2
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
ENV_FILE = REPO / ".env"

SERIES = "Agent 面试课"
HOST_NAME, GUEST_NAME = "林林", "周老师"
HOST_VOICE = "4ca68a299cb24ae599dbb828dc31a73c"  # 井芹仁菜
GUEST_VOICE = "4d0e64e39e4b4f31a816f133795c0db5"  # 冯老师 温暖磁性
CHUNK_CHARS = 8000
TTS_URL = "https://api.fish.audio/v1/tts"
TTS_MODEL = "s2.1-pro-free"

# 每集：主理人林林 + 面试官周老师。口语化，覆盖原文面试要点，不念代码。
EPISODES: dict[int, dict] = {}


def T(s: str, t: str) -> dict:
    return {"s": s, "t": t.strip()}


def ep(n: int, title: str, turns: list[dict]) -> None:
    EPISODES[n] = {"title": title, "audio": f"audio/agent/{n:02d}.mp3", "turns": turns}


ep(1, "什么是 Agent？与大模型有什么本质不同？", [
    T("host", "欢迎收听《Agent 面试课》。我是林林。这一季十六集，我们把 Agent 面试专题按题过一遍。今天第一集：什么是 Agent，它和大模型到底差在哪。"),
    T("guest", "我是周老师。这道题几乎每场都会问。看起来简单，很多人一开口就掉坑。"),
    T("host", "我先演一遍常见答法。有人会说：Agent 就是给大模型加了插件，比如 ChatGPT 能联网搜索、调 API。"),
    T("guest", "面试官马上会追：插件是 Agent？那 ChatGPT 开了搜索就是 Agent 了？你说的只是工具调用，跟 Agent 差远了。"),
    T("host", "那改口说：Agent 就是能调用工具的大模型。还是不行吗？"),
    T("guest", "还是工具调用。关键两个字你没提：自主。而且自主不只是自己决定调哪个工具。真正的 Agent，是自主规划、多步执行、感知结果再调整。你给它一个目标，它自己把任务拆成多步，一步一步做，每步结果反馈回来再指导下一步。这才叫闭环。"),
    T("host", "所以抓住一个词就行：自主闭环。"),
    T("guest", "对。Agent 本质上是一个能自主完成目标的 AI 系统。普通大模型是你问一句它答一句，被动响应；Agent 能行动，能规划，能把复杂目标拆开做完。"),
    T("host", "那普通大模型到底卡在哪？"),
    T("guest", "三个局限环环相扣。第一，知识冻结，训练数据有截止日期，今天的天气、最新股价它拿不到。第二，不能行动，它本质是文本生成器，邮件正文写得出，发送按钮按不了。第三，没有持续状态，每次调用之间失忆，不记得上一步做了什么。加在一起，它只能做一问一答，稍微复杂的多步任务就无能为力。"),
    T("host", "Agent 是怎么突破的？"),
    T("guest", "核心运作闭环是：感知、规划、行动、再感知。背后撑着三件事。第一件，工具调用，让它从说话变成做事。但要讲清：不是模型自己执行，模型只输出调哪个工具、参数填什么，真正执行的是你的代码。决策和执行分离，模型始终是大脑，不是手脚。"),
    T("host", "有了工具就能做事。第二件呢？"),
    T("guest", "记忆。短期记忆放当前任务的中间状态，长期记忆跨任务存偏好和历史，通常用向量库。第三件经常被忽略：多步推理和自我纠错。某一步失败了，它能感知、换方式重试，而不是一条路走到黑。"),
    T("host", "概念很早就有，为什么这两年才爆发？"),
    T("guest", "三个条件凑齐。模型能力跨过门槛，真能做多步决策；Function Calling 把工具调用标准化成结构化 JSON；框架、向量库、可调用的 API 把工程门槛拉下来。"),
    T("host", "面试里还常追问 MCP 和 A2A，怎么一句话分清？"),
    T("guest", "MCP 管 Agent 和工具的连接，常被比作工具世界的 USB-C，解决的是 M 个框架接 N 个工具的适配爆炸。A2A 管 Agent 和 Agent 的通信，核心是 Agent Card，一张名片写明我能做什么。两者互补，不是竞争。"),
    T("host", "收个尾。这道题千万别踩哪三个雷？"),
    T("guest", "一，把 Agent 等同于插件或工具调用。二，停在能调工具，没点出自主性。三，忽略执行闭环。答的时候点三件事：能自主规划，能通过工具真行动，每步结果会反馈回来指导下一步。再补一句：模型只负责决策，工具的执行是你的代码。"),
    T("host", "好，第一集就到这里。下一集我们拆 Agent 的四个核心组件。我是林林，我们下集见。"),
])

ep(2, "Agent 的基本架构由哪些核心组件构成？", [
    T("host", "欢迎回来，《Agent 面试课》第二集。上一集我们说清了 Agent 是什么。今天问：它跑起来，内部到底有哪些核心组件？"),
    T("guest", "很多人只答两个：LLM 和工具。面试官马上追：任务执行到一半，它怎么知道之前做了什么？"),
    T("host", "于是补上记忆。再说记忆就是上下文。够吗？"),
    T("guest", "不够。长任务上下文放不下怎么办？记忆还分短期和长期。而且还有一个组件一直没提：复杂目标怎么拆成步骤，靠谁？规划模块。完整答案是四个：LLM、工具、记忆、规划。"),
    T("host", "有个很好用的类比。"),
    T("guest", "把 Agent 比成一家公司。LLM 是老板，所有决策它拍板；工具是外包团队，真正去搜、去发邮件；记忆是档案室；规划模块是项目经理，把大目标拆成任务单。四个角色缺一不可。"),
    T("host", "先说老板。LLM 核心里，什么最容易被忽略？"),
    T("guest", "System Prompt，相当于岗位说明书。开工前就定义角色、行为边界、输出格式。工程里调优它往往占很大一块时间，因为它是你能最直接控制 Agent 行为的手段。"),
    T("host", "选模型呢？是不是越贵越好？"),
    T("guest", "不是。要看推理能力、工具调用稳不稳定、上下文窗口够不够。常见做法是：规划、关键判断用强模型，意图分类、格式提取用小模型。成本和延迟得一起权衡。"),
    T("host", "工具系统呢？"),
    T("guest", "它是和外部世界交互的唯一入口。工具定义里没有一行执行逻辑，只有名字、描述、参数，本质上是说明书。模型负责决定做什么，程序负责真正执行。还有个容易忽略的点：description 写得含糊，模型就会在不该用的时候调用。工具描述的调优，重要性不亚于 prompt 工程。"),
    T("host", "记忆分哪几层？"),
    T("guest", "短期记忆在 context window 里，像工作记忆，任务结束就清空。长期记忆用向量库，跨任务保留。有人会用认知科学的分类来类比：语义记忆存事实，情景记忆存经历，程序性记忆存怎么做事。记住这是类比，工程上通常就是向量检索加 metadata 过滤。"),
    T("host", "规划模块做什么？"),
    T("guest", "把目标拆成可执行步骤，并在执行中根据反馈调整。没有它，Agent 就只会单步反应，跑不了复杂任务。四个组件合在一起，才撑起自主闭环。"),
    T("host", "这道题三个雷再强调一遍。"),
    T("guest", "漏掉记忆和规划；把记忆说成就是上下文；以为模型自己执行工具。把四个组件加上那个公司类比，这题就很加分。"),
    T("host", "下一集我们把 Workflow、Agent、Tools 这三个最容易搅在一起的词拆开。我是林林，下集见。"),
])

ep(3, "Workflow，Agent，Tools 这三个的概念和区别介绍一下？", [
    T("host", "《Agent 面试课》第三集。今天这三个词：Workflow、Agent、Tools，面试里极容易被并排列对比，好像要三选一。"),
    T("guest", "它们根本不是同一维度，而是粒度不同、可以相互嵌套的三层结构。核心区分角度只有一个：谁来决定下一步该干什么。"),
    T("host", "有人会说：Tools 是工具，Agent 是能调工具的智能体，Workflow 是把多个 Agent 串起来。错在哪？"),
    T("guest", "错在把 Workflow 理解成多个 Agent 串联。Workflow 的节点可以是 LLM、Agent 或者 Tools，关键不是节点是什么，而是控制流由谁掌握。"),
    T("host", "从最小的一层说。Tools 是什么？"),
    T("guest", "最小的能力积木。本质是按特定格式暴露给 LLM 的函数：有名字、描述、参数 schema。它只负责被调用时执行，本身没有任何决策能力。它不知道自己该在什么时候被用。"),
    T("host", "Agent 呢？"),
    T("guest", "拿着工具自己做决定的人。内部用 LLM 当大脑，运行时动态判断：调哪个工具、要不要继续、什么时候结束。同样的输入，可能走不同路径，行为是概率性的。"),
    T("host", "那 Workflow？"),
    T("guest", "更上层的编排。开发者事先把节点做什么、按什么顺序流转写死在代码里，是 if else，不是模型临场发挥。确定性高，出了问题能精确定位。"),
    T("host", "所以一句话怎么收？"),
    T("guest", "Tools 不做决策只执行；Agent 自己做决策；Workflow 是开发者把决策提前写好。三者不是三选一，生产里通常同时存在。"),
    T("host", "那生产主流到底是纯 Agent 还是什么？"),
    T("guest", "Agentic Workflow。用 Workflow 固定主流程骨架，保证可控；在需要灵活判断的节点嵌入 Agent。能用 Workflow 解决的，就不要上纯 Agent。这句话在面试里很加分。"),
    T("host", "好。下一集我们顺着这个取舍，讲设计范式，以及为什么生产里很少用纯 Agent。我是林林，下集见。"),
])

ep(4, "了解哪些其他的 Agent 设计范式？Agent 和 Workflow 的区别是什么？", [
    T("host", "第四集。上一集说清了谁做决策。今天问：除了纯 Agent，还有哪些设计范式？以及生产环境你到底选 Agent 还是 Workflow。"),
    T("guest", "先把区别钉死。Workflow 是你提前把流程写死，每一步怎么走都固定，好控制。Agent 是让 LLM 运行时自己决定下一步，灵活但不可控。"),
    T("host", "有人把多 Agent 协作也说成设计范式。行吗？"),
    T("guest", "那是架构模式，不是设计范式。范式这边至少要能说出三个：ReAct、Plan-and-Execute、Reflection。"),
    T("host", "ReAct 我下一集细讲。Plan-and-Execute 是什么？"),
    T("guest", "把规划和执行解耦。先让模型拿出完整计划，再按步骤执行，每步可以更稳。适合流程长、步骤清楚的任务。"),
    T("host", "Reflection 呢？有人当成调试手段。"),
    T("guest", "不是调试。它是正式的运行时机制，在执行流程里加自我评估：做完一看，不行就改。质量会上去，代价是 token 和延迟都增加。这个取舍面试经常追问。"),
    T("host", "生产里优先纯 Agent 吗？"),
    T("guest", "很少。纯 Agent 行为不确定、难调试、成本容易失控、测试覆盖率天然低。工程上更常见的是混用：固定流程用 Workflow，需要灵活决策的节点嵌 Agent。从简单到复杂、按需升级，这个思路说出来很加分。"),
    T("host", "三个雷再过一遍。"),
    T("guest", "范式只知道 ReAct；把 Reflection 当调试；以为 Agent 是生产首选。真正的高分答案是 Agentic Workflow，并且能说清为什么纯 Agent 在生产里有局限。"),
    T("host", "下一集专门把 ReAct 拆开：循环到底是谁在转。我是林林，下集见。"),
])

ep(5, "Agent 推理模式有哪些？ReAct 是啥？具体是怎么实现的？", [
    T("host", "第五集，聚焦 ReAct。面试里最容易说错的一句话是：模型自己在循环。"),
    T("guest", "模型每次只输出一段文本，它不会自己转圈。循环是你的代码框架在驱动。"),
    T("host", "先把推理模式这个词说清楚。"),
    T("guest", "就是 Agent 怎么想、怎么决定下一步。常见的有 CoT、ReAct、Plan-and-Execute。CoT 是让模型把推理步骤写出来，但还是纯文字，调不了外部工具，知识过时、要查实时数据就卡住。"),
    T("host", "ReAct 补的就是这一块？"),
    T("guest", "对。ReAct 是 Reason plus Act：思考、行动、观察，再思考。推理过程显式化，同时能动态调工具。一轮典型输出是 Thought 加 Action；你的代码检测到 Action，去执行工具，把 Observation 填回历史，再把完整历史交给模型，进入下一轮。"),
    T("host", "所以模型每轮只做一件事。"),
    T("guest", "根据历史输出下一步的 Thought 和 Action。检测、执行、回填、再调用，全是你的代码。这才是 ReAct 的真正实现方式。"),
    T("host", "它有什么实战局限？"),
    T("guest", "两个。一是循环漂移，步数一多就忘了原始目标。二是错误传播，某一步观察是错的，后面会顺着错下去。"),
    T("host", "Plan-and-Execute 怎么补？"),
    T("guest", "先规划再执行，减少边走边想的漂移。工程里两者经常混用：规划用大模型，执行用小模型。把循环由框架驱动、再加上这两个局限，这题就有深度了。"),
    T("host", "下一集我们把 ReAct、Plan-and-Execute、Reflection 放在一张表里对比选型。我是林林，下集见。"),
])

ep(6, "ReAct、Plan-and-Execute、Reflection 三种范式有什么核心区别？实际项目中该如何选型？", [
    T("host", "第六集。三种范式怎么对比、怎么选。周老师先给一个定位：Reflection 和另外两个，是同一层的东西吗？"),
    T("guest", "不是。Reflection 不是独立流程，它是给 ReAct 或 Plan-and-Execute 加的检查 buff，本身不能单独成立。很多人把它并列成第三条流水线，这是错的。"),
    T("host", "那三者各自解决什么问题？"),
    T("guest", "ReAct 解决怎么边想边干，灵活度最高，长任务容易跑偏。Plan-and-Execute 解决怎么先规划再执行，结构清晰，但计划一旦写死就不够灵活。Reflection 专门解决输出质量，代价是更多 token 和更高延迟。"),
    T("host", "进阶还有动态 Replan 和 Reflexion。"),
    T("guest", "动态 Replan 是计划执行到一半发现不对，允许改计划，用来治计划太僵硬。Reflexion 更进一步，把反思沉淀成跨任务的错题本，下次类似任务能用上。一个是当次纠偏，一个是经验积累。"),
    T("host", "token 呢？"),
    T("guest", "ReAct 相对省，但步数不可控。Plan-and-Execute 多一次规划调用。Reflection 每多一轮评估和改进，成本线性涨。别在简单任务上叠满 buff。"),
    T("host", "选型口诀？"),
    T("guest", "任务简单用 ReAct；流程长且复杂用 Plan-and-Execute；输出要求高再加 Reflection。够用就好，别过度工程化。面试官一听就知道你做过项目。"),
    T("host", "下一集讲复杂任务怎么拆、为什么拆完准确率会上去。我是林林，下集见。"),
])

ep(7, "复杂任务怎么做的任务拆分？为什么要拆分？效果如何提升？", [
    T("host", "第七集：复杂任务为什么要拆，怎么拆，拆完还能再提速。"),
    T("guest", "别只说准确率高一些。面试官要听的是机制。核心原因是 context window 有限。任务越大，中间状态越多，模型很难持续追踪子目标，桌面太乱就出错。拆开之后，每步还可以独立验证和重试。"),
    T("host", "拆法有哪两种？"),
    T("guest", "静态拆分：流程固定，开发者提前写死步骤，适合客服分流、固定审批这类。动态拆分：用 Plan-and-Execute，让 LLM 自己规划，灵活，但规划质量不稳定，需要校验。"),
    T("host", "还有自适应拆分？"),
    T("guest", "某一步老做不好，就继续往下拆，直到变成模型能稳定完成的原子操作。执行中还可以 Replan：发现依赖变了或某步失败，就改后续计划，而不是一条路走到黑。"),
    T("host", "拆完还有一个常被忘掉的优化。"),
    T("guest", "识别步骤依赖。没有依赖的步骤并行跑，关键路径时间常常能降百分之四十到六十。粒度也很重要：太粗等于没拆，太细调度开销爆炸。标准是原子操作，一步能独立验证。"),
    T("host", "三个层次收个尾。"),
    T("guest", "为什么拆：窗口有限、可验证可重试。怎么拆：静态或动态。拆完做什么：并行能并行的，盯住粒度。这题就完整了。"),
    T("host", "下一集进入记忆专题，先讲记忆机制怎么设计。我是林林，下集见。"),
])

ep(8, "请你介绍一下 AI Agent 的记忆机制，并说明在实际开发中应该如何设计记忆模块？", [
    T("host", "第八集，记忆机制。没有记忆的 Agent 有多不好用？"),
    T("guest", "每轮失忆。用户昨天说的偏好今天再问就没了，复杂任务做到一半忘了目标。它看起来能聊天，其实没有连续性。"),
    T("host", "分类只说短长期够吗？"),
    T("guest", "不够。完整是四层，从短到久。感知记忆：当次调用的原始输入，最短暂。短期记忆：context window 里的 messages，维持当前任务状态。长期记忆：向量库或关系数据库里、跨任务持久化的内容。实体记忆：从对话里提炼出的结构化事实，信息密度最高。"),
    T("host", "设计记忆模块，真正难的是哪三个问题？"),
    T("guest", "存什么、怎么存、什么时候取。存什么：只存对下次任务有价值的，过滤寒暄和噪音。怎么存：语义内容走向量库，结构化偏好走关系数据库，混合存储是主流。什么时候取：任务开始前主动检索加载背景，执行中按需检索特定知识。"),
    T("host", "短期记忆的工作台不够大怎么办？"),
    T("guest", "摘要压缩、滑动窗口、重要性过滤，这些我们第十二集会专门讲。还可以上知识图谱，让记忆之间产生关联，而不是一条条孤立文本。"),
    T("host", "怎么收成一个闭环？"),
    T("guest", "读、用、写。任务前读出相关记忆，执行中用，任务后把值得留的写回去。四层分类加三个工程问题加这个闭环，这题就很难被追问倒。"),
    T("host", "下一集更抠实现：记忆怎么存、粒度多少、怎么用。我是林林，下集见。"),
])

ep(9, "Agent 的长短期记忆系统怎么做的？记忆是怎么存的？粒度是多少？怎么用的？", [
    T("host", "第九集。有人说：短期记忆存在内存里，长期记忆存数据库，用关键词搜索。周老师，这为什么会翻车？"),
    T("guest", "用户问代码习惯，历史里存的是 Python 风格偏好。关键词对不上，SQL 的 LIKE 搜不到。长期记忆的核心是 Embedding 加向量数据库，靠语义相似度，不是字符串匹配。"),
    T("host", "那把粒度拆细，每句话都存一条，覆盖更全？"),
    T("guest", "更糟。拆得越细，检索噪音越大。一条完整偏好被拆成四五条，命中其中两条，拿到的是碎片。合理粒度是一次完整交互，或者一个独立知识点。"),
    T("host", "两层记忆各自什么时候上场？"),
    T("guest", "短期记忆是任务执行中的工作台，装着当前步骤、工具返回、中间结论，任务结束就清空。长期记忆是任务前检索注入、任务后写入沉淀。一个管这次不中途失忆，一个管跨任务积累。"),
    T("host", "存储上还有什么细节？"),
    T("guest", "写入前要做去重和冲突处理：新偏好覆盖旧的，而不是并排存两份相反的话。检索时用 metadata 过滤，比如只取这个用户、最近三十天、某类事实。光会接一个向量库，面试里不够。"),
    T("host", "三个雷：关键词当语义检索、粒度越细越好、搞不清两层时机。记住就稳。下一集我们进入 Multi-Agent。我是林林，下集见。"),
])

ep(10, "什么是 Multi-Agent？", [
    T("host", "第十集：什么是 Multi-Agent。别只说多个 AI 一起干活效率更高。面试官要听的是：单个 Agent 到底卡在哪。"),
    T("guest", "两个硬限制。第一，context window 是结构性上限。复杂任务的搜索结果、推理、对话历史一股脑堆上工作台，早期内容会掉落，三十分钟前确认的方案就这么消失了。这不是努力优化能绕过去的。"),
    T("host", "第二呢？"),
    T("guest", "专业度。让一个 Agent 又搜信息、又写代码、又做测试、又写文档，每件事都是泛才，还互相干扰。一个环节出错，整条链路卡住，没有隔离。"),
    T("host", "所以 Multi-Agent 的核心思路是？"),
    T("guest", "团队作战代替单打独斗。按职能拆开，每个 Agent 只做一件事，context 干净，专业度更高。协作常见三种：顺序流水线、并行扇出、辩论或评审。"),
    T("host", "并行不只是快吧？"),
    T("guest", "对。没有依赖的子任务同时派出去，速度上来；每个 Worker 的 context 还是隔离的，程序员不会被测试用例干扰。组织方式上，工程里更常用中心化调度，责任清晰、好排查。去中心化听起来灵活，我们下一集细说为什么生产里少用。"),
    T("host", "框架呢？"),
    T("guest", "CrewAI、LangGraph 都是主流。微软这边注意一下：原来 Semantic Kernel 和 AutoGen 两条线，已经合并进 Microsoft Agent Framework。选框架时别把过时的产品名硬套上去。"),
    T("host", "这题答到位就三件事：窗口上限、专业分工、可并行。下一集讲 Single 和 Multi 怎么选型。我是林林，下集见。"),
])

ep(11, "说说 Single-Agent 和 Multi-Agent 的设计方案？", [
    T("host", "第十一集。任务简单用 Single，任务复杂用 Multi。这句为什么不够？"),
    T("guest", "复杂太模糊。步骤多并不等于要 Multi-Agent，Single-Agent 循环调工具也能搞定很多步。Multi-Agent 本身有协调成本，盲目引入只会更复杂。"),
    T("host", "那具体什么时候才该上 Multi？"),
    T("guest", "三类场景。一，单个 context 要撑爆了。二，需要不同专业分工。三，有子任务可以并行。不属于这三类，就用 Single-Agent。"),
    T("host", "Single-Agent 的结构其实就是我们前面讲的闭环。"),
    T("guest", "一个大脑、一套工具、一层记忆、一个循环。好处是链路短、好调试、成本可控。适合目标单一、工具不超过一桌子的任务。"),
    T("host", "Multi 的两种方案呢？"),
    T("guest", "中心化：一个 Orchestrator 分配任务、收集结果，可控、可追踪，出了问题顺着调度链路查。去中心化：Agent 之间自己协商。听起来灵活，但任务分配没协调、执行顺序没保证、失败没有统一感知，生产里几乎不可用。工程上几乎都选 Orchestrator。"),
    T("host", "三个雷：复杂就上 Multi；不提中心化去中心化；觉得去中心化更高级。把三类场景和为什么选中心化说清，这题就稳。下一集讲记忆压缩的四种方法。我是林林，下集见。"),
])

ep(12, "Agent 记忆压缩通常有哪些方法？", [
    T("host", "第十二集，记忆压缩。只说做了滑动窗口，面试官会怎么追？"),
    T("guest", "他会说：用户三天前否决的方案被你窗口丢掉了，Agent 又把它提回来，怎么办？你把窗口调大，只是治标。滑动窗口的本质缺陷是硬截断，按时间切，不管信息重不重要。"),
    T("host", "那摘要压缩呢？让 LLM 把历史总结一下。"),
    T("guest", "这是第二种，丢之前先提炼。能留住主线，但细节会丢：精确数字、约束条件、用户原话，摘要里经常没了。所以它也不是万能。"),
    T("host", "还有两种？"),
    T("guest", "第三，重要性过滤。不按时间，按价值挑：用户明确的偏好、关键决策、未完成的约束，优先留。第四，结构化抽取。别把一切都当对话文本存，把事实抽成字段、图谱、键值，信息密度高得多。"),
    T("host", "四种方法是替代关系吗？"),
    T("guest", "互补。窗口和摘要解决历史太长怎么截；重要性过滤解决内容不等价怎么挑；结构化抽取解决对话文本是不是最佳载体。生产里经常组合：近期原文，中期摘要，长期结构化事实。"),
    T("host", "Prompt Caching 算压缩吗？"),
    T("guest", "不算同一层。它是计算层优化，对已经决定带进上下文的内容减少重复计算。和信息层的压缩是互补，不是替代。能主动点出这个区别，很加分。"),
    T("host", "下一集是个很工程的题：为什么有时候手搓 Agent，不用成熟框架。我是林林，下集见。"),
])

ep(13, "在工程实践中，为什么有时候选择手搓 Agent，而不是直接用成熟框架？", [
    T("host", "第十三集。开口就说我用 LangChain，功能全、上手快。面试官可能不太买账。"),
    T("guest", "框架的价值是真的，POC 阶段省时省力，别一上来否定框架。痛点是阶段变了才出现的。"),
    T("host", "什么时候开始疼？"),
    T("guest", "上线以后要排 bug。抽象层一多，stack trace 四五十层，定位慢。版本升级还有 breaking change。通用性设计会带隐性性能开销，你用不到的链路也在转。可观测性如果只停留在框架封装内部，出了问题你看不清模型到底输出了什么、工具到底失败在哪。"),
    T("host", "手搓的本质优势是？"),
    T("guest", "完全掌控。循环怎么转、状态怎么存、日志打到哪一步，都是你的代码。可观测性好，不受外部升级牵制，性能可以按自己的路径裁剪。同一个 ReAct loop，框架一行 executor，手搓就是显式的 thought、action、observation 循环，出了问题你知道在哪一圈。"),
    T("host", "所以是框架和手搓二选一？"),
    T("guest", "不是。最常见也最务实的是折中：核心循环和状态机手写，周边的模型接入、工具 schema、评测借用生态。框架不是问题，不理解就依赖才是。"),
    T("host", "答这题记得：先承认框架价值，再谈三个具体痛点，再说手搓的掌控，最后给折中方案。下一集：怎么赋予 LLM 规划能力。我是林林，下集见。"),
])

ep(14, "如何赋予 LLM 规划能力？", [
    T("host", "第十四集。有人说规划能力就是 CoT，prompt 里加一句请一步步思考就完了。差在哪？"),
    T("guest", "CoT 只是最基础的一种手段，不是规划能力的全部。LLM 默认一口气生成，多步任务容易跳步。规划是把隐式推理显式化。CoT 最大的问题不是费 token，而是单条推理链，一开始方向错了，后面全错，没有纠偏。"),
    T("host", "ToT 怎么补？"),
    T("guest", "Tree of Thoughts。不是最后再选一条最好的，而是边探索、边评估、边剪枝。从一条链变成一棵树，走错的方向可以被砍掉。代价是调用次数明显上升，典型是 CoT 的三到五倍，看路径数和深度。"),
    T("host", "GoT 呢？"),
    T("guest", "Graph of Thoughts。树还是有限制：不同分支的中间结论不好复用。图允许节点之间共享子结论。目前更多还在学术阶段，生产落地不成熟，面试里别吹成你线上在用。"),
    T("host", "演进关系怎么记？"),
    T("guest", "CoT 解决要不要把推理写出来；ToT 解决走错了怎么纠偏；GoT 解决不同路径的中间结论能不能复用。工程里真正常用的，反而是 Plan-and-Execute：先产出计划再逐步执行，成本和可控性更平衡。"),
    T("host", "把成本和适用场景说清楚，比只讲原理加分。下一集讲反思机制。我是林林，下集见。"),
])

ep(15, "讲讲 Agent 的反思机制？为什么要用反思？具体怎么实现？", [
    T("host", "第十五集，反思。把反思说成输出不满意就再生成一次，错在哪？"),
    T("guest", "再生成是随机重试。反思是有结构的闭环：生成、评估、改进。缺任何一环都会失效。"),
    T("host", "评估为什么不能只说你看看有没有问题？"),
    T("guest", "模型往往会说看起来不错，什么都发现不了。评估 prompt 要给出明确检查维度，比如逻辑、完整性、事实准确性。还必须有 PASS 出口，否则它会无限挑毛病，死循环。"),
    T("host", "两个 prompt 怎么分工？"),
    T("guest", "评估 prompt 专门找问题，产出批注；改进 prompt 结合原始任务和批注做定向修改。不要让同一个提示既当裁判又当作者，容易自洽，改不动。"),
    T("host", "粒度呢？"),
    T("guest", "步骤级：每一步都评，错误发现得早，开销大。任务级：整段做完再评，能看到整体问题，但前面的无效工作可能已经发生了。按任务选。多 Agent 互评往往比自我检查更狠，因为同一模型对自己的输出有自洽偏见。"),
    T("host", "工程上怎么防跑飞？"),
    T("guest", "硬性最大轮次，通常两到三轮，不能指望模型自己停。输出要求高、错误代价大的环节再上反思，别每个小步骤都套三轮。进阶可以提 Reflexion，把反思写入长期记忆，变成跨任务的错题本。"),
    T("host", "最后一集我们把多 Agent 的协作和动态切换收完。我是林林，下集见。"),
])

ep(16, "如何设计多 Agent 的协作与动态切换机制？", [
    T("host", "第十六集，也是这一季最后一集。多 Agent 怎么协作、怎么切换。只说流水线传结果，太表面。"),
    T("guest", "协作先分清两种通信。消息传递：发送方不需要知道谁在接收，核心是解耦，适合相对独立的 Agent。共享状态：大家读写同一个对象，前一步写下一步读，LangGraph 就是这个思路，适合依赖明确的流水线。选哪个，看依赖强不强。"),
    T("host", "共享状态要注意什么？"),
    T("guest", "谁可以写哪些字段、并发怎么冲突、要不要版本。没有约定就会互相覆盖。状态该尽量小、结构化，别把整段对话当全局变量扔进去。"),
    T("host", "切换呢？有人说每次都让 LLM 判断下一步叫谁。"),
    T("guest", "那叫动态路由，灵活，但每次多一次 LLM 调用，行为不可预测。静态路由是你写死：分析完一定交给写手，稳定可预测，但覆盖不了没预料到的边角。"),
    T("host", "所以工程上怎么用？"),
    T("guest", "混合。主流程静态路由保底，边缘情况才交给 LLM 动态决策。还有 Handoff：当前 Agent 主动交棒，把必要上下文一并转交，而不是只丢一句你来吧。这才像团队交接。"),
    T("host", "收官把这一季串一下？"),
    T("guest", "Agent 的本质是自主闭环；四个组件缺一不可；Tools、Agent、Workflow 看谁做决策；生产里偏 Agentic Workflow；ReAct 的循环由代码驱动；记忆要分层、压缩要多手段；Multi-Agent 为窗口和专业度而生，协作和切换都要有保底策略。面试里把机制和取舍讲清楚，比背名词重要得多。"),
    T("host", "《Agent 面试课》十六集到这里全部结束。讲稿和原文都在 App 里，可以边听边对照。我是林林，感谢收听，面试顺利。"),
    T("guest", "我是周老师，再见。"),
])


def load_api_key() -> str:
    if not ENV_FILE.exists():
        sys.exit("缺少 .env（FISH_KEY=...）")
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() in ("FISH_KEY", "FISH_API_KEY"):
            return v.strip().strip('"').strip("'")
    sys.exit(".env 里没有 FISH_KEY")


def turns_to_tagged(turns: list[dict]) -> str:
    parts = []
    for t in turns:
        idx = 0 if t["s"] == "host" else 1
        parts.append(f"<|speaker:{idx}|>{t['t']}")
    return "".join(parts)


def split_chunks(turns: list[dict], limit: int = CHUNK_CHARS) -> list[str]:
    chunks: list[str] = []
    buf: list[dict] = []
    size = 0
    for t in turns:
        n = len(t["t"]) + 20
        if buf and size + n > limit:
            chunks.append(turns_to_tagged(buf))
            buf, size = [], 0
        buf.append(t)
        size += n
    if buf:
        chunks.append(turns_to_tagged(buf))
    return chunks


def dump_podcasts_json() -> None:
    decks = {
        str(n): {
            "title": EPISODES[n]["title"],
            "audio": EPISODES[n]["audio"],
            "turns": EPISODES[n]["turns"],
        }
        for n in sorted(EPISODES)
    }
    payload = {
        "version": 1,
        "series": SERIES,
        "speakers": {
            "host": {"name": HOST_NAME, "role": "主理人"},
            "guest": {"name": GUEST_NAME, "role": "面试官"},
        },
        "voices": {"host": HOST_VOICE, "guest": GUEST_VOICE},
        "decks": {"agent": decks},
    }
    out = ROOT / "podcasts.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}  ({out.stat().st_size} bytes, {len(decks)} episodes)", flush=True)


def tts_one(client, key: str, text: str, dest: Path) -> None:
    import httpx

    body = {
        "text": text,
        "reference_id": [HOST_VOICE, GUEST_VOICE],
        "format": "mp3",
        "mp3_bitrate": 64,
        "sample_rate": 44100,
        "latency": "normal",
        "normalize": True,
        "chunk_length": 300,
    }
    last_err = None
    for attempt in range(4):
        try:
            print(f"    POST tts attempt {attempt + 1} ({len(text)} chars) ...", flush=True)
            res = client.post(
                TTS_URL,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "model": TTS_MODEL,
                },
                json=body,
                timeout=180.0,
            )
            if res.status_code == 429:
                wait = 8 * (attempt + 1)
                print(f"    429, wait {wait}s", flush=True)
                time.sleep(wait)
                continue
            if res.status_code >= 400:
                raise RuntimeError(f"HTTP {res.status_code}: {res.text[:400]}")
            ctype = res.headers.get("content-type", "")
            looks_mp3 = res.content.startswith(b"ID3") or res.content[:2] == b"\xff\xfb" or res.content[:2] == b"\xff\xf3"
            if len(res.content) < 2000 or ("audio" not in ctype and not looks_mp3):
                raise RuntimeError(f"not audio: {ctype} {len(res.content)} bytes {res.content[:80]!r}")
            dest.write_bytes(res.content)
            return
        except Exception as e:
            last_err = e
            wait = 4 * (attempt + 1)
            print(f"    retry {attempt + 1}: {e}  wait {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(last_err)


def concat_mp3(parts: list[Path], dest: Path) -> None:
    lst = dest.with_suffix(".concat.txt")
    lst.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
        "-c:a", "libmp3lame", "-b:a", "64k", str(dest),
    ]
    try:
        subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        lst.unlink(missing_ok=True)


def generate_audio(only: set[int] | None, force: bool = False) -> None:
    import httpx

    key = load_api_key()
    audio_dir = ROOT / "audio" / "agent"
    audio_dir.mkdir(parents=True, exist_ok=True)
    nums = sorted(EPISODES)
    if only:
        nums = [n for n in nums if n in only]

    with httpx.Client() as client:
        for n in nums:
            ep_ = EPISODES[n]
            dest = ROOT / ep_["audio"]
            if not force and dest.exists() and dest.stat().st_size > 10_000:
                print(f"skip {dest.name} (exists, {dest.stat().st_size} bytes)", flush=True)
                continue
            chunks = split_chunks(ep_["turns"])
            chars = sum(len(t["t"]) for t in ep_["turns"])
            print(f"ep {n:02d}  chars={chars}  chunks={len(chunks)}  -> {dest.name}", flush=True)
            with tempfile.TemporaryDirectory() as td:
                td_path = Path(td)
                parts = []
                for i, chunk in enumerate(chunks, 1):
                    part = td_path / f"{i:02d}.mp3"
                    print(f"  chunk {i}/{len(chunks)}  {len(chunk)} chars", flush=True)
                    t0 = time.time()
                    tts_one(client, key, chunk, part)
                    print(f"    {part.stat().st_size} bytes in {time.time() - t0:.1f}s", flush=True)
                    parts.append(part)
                if len(parts) == 1:
                    dest.write_bytes(parts[0].read_bytes())
                else:
                    concat_mp3(parts, dest)
            print(f"  saved {dest} ({dest.stat().st_size} bytes)", flush=True)
            time.sleep(1.2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated episode numbers")
    parser.add_argument("--json-only", action="store_true")
    parser.add_argument("--force", action="store_true", help="overwrite existing mp3s")
    parser.add_argument("--host-voice", default="", help="Fish Audio model id for 林林")
    parser.add_argument("--guest-voice", default="", help="Fish Audio model id for 周老师")
    args = parser.parse_args()
    global HOST_VOICE, GUEST_VOICE
    if args.host_voice:
        HOST_VOICE = args.host_voice.strip()
    if args.guest_voice:
        GUEST_VOICE = args.guest_voice.strip()
    dump_podcasts_json()
    if args.json_only:
        return
    only = {int(x) for x in args.only.split(",") if x.strip()} if args.only else None
    generate_audio(only, force=args.force)


if __name__ == "__main__":
    main()
