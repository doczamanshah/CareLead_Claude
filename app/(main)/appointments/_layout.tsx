import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function AppointmentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="freeform" />
      <Stack.Screen name="review" />
      <Stack.Screen name="manual-create" />
      <Stack.Screen name="[appointmentId]/index" />
      <Stack.Screen name="[appointmentId]/plan" />
      <Stack.Screen name="[appointmentId]/suggest" />
      <Stack.Screen name="[appointmentId]/closeout" />
      <Stack.Screen name="[appointmentId]/post-visit-capture" />
      <Stack.Screen name="[appointmentId]/pre-check" />
    </Stack>
  );
}
