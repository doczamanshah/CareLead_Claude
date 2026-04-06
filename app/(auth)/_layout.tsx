import { Stack } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    />
  );
}
