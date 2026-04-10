import { Stack } from 'expo-router';

export default function MedicationsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="[medicationId]" />
      <Stack.Screen name="refill/[medicationId]" />
    </Stack>
  );
}
