import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { sendPhoneOtp } from '@/services/auth';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface Country {
  code: string;
  dial: string;
  name: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { code: 'US', dial: '+1', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', dial: '+1', name: 'Canada', flag: '🇨🇦' },
  { code: 'GB', dial: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IN', dial: '+91', name: 'India', flag: '🇮🇳' },
  { code: 'AU', dial: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', dial: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', dial: '+33', name: 'France', flag: '🇫🇷' },
  { code: 'MX', dial: '+52', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ES', dial: '+34', name: 'Spain', flag: '🇪🇸' },
  { code: 'IT', dial: '+39', name: 'Italy', flag: '🇮🇹' },
  { code: 'BR', dial: '+55', name: 'Brazil', flag: '🇧🇷' },
  { code: 'JP', dial: '+81', name: 'Japan', flag: '🇯🇵' },
];

function formatUsPhone(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function PhoneEntryScreen() {
  const router = useRouter();
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUsOrCa = country.dial === '+1';
  const display = isUsOrCa ? formatUsPhone(raw) : raw;
  const minDigits = 10;

  function handlePhoneChange(text: string) {
    setError(null);
    const digits = text.replace(/\D/g, '').slice(0, 15);
    setRaw(digits);
  }

  async function handleSendCode() {
    if (raw.length < minDigits) {
      setError(`Please enter a valid ${minDigits}-digit phone number.`);
      return;
    }
    setLoading(true);
    setError(null);
    const fullNumber = `${country.dial}${raw}`;
    const result = await sendPhoneOtp(fullNumber);
    setLoading(false);

    if (!result.success) {
      setError("We couldn't send a code to that number. Please check and try again.");
      return;
    }

    router.push({
      pathname: '/(auth)/verify-otp',
      params: {
        phone: fullNumber,
        display: `${country.dial} ${display || raw}`,
      },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.text.DEFAULT} />
          </TouchableOpacity>
        </View>

        <View style={styles.container}>
          <View>
            <Text style={styles.title}>Enter your phone number</Text>
            <Text style={styles.subtitle}>
              We'll send you a 6-digit code to verify
            </Text>

            <View style={styles.phoneRow}>
              <TouchableOpacity
                style={styles.countryBtn}
                onPress={() => setPickerVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.flag}>{country.flag}</Text>
                <Text style={styles.dial}>{country.dial}</Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={COLORS.text.secondary}
                />
              </TouchableOpacity>

              <TextInput
                style={styles.phoneInput}
                value={display}
                onChangeText={handlePhoneChange}
                placeholder={isUsOrCa ? '(555) 123-4567' : 'Phone number'}
                placeholderTextColor={COLORS.text.tertiary}
                keyboardType="phone-pad"
                autoFocus
                maxLength={isUsOrCa ? 14 : 15}
              />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.buttonWrap}>
              <Button
                title="Send Code"
                size="lg"
                onPress={handleSendCode}
                loading={loading}
                disabled={raw.length < minDigits}
              />
            </View>
          </View>

          <TouchableOpacity
            style={styles.emailLink}
            activeOpacity={0.7}
            onPress={() => router.push('/(auth)/email-auth')}
          >
            <Text style={styles.emailLinkText}>Use email instead</Text>
          </TouchableOpacity>
        </View>

        <Modal
          visible={pickerVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setPickerVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setPickerVisible(false)}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select country</Text>
                <TouchableOpacity
                  onPress={() => setPickerVisible(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={22} color={COLORS.text.secondary} />
                </TouchableOpacity>
              </View>
              <FlatList
                data={COUNTRIES}
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.countryRow}
                    onPress={() => {
                      setCountry(item);
                      setPickerVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowFlag}>{item.flag}</Text>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowDial}>{item.dial}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  headerBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginBottom: 32,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  flag: {
    fontSize: 20,
  },
  dial: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: FONT_SIZES.lg,
    color: COLORS.text.DEFAULT,
  },
  error: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    marginTop: 8,
  },
  buttonWrap: {
    marginTop: 24,
  },
  emailLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  emailLinkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  rowFlag: {
    fontSize: 22,
  },
  rowName: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  rowDial: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
