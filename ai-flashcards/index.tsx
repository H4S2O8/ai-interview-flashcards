import {
  Button, HStack, Label, List, Navigation, NavigationLink, NavigationStack,
  Notification, ProgressView, RoundedRectangle, Script, ScrollView, Section, Spacer, Tab, TabView, Text,
  VStack, ZStack,
  useEffect, useMemo, useObservable, useState,
} from "scripting"

import { cardsOfDeck, countDue, dueCards, gradeCard, listDecks, openDB, resetProgress, seedIfNeeded, seedVersion, stats, type Card, type Deck, type Stats } from "./db"
import { GRADE_LABELS, previewInterval, type Grade } from "./srs"

const SESSION_LIMIT = 40
const REMINDER_HOUR = 20

// ------------------------------------------------------------- 复习

const GRADE_COLORS = ["systemRed", "systemOrange", "systemBlue", "systemGreen"] as const

/** 横向拖动超过这个距离（点）就判定为一次滑动评分 */
const SWIPE_THRESHOLD = 110
/** 松手后卡片飞出屏幕的距离 */
const FLY_DISTANCE = 900
/** 飞出动画时长，到时才真正换下一张 */
const FLY_MS = 210
const SWIPE_LEFT_GRADE: Grade = 0
const SWIPE_RIGHT_GRADE: Grade = 2

/** idle 正常 / flying 飞出中 / entering 新卡入场前的一帧 */
type Phase = "idle" | "flying" | "entering"

/** 右下角的版本角标：脚本版本取自 script.json，题库版本取自已导入的 cards.json */
function VersionBadge() {
  const [seed, setSeed] = useState<number | null>(null)
  useEffect(() => { seedVersion().then(setSeed) }, [])

  const app = Script.metadata?.version ?? "?"
  return (
    <HStack padding={{ horizontal: 18, bottom: 4 }}>
      <Spacer />
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        v{app}{seed != null ? ` · 题库 v${seed}` : ""}
      </Text>
    </HStack>
  )
}

