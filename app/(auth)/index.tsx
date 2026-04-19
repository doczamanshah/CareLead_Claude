import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brand}>CareLead</Text>
          <Text style={styles.tagline}>Your care. In your hands.</Text>
          <Text style={styles.subtitle}>
            Manage your health information in one secure place
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            title="Get Started"
            size="lg"
            onPress={() => router.push('/(auth)/phone-entry')}
          />

          <TouchableOpacity
            style={styles.secondaryLink}
            activeOpacity={0.7}
            onPress={() => router.push('/(auth)/phone-entry')}
          >
            <Text style={styles.secondaryLinkText}>I already have an account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.emailLink}
            activeOpacity={0.7}
            onPress={() => router.push('/(auth)/email-auth')}
          >
            <Text style={styles.emailLinkText}>Use email instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 32,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: 120,
    height: 120,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    overflow: 'hidden',
  },
  logo: {
    width: 96,
    height: 96,
  },
  brand: {
    fontSize: 42,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.secondary.dark,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  actions: {
    gap: 16,
  },
  secondaryLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  secondaryLinkText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  emailLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  emailLinkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
