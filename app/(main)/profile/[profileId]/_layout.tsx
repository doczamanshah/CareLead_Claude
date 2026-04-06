import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function ProfileIdLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background.DEFAULT },
        headerTintColor: COLORS.primary.DEFAULT,
        headerTitleStyle: { color: COLORS.text.DEFAULT },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Health Profile' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit Profile' }} />
      <Stack.Screen name="add-fact" options={{ title: 'Add Information' }} />
    </Stack>
  );
}
