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

export default function CaptureLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.surface.DEFAULT },
        headerTintColor: COLORS.primary.DEFAULT,
        headerShadowVisible: false,
        headerLeft: () => <HeaderBackButton />,
      }}
    >
      <Stack.Screen name="camera" options={{ title: 'Take Photo' }} />
      <Stack.Screen name="upload" options={{ title: 'Upload Document' }} />
      <Stack.Screen name="voice" options={{ title: 'Voice Note' }} />
    </Stack>
  );
}
