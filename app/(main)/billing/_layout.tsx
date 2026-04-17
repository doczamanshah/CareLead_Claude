import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function BillingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="start" />
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/add-document" />
      <Stack.Screen name="[id]/call-helper" />
      <Stack.Screen name="[id]/appeals" />
    </Stack>
  );
}