function ReviewTab() {
  const [queue, setQueue] = useState<Card[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(0)
  const [phase, setPhase] = useState<Phase>("idle")

  // 拖动位移用 observable：拖动中每帧都在变，走绑定通道比每帧重渲染更跟手
  const dragX = useObservable(0)
  // 只在「松手 / 换卡 / 翻面」时 +1。动画绑在它身上，
  // 所以拖动过程本身不带动画（卡片严格跟手），松手才有弹性回弹。
  const [tick, setTick] = useState(0)
  const animate = () => setTick(t => t + 1)

  async function load() {
    setQueue(await dueCards(SESSION_LIMIT))
    setIndex(0)
    setRevealed(false)
    setDone(0)
    dragX.setValue(0)
    setPhase("idle")
  }

  useEffect(() => { load() }, [])

  /** 飞出 -> 记分 -> 新卡淡入，三段接起来 */
  function commit(g: Grade, direction: number) {
    const card = queue?.[index]
    if (card == null || phase !== "idle") return

    dragX.setValue(direction * FLY_DISTANCE)
    setPhase("flying")
    animate()

    setTimeout(async () => {
      await gradeCard(card, g)
      dragX.setValue(0)          // 此时卡片已透明，位移归零看不见
      setDone(d => d + 1)
      setRevealed(false)
      setIndex(i => i + 1)
      setPhase("entering")
      setTimeout(() => { setPhase("idle"); animate() }, 20)
    }, FLY_MS)
  }

  function grade(g: Grade) {
    commit(g, g === SWIPE_LEFT_GRADE ? -1 : 1)
  }

  function onDragEnded(predictedX: number) {
    if (!revealed) {
      // 答案未显示时，滑动只当翻面
      dragX.setValue(0)
      if (Math.abs(predictedX) > SWIPE_THRESHOLD) setRevealed(true)
      animate()
      return
    }
    if (predictedX <= -SWIPE_THRESHOLD) commit(SWIPE_LEFT_GRADE, -1)
    else if (predictedX >= SWIPE_THRESHOLD) commit(SWIPE_RIGHT_GRADE, 1)
    else { dragX.setValue(0); animate() }
  }

  if (queue == null) {
    return (
      <VStack navigationTitle="今日复习" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <Text foregroundStyle="secondaryLabel">载入中…</Text>
      </VStack>
    )
  }

  const card = queue[index]

  if (card == null) {
    return (
      <VStack navigationTitle="今日复习" spacing={14} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <Spacer />
        <Text font="largeTitle">{done > 0 ? "🎉" : "☕️"}</Text>
        <Text font="title3" fontWeight="semibold">
          {done > 0 ? `这一轮复习完了，共 ${done} 张` : "今天没有到期的卡片"}
        </Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          到期的卡片会自动排进队列，明天再来
        </Text>
        <Button title="再查一次" systemImage="arrow.clockwise" action={load}
          buttonStyle="bordered" buttonBorderShape="capsule" controlSize="large" />
        <Spacer />
        <VersionBadge />
      </VStack>
    )
  }

  const total = queue.length
  const remaining = total - index
  const offset = dragX.value
  const progress = total === 0 ? 0 : index / total

  // 滑动进度 0~1，用来驱动印章的浓淡
  const swipeRatio = Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1)
  const swipingRight = offset > 0
  const stampGrade = swipingRight ? SWIPE_RIGHT_GRADE : SWIPE_LEFT_GRADE
  const showStamp = phase === "idle" && revealed && Math.abs(offset) > 12

  const cardOpacity = phase === "idle" ? 1 : 0
  const animValue = `${phase}:${tick}`

  return (
    <VStack navigationTitle="今日复习" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>

      {/* ── 顶部：题号 + 进度 ─────────────────────────── */}
      <HStack padding={{ horizontal: 20, top: 6 }}>
        <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel">
          第 {card.qno} 题
        </Text>
        <Spacer />
        <Text font="caption" foregroundStyle="tertiaryLabel">
          剩 {remaining} · 已复习 {done}
        </Text>
      </HStack>

      {/* 细进度条 */}
      <ProgressView
        progressViewStyle="linear"
        value={progress}
        total={1}
        padding={{ horizontal: 20, top: 8 }}
      />

      {/* ── 卡片区 ───────────────────────────────────── */}
      <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ top: 14, bottom: 6 }}>

        {/* 背后的牌堆，暗示还有多少张 */}
        {remaining > 2 ? (
          <RoundedRectangle cornerRadius={26} fill="quaternarySystemFill"
            padding={{ horizontal: 38, top: 26, bottom: 14 }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
        ) : null}
        {remaining > 1 ? (
          <RoundedRectangle cornerRadius={26} fill="tertiarySystemFill"
            padding={{ horizontal: 28, top: 14, bottom: 14 }}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
        ) : null}

        {/* 正面这张 */}
        <VStack
          spacing={0}
          padding={{ horizontal: 18 }}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          background={
            <RoundedRectangle cornerRadius={26} fill="secondarySystemGroupedBackground"
              stroke={{ shapeStyle: "separator", strokeStyle: { lineWidth: 0.5 } }} />
          }
          shadow={{ color: "rgba(0,0,0,0.16)", radius: 16, x: 0, y: 6 }}
          offset={{ x: offset, y: Math.abs(offset) * 0.05 }}
          rotationEffect={offset / 24}
          opacity={cardOpacity}
          animation={{ animation: Animation.spring({ duration: 0.3, bounce: 0.16 }), value: animValue }}
          onDragGesture={{
            minDistance: 10,
            onChanged: d => { if (phase === "idle") dragX.setValue(d.translation.width) },
            onEnded: d => onDragEnded(d.predictedEndTranslation.width),
          }}
          overlay={
            showStamp ? {
              // 用 alignment 定位而不是硬编码坐标，才能适配不同屏宽
              alignment: swipingRight ? "topLeading" : "topTrailing",
              content: (
                // 外层只负责离卡片边缘的距离，内层才是印章本身的内边距
                <HStack padding={{ horizontal: 26, top: 26 }}>
                  <HStack
                    padding={{ horizontal: 14, vertical: 6 }}
                    background={
                      <RoundedRectangle cornerRadius={10} fill={{ color: GRADE_COLORS[stampGrade], opacity: 0.14 }}
                        stroke={{ shapeStyle: GRADE_COLORS[stampGrade], strokeStyle: { lineWidth: 2.5 } }} />
                    }
                    rotationEffect={swipingRight ? -14 : 14}
                    opacity={swipeRatio}
                  >
                    <Text font="headline" fontWeight="heavy" foregroundStyle={GRADE_COLORS[stampGrade]}>
                      {GRADE_LABELS[stampGrade]}
                    </Text>
                  </HStack>
                </HStack>
              )
            } : undefined
          }
        >
          <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <VStack spacing={16} padding={{ horizontal: 22, vertical: 26 }} alignment="leading">

              <Text font="caption2" fontWeight="semibold" foregroundStyle="accentColor"
                padding={{ horizontal: 9, vertical: 4 }}
                background={<RoundedRectangle cornerRadius={7} fill={{ color: "accentColor", opacity: 0.12 }} />}>
                Q{card.qno}
              </Text>

              <Text font="title3" fontWeight="semibold">{card.front}</Text>

              {revealed ? (
                <VStack spacing={12} alignment="leading" padding={{ top: 2 }}>
                  <RoundedRectangle cornerRadius={1} fill="separator"
                    frame={{ maxWidth: "infinity", height: 1 }} />
                  <Text font="caption2" fontWeight="semibold" foregroundStyle="tertiaryLabel">答案</Text>
                  <Text font="body">{card.back}</Text>
                </VStack>
              ) : (
                <Text font="footnote" foregroundStyle="tertiaryLabel" padding={{ top: 4 }}>
                  先在心里答一遍，再点下面显示答案
                </Text>
              )}
            </VStack>
          </ScrollView>
        </VStack>
      </ZStack>

      {/* ── 底部操作区 ───────────────────────────────── */}
      {revealed ? (
        <VStack spacing={8} padding={{ horizontal: 14, bottom: 6 }}>
          <HStack spacing={7}>
            {GRADE_LABELS.map((label, g) => (
              <Button
                action={() => grade(g as Grade)}
                buttonStyle="bordered"
                buttonBorderShape={{ roundedRectangleRadius: 13 }}
                controlSize="large"
                frame={{ maxWidth: "infinity" }}
                tint={GRADE_COLORS[g]}
              >
                <VStack spacing={1}>
                  <Text font="subheadline" fontWeight="semibold">{label}</Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {previewInterval(card, g as Grade, Date.now())}
                  </Text>
                </VStack>
              </Button>
            ))}
          </HStack>
          <HStack spacing={5}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">← 左滑 忘了</Text>
            <Spacer />
            <Text font="caption2" foregroundStyle="tertiaryLabel">右滑 良好 →</Text>
          </HStack>
        </VStack>
      ) : (
        <VStack padding={{ horizontal: 14, bottom: 6 }}>
          <Button
            title="显示答案"
            systemImage="eye"
            action={() => { setRevealed(true); animate() }}
            buttonStyle="borderedProminent"
            buttonBorderShape={{ roundedRectangleRadius: 13 }}
            controlSize="large"
            frame={{ maxWidth: "infinity" }}
          />
        </VStack>
      )}

      <VersionBadge />
    </VStack>
  )
}

