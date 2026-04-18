import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function ResultsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="add" />
      <Stack.Screen name="add-typed" />
      <Stack.Screen name="add-dictated" />
      <Stack.Screen name="add-upload" />
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/review" />
    </Stack>
  );
}
