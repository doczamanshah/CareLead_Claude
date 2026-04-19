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
      <Stack.Screen name="catch-up" options={{ headerShown: false }} />
      <Stack.Screen name="catch-up-capture" options={{ headerShown: false }} />
      <Stack.Screen name="catch-up-review" options={{ headerShown: false }} />
      <Stack.Screen
        name="catch-up-processing"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="catch-up-summary"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="import-summary" options={{ headerShown: false }} />
      <Stack.Screen name="import-summary-camera" options={{ headerShown: false }} />
      <Stack.Screen
        name="import-processing"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="import-review" options={{ headerShown: false }} />
      <Stack.Screen
        name="import-done"
        options={{ headerShown: false, gestureEnabled: false }}
      />
    </Stack>
  );
}
