import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function CaptureLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.surface.DEFAULT },
        headerTintColor: COLORS.primary.DEFAULT,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="camera" options={{ title: 'Take Photo' }} />
      <Stack.Screen name="upload" options={{ title: 'Upload Document' }} />
      <Stack.Screen name="voice" options={{ title: 'Voice Note' }} />
    </Stack>
  );
}
