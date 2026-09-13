import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import { Text, tokens, useTheme } from "../design-system";
import { useHrms, type HrmsBootstrap } from "../hrms/api";
import { Attendance } from "../hrms/attendance";
import { Leave } from "../hrms/leave";
import { History, Reviews } from "../hrms/history";
import { Notice } from "../hrms/ui";
import { HrmsTheme } from "../hrms/theme";
import { BrandGradient } from "../design-system/brand-gradient";
import type { HrmsDestination } from "../home/updates";
type Props = { workspaceId: string; initialDestination?: HrmsDestination };
export function HrmsScreen(props: Props) {
  return <HrmsTheme><HrmsWorkspace {...props} /></HrmsTheme>;
}
function HrmsWorkspace({ workspaceId, initialDestination }: Props) {
  const [revision, setRevision] = useState(0),
    [selectedTab, setTab] = useState<string>(initialDestination?.tab ?? "attendance"),
    boot = useHrms<HrmsBootstrap>(workspaceId, "bootstrap", revision),
    { colors, direction } = useTheme();
  const tab = selectedTab === "approvals" && boot.data && !boot.data.permissions.team ? "attendance" : selectedTab;
  const { fontScale } = useWindowDimensions();
  // A horizontal ScrollView shrinks by default. Reserve the full button height
  // plus the inset so long page content cannot crop the selected tab's corners.
  const tabButtonHeight = Math.max(44, Math.ceil(Math.round(tokens.fontSize.xs * 1.55) * fontScale) + 24);
  const tabBarHeight = tabButtonHeight + 8;
  const refresh = () => setRevision((r) => r + 1);
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, direction }}>
      <Text size="sm" tone="textSecondary" style={{ paddingTop: 6, paddingBottom: 18 }}>
        Your workday, wherever work takes you.
      </Text>
      <ScrollView
        horizontal
        testID="hrms-tab-bar"
        bounces={false}
        alwaysBounceVertical={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        showsHorizontalScrollIndicator={false}
        style={{ height: tabBarHeight, minHeight: tabBarHeight, flexGrow: 0, flexShrink: 0, marginBottom: 18, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', gap: 3, padding: 4 }}
      >
        {[
          { id: "attendance", label: "Attendance" },
          { id: "leave", label: "Leave" },
          { id: "history", label: "History" },
          ...(boot.data?.permissions.team
            ? [{ id: "approvals", label: "Approvals" }]
            : []),
        ].map((t) => (
          <Pressable
            key={t.id}
            testID={`hrms-tab-${t.id}`}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tab === t.id }}
            onPress={() => setTab(t.id)}
            style={({ pressed }) => ({ flexGrow: 1, flexShrink: 0, minWidth: (t.id === 'attendance' ? 94 : t.id === 'approvals' ? 86 : 68) * Math.max(1, fontScale), height: tabButtonHeight, paddingVertical: 12, paddingHorizontal: 9,
              borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden',
              borderColor: tab === t.id ? 'rgba(105,79,122,0.16)' : 'transparent',
              backgroundColor: pressed && tab !== t.id ? colors.surfacePressed : 'transparent' })}
          >{tab === t.id ? <BrandGradient /> : null}<Text size="xs" weight="semibold" numberOfLines={1}
              style={{ color: tab === t.id ? '#2f232d' : colors.textSecondary }}>{t.label}</Text></Pressable>
        ))}
      </ScrollView>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={boot.loading} onRefresh={refresh} tintColor={colors.actionPrimary} colors={[colors.actionPrimary]} />
        }
        contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
      >
        {boot.error ? <Notice error>{boot.error}</Notice> : null}
        {!boot.data && boot.loading ? <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 24 }}><ActivityIndicator color={colors.actionPrimary} /><Text size="sm" tone="textSecondary">Loading your workspace…</Text></View> : null}
        {boot.data ? (
          tab === "attendance" ? (
            <Attendance
              workspaceId={workspaceId}
              boot={boot.data}
              revision={revision}
              onSaved={refresh}
            />
          ) : tab === "leave" ? (
            <Leave
              workspaceId={workspaceId}
              boot={boot.data}
              revision={revision}
              onSaved={refresh}
            />
          ) : tab === "history" ? (
            <History
              workspaceId={workspaceId}
              boot={boot.data}
              revision={revision}
              onSaved={refresh}
            />
          ) : (
            <Reviews
              workspaceId={workspaceId}
              boot={boot.data}
              revision={revision}
              onSaved={refresh}
              initialView={initialDestination?.reviewView}
              team
            />
          )
        ) : null}
      </ScrollView>
    </View>
  );
}
