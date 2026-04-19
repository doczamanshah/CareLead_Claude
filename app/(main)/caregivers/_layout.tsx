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

export default function CaregiversLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.background.DEFAULT },
        headerTintColor: COLORS.primary.DEFAULT,
        headerTitleStyle: { color: COLORS.text.DEFAULT },
        headerShadowVisible: false,
        headerLeft: () => <HeaderBackButton />,
        contentStyle: { backgroundColor: COLORS.background.DEFAULT },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Caregivers' }} />
      <Stack.Screen
        name="invite"
        options={{ title: 'Invite Caregiver', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="accept-invite"
        options={{ title: 'Accept Invite', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="enter-code"
        options={{ title: 'Enter Invite Code', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="[grantId]"
        options={{ title: 'Caregiver Details', animation: 'slide_from_right' }}
      />
    </Stack>
  );
}