// ------------------------------------------------------------- 题库浏览

function CardDetail({ card }: { card: Card }) {
  return (
    <ScrollView navigationTitle={`第 ${card.qno} 题`} navigationBarTitleDisplayMode="inline">
      <VStack spacing={16} padding={20} alignment="leading">
        <Text font="headline">{card.front}</Text>
        <Text font="body">{card.back}</Text>
        <Text font="caption" foregroundStyle="tertiaryLabel">
          {card.reps === 0
            ? "还没复习过"
            : `已复习 ${card.reps} 次 · 间隔 ${card.interval} 天 · 难度系数 ${card.ease.toFixed(2)}`}
        </Text>
      </VStack>
    </ScrollView>
  )
}

function DeckDetail({ deck }: { deck: Deck }) {
  const [cards, setCards] = useState<Card[]>([])
  useEffect(() => { cardsOfDeck(deck.id).then(setCards) }, [deck.id])

  // 按原题号分组，浏览时能看出每道题拆出了哪些卡
  const groups = useMemo(() => {
    const m = new Map<number, Card[]>()
    for (const c of cards) {
      const g = m.get(c.qno)
      if (g == null) m.set(c.qno, [c]); else g.push(c)
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0])
  }, [cards])

  return (
    <List navigationTitle={deck.name} navigationBarTitleDisplayMode="inline">
      {groups.map(([qno, group]) => (
        <Section header={<Text>第 {qno} 题 · {group.length} 张</Text>}>
          {group.map(card => (
            <NavigationLink destination={<CardDetail card={card} />}>
              <VStack alignment="leading" spacing={2}>
                <Text lineLimit={2}>{card.front}</Text>
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  {card.reps === 0 ? "未学" : `间隔 ${card.interval} 天`}
                </Text>
              </VStack>
            </NavigationLink>
          ))}
        </Section>
      ))}
    </List>
  )
}

