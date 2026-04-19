import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function EnterInviteCodeScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleContinue() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Please enter the invite code.');
      return;
    }
    // Extract just the token part if a full deep link was pasted
    const tokenMatch = trimmed.match(/carelead:\/\/invite\/([^\s?&#]+)/i);
    const token = tokenMatch ? tokenMatch[1] : trimmed;

    router.replace({
      pathname: '/(main)/caregivers/accept-invite',
      params: { token },
    });
  }

  return (
    <ScreenLayout>
      <View style={styles.iconWrap}>
        <Ionicons name="key-outline" size={32} color={COLORS.primary.DEFAULT} />
      </View>
      <Text style={styles.title}>Enter your invite code</Text>
      <Text style={styles.subtitle}>
        Paste the invite link or code from the message you received. We'll look it up and show you
        the details before you accept.
      </Text>

      <Input
        label="Invite code or link"
        placeholder="carelead://invite/..."
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        error={error ?? undefined}
      />

      <View style={styles.actions}>
        <Button title="Continue" onPress={handleContinue} />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 24,
    marginBottom: 20,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  actions: {
    marginTop: 16,
  },
});
