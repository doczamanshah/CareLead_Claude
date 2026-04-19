import { TouchableOpacity, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants/colors';

function HeaderBackButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
      <Text style={{ color: COLORS.primary.DEFAULT, fontSize: 17 }}>‹ Back</Text>
    </TouchableOpacity>
  );
}

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
      <Stack.Screen
        name="index"
        options={{
          title: 'Health Profile',
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen name="edit" options={{ title: 'Edit Profile' }} />
      <Stack.Screen name="add-fact" options={{ title: 'Add Information' }} />
      <Stack.Screen name="strengthen" options={{ title: 'Your Health Profile' }} />
      <Stack.Screen name="data-quality" options={{ title: 'Profile Data Quality' }} />
      <Stack.Screen name="priorities" options={{ title: 'What Matters to You' }} />
    </Stack>
  );
}
