import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CallProvider } from "@/src/context/CallContext";
import { C, F } from "@/src/theme/theme";

export default function TabsLayout() {
  return (
    <CallProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brandPrimary,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontFamily: F.medium, fontSize: 11 },
        tabBarStyle: {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: C.border,
          backgroundColor: C.surface,
        },
      }}
      screenListeners={{
        tabPress: () => Haptics.selectionAsync(),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="worries"
        options={{
          title: "Worries",
          tabBarIcon: ({ color, size }) => <Ionicons name="leaf" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mood"
        options={{
          title: "Mood",
          tabBarIcon: ({ color, size }) => <Ionicons name="happy" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Us",
          tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
        }}
      />
    </Tabs>
    </CallProvider>
  );
}
