import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function MedicationsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="snap-label" />
      <Stack.Screen name="[medicationId]" />
      <Stack.Screen name="refill/[medicationId]" />
    </Stack>
  );
}
