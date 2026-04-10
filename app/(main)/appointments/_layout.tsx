import { Stack } from 'expo-router';

export default function AppointmentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="[appointmentId]/index" />
      <Stack.Screen name="[appointmentId]/plan" />
      <Stack.Screen name="[appointmentId]/suggest" />
      <Stack.Screen name="[appointmentId]/closeout" />
    </Stack>
  );
}
