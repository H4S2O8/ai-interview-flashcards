import {
  Button, HStack, Label, List, Navigation, NavigationLink, NavigationStack,
  Notification, Script, ScrollView, Section, Spacer, Tab, TabView, Text, VStack, ZStack,
  useEffect, useMemo, useObservable, useState,
} from "scripting"

import { cardsOfDeck, countDue, dueCards, gradeCard, listDecks, openDB, resetProgress, seedIfNeeded, seedVersion, stats, type Card, type Deck, type Stats } from "./db"
import { GRADE_LABELS, previewInterval, type Grade } from "./srs"

const SESSION_LIMIT = 40
const REMINDER_HOUR = 20

// ------------------------------------------------------------- 复习

const GRADE_COLORS = ["systemRed", "systemOrange", "systemBlue", "systemGreen"] as const

/** 横向拖动超过这个距离（点）就判定为一次滑动评分 */
const SWIPE_THRESHOLD = 100
/** 左滑给「忘了」，右滑给「良好」——上下滑没有绑定，见下方注释 */
const SWIPE_LEFT_GRADE: Grade = 0
const SWIPE_RIGHT_GRADE: Grade = 2

/** 右下角的版本角标：脚本版本取自 script.json，题库版本取自已导入的 cards.json */
function VersionBadge() {
  const [seed, setSeed] = useState<number | null>(null)
  useEffect(() => { seedVersion().then(setSeed) }, [])

  const app = Script.metadata?.version ?? "?"
  return (
    <HStack padding={{ horizontal: 16, bottom: 4 }}>
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

  // 拖动位移用 observable 而不是 useState：拖动过程中每帧都在变，
  // 走 observable 的绑定通道比每帧触发一次组件重渲染更稳。
  const dragX = useObservable(0)

  async function load() {
    setQueue(await dueCards(SESSION_LIMIT))
    setIndex(0)
    setRevealed(false)
    setDone(0)
    dragX.setValue(0)
  }

  useEffect(() => { load() }, [])

  async function grade(g: Grade) {
    const card = queue?.[index]
    if (card == null) return
    // 先把卡片弹回原位，否则下一张会带着上一张的位移出场
    dragX.setValue(0)
    await gradeCard(card, g)
    setDone(done + 1)
    setRevealed(false)
    setIndex(index + 1)
  }

  if (queue == null) {
    return <VStack navigationTitle="今日复习"><Text foregroundStyle="secondaryLabel">载入中…</Text></VStack>
  }

  const card = queue[index]

  if (card == null) {
    return (
      <VStack
        navigationTitle="今日复习"
        spacing={16}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      >
        <Text font="largeTitle">🎉</Text>
        <Text font="title3">
          {done > 0 ? `这一轮复习完了，共 ${done} 张` : "今天没有到期的卡片"}
        </Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          到期的卡片会自动排进队列，明天再来
        </Text>
        <Button title="再查一次" systemImage="arrow.clockwise" action={load} buttonStyle="bordered" />
        <Spacer />
        <VersionBadge />
      </VStack>
    )
  }

  const remaining = queue.length - index
  const offset = dragX.value
  // 拖过阈值时提示这一松手会打哪一档
  const armed: Grade | null =
    offset <= -SWIPE_THRESHOLD ? SWIPE_LEFT_GRADE
      : offset >= SWIPE_THRESHOLD ? SWIPE_RIGHT_GRADE
      : null

  function onDragEnded(predictedX: number) {
    if (!revealed) {
      // 答案还没显示，滑动只当作「翻面」，不评分
      dragX.setValue(0)
      if (Math.abs(predictedX) > SWIPE_THRESHOLD) setRevealed(true)
      return
    }
    if (predictedX <= -SWIPE_THRESHOLD) grade(SWIPE_LEFT_GRADE)
    else if (predictedX >= SWIPE_THRESHOLD) grade(SWIPE_RIGHT_GRADE)
    else dragX.setValue(0)
  }

  return (
    <VStack navigationTitle="今日复习" spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <HStack padding={{ horizontal: 20, top: 8, bottom: 4 }}>
        <Text font="caption" foregroundStyle="secondaryLabel">第 {card.qno} 题</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">剩 {remaining} 张 · 已复习 {done}</Text>
      </HStack>

      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        offset={{ x: offset, y: 0 }}
        rotationEffect={offset / 30}
        opacity={1 - Math.min(Math.abs(offset) / 600, 0.3)}
        animation={{ animation: Animation.spring({ duration: 0.25, bounce: 0.15 }), value: offset }}
        onDragGesture={{
          minDistance: 12,
          onChanged: d => dragX.setValue(d.translation.width),
          onEnded: d => onDragEnded(d.predictedEndTranslation.width),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
          <VStack spacing={20} padding={20} alignment="leading">
            <Text font="title3" fontWeight="semibold">{card.front}</Text>

            {revealed ? (
              <VStack spacing={12} alignment="leading">
                <Text font="caption" foregroundStyle="tertiaryLabel">答案</Text>
                <Text font="body">{card.back}</Text>
              </VStack>
            ) : (
              <Text font="footnote" foregroundStyle="tertiaryLabel">
                先自己在心里答一遍，再点下面显示答案（左右滑动也可翻面）
              </Text>
            )}
          </VStack>
        </ScrollView>

        {armed != null ? (
          <Text
            font="title2"
            fontWeight="bold"
            foregroundStyle={GRADE_COLORS[armed]}
            padding={12}
          >
            {armed === SWIPE_LEFT_GRADE ? "← 忘了" : "良好 →"}
          </Text>
        ) : null}
      </ZStack>

      {revealed ? (
        <VStack spacing={6} padding={{ horizontal: 12, bottom: 10 }}>
          <HStack spacing={8}>
            {GRADE_LABELS.map((label, g) => (
              <Button
                action={() => grade(g as Grade)}
                buttonStyle="bordered"
                controlSize="large"
                frame={{ maxWidth: "infinity" }}
                tint={GRADE_COLORS[g]}
              >
                <VStack spacing={2}>
                  <Text font="subheadline" fontWeight="medium">{label}</Text>
                  <Text font="caption2" foregroundStyle="secondaryLabel">
                    {previewInterval(card, g as Grade, Date.now())}
                  </Text>
                </VStack>
              </Button>
            ))}
          </HStack>
          <Text font="caption2" foregroundStyle="tertiaryLabel">左滑 = 忘了 · 右滑 = 良好 · 困难/简单用按钮</Text>
        </VStack>
      ) : (
        <Button
          title="显示答案"
          action={() => setRevealed(true)}
          buttonStyle="borderedProminent"
          controlSize="large"
          padding={{ horizontal: 12, vertical: 10 }}
          frame={{ maxWidth: "infinity" }}
        />
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
