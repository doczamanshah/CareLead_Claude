/**
 * Side effects fired once per app open from the Home screen:
 *   - One-time biometric/PIN enrollment prompt per user on this device
 *   - First-time caregiver onboarding redirect
 *   - Background medication profile_facts → med_medications migration
 *
 * Extracted from the Home screen so the screen file stays focused on UI.
 * All effects are idempotent and gated by `useRef` so they never fire twice.
 */

import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useActiveProfile } from './useActiveProfile';
import { useAuth } from './useAuth';
import {
  useCaregiverOnboarded,
  useIsCaregiverForProfile,
} from './useCaregiverEnrichment';
import {
  needsMedicationMigration,
  migrateMedicationFacts,
} from '@/services/medicationMigration';
import {
  enableBiometricForUser,
  getBiometricCapability,
  hasBeenPromptedForUser,
  isBiometricEnabledForUser,
  isPinSetForUser,
  markPromptedForUser,
  promptBiometric,
} from '@/services/biometric';

export function useHomeSideEffects() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeProfileId } = useActiveProfile();
  const { user } = useAuth();
  const { data: isCaregiver } = useIsCaregiverForProfile(activeProfileId);
  const { data: caregiverOnboarded } = useCaregiverOnboarded(activeProfileId);

  // First-time caregiver → contribute screen.
  const caregiverRedirectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isCaregiver || !activeProfileId) return;
    if (caregiverOnboarded !== false) return;
    if (caregiverRedirectRef.current === activeProfileId) return;
    caregiverRedirectRef.current = activeProfileId;
    router.push({
      pathname: '/(main)/caregivers/contribute',
      params: { profileId: activeProfileId },
    } as never);
  }, [isCaregiver, caregiverOnboarded, activeProfileId, router]);

  // One-time biometric/PIN enrollment prompt per user on this device.
  const biometricPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    if (biometricPromptRef.current === user.id) return;
    biometricPromptRef.current = user.id;

    let cancelled = false;
    (async () => {
      const [capability, alreadyEnabled, alreadyPrompted, pinSet] =
        await Promise.all([
          getBiometricCapability(),
          isBiometricEnabledForUser(user.id),
          hasBeenPromptedForUser(user.id),
          isPinSetForUser(user.id),
        ]);
      if (cancelled) return;
      if (alreadyPrompted || alreadyEnabled || pinSet) return;

      const biometricAvailable = capability.available && capability.enrolled;
      if (biometricAvailable) {
        const label = capability.label;
        Alert.alert(
          `Enable ${label}?`,
          `Use ${label} to quickly unlock CareLead and keep your health information secure.`,
          [
            {
              text: 'Not now',
              style: 'cancel',
              onPress: () => markPromptedForUser(user.id),
            },
            {
              text: 'Enable',
              onPress: async () => {
                const result = await promptBiometric(`Enable ${label} for CareLead`);
                if (result.success) {
                  await enableBiometricForUser(user.id);
                } else if (
                  result.error &&
                  result.error !== 'user_cancel' &&
                  result.error !== 'cancelled'
                ) {
                  Alert.alert(
                    `Could not enable ${label}`,
                    `Error: ${result.error}\n\nYou can try again later from Settings.`,
                  );
                }
                await markPromptedForUser(user.id);
              },
            },
          ],
        );
        return;
      }

      Alert.alert(
        'Set a PIN?',
        'Set a 4-digit PIN to protect your health information.',
        [
          {
            text: 'Not now',
            style: 'cancel',
            onPress: () => markPromptedForUser(user.id),
          },
          {
            text: 'Set PIN',
            onPress: async () => {
              await markPromptedForUser(user.id);
              router.push('/(auth)/setup-pin');
            },
          },
        ],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, router]);

  // Auto-migrate medication profile_facts → med_medications on first load.
  const migrationRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProfileId || !user?.id) return;
    if (migrationRanRef.current === activeProfileId) return;

    let cancelled = false;
    (async () => {
      const needed = await needsMedicationMigration(activeProfileId);
      if (cancelled || !needed) return;
      migrationRanRef.current = activeProfileId;
      const result = await migrateMedicationFacts(activeProfileId, user.id);
      if (!cancelled && result.success && result.data.migrated > 0) {
        queryClient.invalidateQueries({ queryKey: ['medications'] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, user?.id, queryClient]);

  return { isCaregiver };
}
