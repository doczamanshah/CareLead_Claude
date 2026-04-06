import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background.DEFAULT },
        headerTintColor: COLORS.primary.DEFAULT,
        headerTitleStyle: { color: COLORS.text.DEFAULT },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="[profileId]" options={{ headerShown: false }} />
    </Stack>
  );
}