function BrowseTab() {
  const [decks, setDecks] = useState<Deck[]>([])
  useEffect(() => { listDecks().then(setDecks) }, [])

  return (
    <NavigationStack>
      <List navigationTitle="题库">
        {decks.map(deck => (
          <NavigationLink destination={<DeckDetail deck={deck} />}>
            <Label title={deck.name} systemImage={deck.icon} />
          </NavigationLink>
        ))}
      </List>
    </NavigationStack>
  )
}

// ------------------------------------------------------------- 统计与设置

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack>
      <Text>{label}</Text>
      <Spacer />
      <Text foregroundStyle="secondaryLabel">{value}</Text>
    </HStack>
  )
}

function StatsTab() {
  const [s, setS] = useState<Stats | null>(null)
  const [message, setMessage] = useState("")

  async function refresh() { setS(await stats()) }
  useEffect(() => { refresh() }, [])

  async function enableReminder() {
    await Notification.removeAllPendingsOfCurrentScript()
    await Notification.schedule({
      title: "该复习闪卡了",
      body: "打开看看今天到期了几张",
      trigger: new CalendarNotificationTrigger({
        dateMatching: new DateComponents({ hour: REMINDER_HOUR, minute: 0 }),
        repeats: true,
      }),
    })
    setMessage(`已开启每天 ${REMINDER_HOUR}:00 提醒`)
  }

  async function disableReminder() {
    await Notification.removeAllPendingsOfCurrentScript()
    setMessage("已关闭每日提醒")
  }

  async function reimport() {
    const r = await seedIfNeeded(true)
    await refresh()
    setMessage(`已重新导入 ${r.imported} 张卡片（复习进度保留）`)
  }

  async function reset() {
    await resetProgress()
    await refresh()
    setMessage("复习进度已清空")
  }

  return (
    <NavigationStack>
      <List navigationTitle="统计">
        <Section header={<Text>进度</Text>}>
          <StatRow label="卡片总数" value={s ? `${s.total}` : "—"} />
          <StatRow label="今日待复习" value={s ? `${s.due}` : "—"} />
          <StatRow label="今日已复习" value={s ? `${s.reviewedToday}` : "—"} />
          <StatRow label="连续天数" value={s ? `${s.streakDays}` : "—"} />
        </Section>

        <Section header={<Text>掌握程度</Text>}>
          <StatRow label="未学" value={s ? `${s.fresh}` : "—"} />
          <StatRow label="学习中（间隔 < 21 天）" value={s ? `${s.learning}` : "—"} />
          <StatRow label="已掌握（间隔 ≥ 21 天）" value={s ? `${s.mature}` : "—"} />
        </Section>

        <Section header={<Text>每日提醒</Text>}>
          <Button title={`每天 ${REMINDER_HOUR}:00 提醒我`} systemImage="bell" action={enableReminder} />
          <Button title="关闭提醒" systemImage="bell.slash" action={disableReminder} />
        </Section>

        <Section
          header={<Text>维护</Text>}
          footer={message ? <Text foregroundStyle="secondaryLabel">{message}</Text> : undefined}
        >
          <Button title="重新导入卡片" systemImage="arrow.down.doc" action={reimport} />
          <Button title="清空复习进度" systemImage="trash" role="destructive" action={reset} />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ------------------------------------------------------------- 入口

function Root() {
  const selection = useObservable(0)
  const [dueBadge, setDueBadge] = useState(0)
  useEffect(() => { countDue().then(setDueBadge) }, [])

  return (
    <TabView selection={selection}>
      <Tab title="复习" systemImage="rectangle.on.rectangle.angled" value={0} badge={dueBadge > 0 ? dueBadge : undefined}>
        <NavigationStack><ReviewTab /></NavigationStack>
      </Tab>
      <Tab title="题库" systemImage="books.vertical" value={1}>
        <BrowseTab />
      </Tab>
      <Tab title="统计" systemImage="chart.bar" value={2}>
        <StatsTab />
      </Tab>
    </TabView>
  )
}

async function main() {
  await openDB()
  await seedIfNeeded()
  await Navigation.present({ element: <Root /> })
  // 必须显式退出，否则脚本实例不会释放
  Script.exit()
}

main()
