import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function MainLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background.DEFAULT },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="today" options={{ animation: 'slide_from_right', headerShown: false }} />
      <Stack.Screen name="profile" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="capture" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="intent-sheet" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="tasks" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="appointments" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="medications" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="caregivers" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="billing" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="results" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="preventive" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ask" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
