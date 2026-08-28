import {
  Animation, Button, HStack, ProgressView, RoundedRectangle, ScrollView,
  Spacer, Text, VStack, ZStack, useObservable,
} from "scripting"

/**
 * 诊断页：每个编号只测一种写法，隔离验证。
 * 用法：看哪几号「画出了灰/蓝色块」，把编号报回来。
 * 只出现数字和说明文字、没有色块 = 该写法在本机不生效。
 */

function Row({ n, label, children }: { n: number; label: string; children?: any }) {
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font="caption" fontWeight="bold">{n}. {label}</Text>
      {children}
    </VStack>
  )
}

export function DiagView() {
  const x = useObservable(0)

  return (
    <ScrollView navigationTitle="渲染诊断" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack alignment="leading" spacing={16} padding={16}>

        <Text font="footnote" foregroundStyle="secondaryLabel">
          下面每一项都应该出现一个色块或形状。把「没出现色块」的编号告诉我。
        </Text>

        <Row n={1} label="HStack + background 传颜色字符串">
          <HStack background="systemBlue" frame={{ height: 44 }}>
            <Text foregroundStyle="white">应为蓝色横条</Text>
          </HStack>
        </Row>

        <Row n={2} label="HStack + background 传 RoundedRectangle">
          <HStack background={<RoundedRectangle cornerRadius={12} fill="systemBlue" />} frame={{ height: 44 }}>
            <Text foregroundStyle="white">应为蓝色圆角条</Text>
          </HStack>
        </Row>

        <Row n={3} label="VStack + background 传 RoundedRectangle">
          <VStack background={<RoundedRectangle cornerRadius={12} fill="systemGreen" />} frame={{ height: 44 }}>
            <Text foregroundStyle="white">应为绿色圆角条</Text>
          </VStack>
        </Row>

        <Row n={4} label="RoundedRectangle 独立使用（带显式 frame）">
          <RoundedRectangle cornerRadius={12} fill="systemOrange" frame={{ height: 44 }} />
        </Row>

        <Row n={5} label="RoundedRectangle 用 maxWidth infinity 撑开">
          <RoundedRectangle cornerRadius={12} fill="systemPurple"
            frame={{ maxWidth: "infinity", height: 44 }} />
        </Row>

        <Row n={6} label="RoundedRectangle 带 stroke 描边">
          <RoundedRectangle cornerRadius={12} fill="secondarySystemGroupedBackground"
            stroke={{ shapeStyle: "systemRed", strokeStyle: { lineWidth: 3 } }}
            frame={{ maxWidth: "infinity", height: 44 }} />
        </Row>

        <Row n={7} label="ZStack 叠放（应看到红块上压着小黄块）">
          <ZStack frame={{ maxWidth: "infinity", height: 60 }}>
            <RoundedRectangle cornerRadius={12} fill="systemRed"
              frame={{ maxWidth: "infinity", height: 60 }} />
            <RoundedRectangle cornerRadius={6} fill="systemYellow" frame={{ width: 40, height: 24 }} />
          </ZStack>
        </Row>

        <Row n={8} label="ProgressView 线性进度条（应为半满）">
          <ProgressView progressViewStyle="linear" value={0.5} total={1} />
        </Row>

        <Row n={9} label="overlay 覆盖层（蓝块右上角应有黄点）">
          <RoundedRectangle cornerRadius={12} fill="systemBlue"
            frame={{ maxWidth: "infinity", height: 44 }}
            overlay={{
              alignment: "topTrailing",
              content: <RoundedRectangle cornerRadius={4} fill="systemYellow" frame={{ width: 20, height: 20 }} />
            }} />
        </Row>

        <Row n={10} label="页面/分组背景色对比（上灰下白，应能分辨）">
          <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
            <HStack background="systemGroupedBackground" frame={{ height: 30 }}>
              <Text font="caption2">systemGroupedBackground</Text>
            </HStack>
            <HStack background="secondarySystemGroupedBackground" frame={{ height: 30 }}>
              <Text font="caption2">secondarySystemGroupedBackground</Text>
            </HStack>
          </VStack>
        </Row>

        <Row n={11} label="动画：点按钮，方块应平滑滑动而非瞬移">
          <VStack alignment="leading" spacing={6}>
            <HStack frame={{ maxWidth: "infinity", height: 44 }}>
              <RoundedRectangle cornerRadius={8} fill="systemTeal"
                frame={{ width: 44, height: 44 }}
                offset={{ x: x.value, y: 0 }}
                animation={{ animation: Animation.spring({ duration: 0.4, bounce: 0.2 }), value: x.value }} />
              <Spacer />
            </HStack>
            <Button title="移动" buttonStyle="bordered"
              action={() => x.setValue(x.value === 0 ? 160 : 0)} />
          </VStack>
        </Row>

        <Text font="footnote" foregroundStyle="secondaryLabel" padding={{ top: 8 }}>
          共 11 项。请把「没有色块 / 表现异常」的编号发回。
        </Text>
      </VStack>
    </ScrollView>
  )
}
