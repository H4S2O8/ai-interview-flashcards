import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import { countDue, dueCards, openDB } from "./db"

// widget 跑在独立的扩展进程里，数据库放在 App Group 目录下才读得到。
// 这里不做 seed —— 首次导入交给主 App，widget 只读不写。
await openDB()

const due = await countDue()
const next = due > 0 ? (await dueCards(1))[0] : null
const isSmall = Widget.family === "small"

function WidgetView() {
  if (due === 0) {
    return (
      <VStack spacing={4} padding={12}>
        <Text font="title2">✓</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">今天复习完了</Text>
      </VStack>
    )
  }

  return (
    <VStack spacing={6} padding={12} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <HStack>
        <Text font="caption2" foregroundStyle="secondaryLabel">AI 与算法闪卡</Text>
        <Spacer />
      </HStack>

      <HStack alignment="firstTextBaseline" spacing={4}>
        <Text font="largeTitle" fontWeight="bold">{due}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">张待复习</Text>
      </HStack>

      {!isSmall && next != null ? (
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={3}>
          {next.front}
        </Text>
      ) : null}

      <Spacer />
    </VStack>
  )
}

Widget.present(<WidgetView />)
