import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function PreventiveLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="intent-review" />
    </Stack>
  );
}
