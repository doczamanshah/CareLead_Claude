import { View, Text, Alert, StyleSheet } from 'react-native';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES } from '@/lib/constants/typography';

export default function SettingsScreen() {
  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Error', error.message);
    }
  }

  return (
    <ScreenLayout title="Settings">
      <View style={styles.container}>
        <Text style={styles.description}>
          App settings and account management.
        </Text>
        <Button
          title="Sign Out"
          onPress={handleSignOut}
          variant="outline"
        />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  description: {
    color: COLORS.text.secondary,
    fontSize: FONT_SIZES.base,
    marginBottom: 32,
  },
});
