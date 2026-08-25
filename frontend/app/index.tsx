import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { C } from "@/src/theme/theme";

export default function Index() {
  const { booting, token, pairStatus } = useAuth();

  if (booting) {
    return (
      <View style={styles.center} testID="boot-loading">
        <ActivityIndicator color={C.brandPrimary} size="large" />
      </View>
    );
  }
  if (!token) return <Redirect href="/welcome" />;
  if (pairStatus !== "active") return <Redirect href="/pair" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.surface },
});
