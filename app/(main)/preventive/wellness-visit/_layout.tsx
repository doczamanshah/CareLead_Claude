import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function WellnessVisitLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="freeform" />
      <Stack.Screen name="profile-review" />
      <Stack.Screen name="preventive-agenda" />
      <Stack.Screen name="questions" />
      <Stack.Screen name="packet" />
    </Stack>
  );
}
