import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function TasksLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="[taskId]" />
      <Stack.Screen name="create" />
    </Stack>
  );
}
