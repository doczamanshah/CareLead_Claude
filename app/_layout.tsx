import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, View, Image, StyleSheet, Text } from 'react-native';
import * as Linking from 'expo-linking';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLockStore } from '@/stores/lockStore';
import { fetchUserProfiles } from '@/services/profiles';
import { bootstrapNewUser, cleanupOnSignOut, userHasHousehold } from '@/services/auth';
import {
  clearBiometricPreferences,
  clearBackgroundTimestamp,
  getAutoLockSetting,
  getBackgroundTimestamp,
  isBiometricEnabledForUser,
  isPinSetForUser,
  recordBackgroundTimestamp,
  shouldLockAfterBackground,
  getSessionDuration,
  getSessionStartedAt,
  recordSessionStart,
  sessionDurationMs,
} from '@/services/biometric';
import { logAuthEvent } from '@/services/securityAudit';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  requestNotificationPermissions,
  addNotificationResponseListener,
} from '@/lib/utils/notifications';
import {
  parseInviteToken,
  setPendingInviteToken,
  getPendingInviteToken,
  clearPendingInviteToken,
} from '@/lib/utils/deepLinks';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function AuthGate() {
  const { session, isLoading, setSession, setLoading } = useAuthStore();
  const { isLoaded: profilesLoaded, setProfiles } = useProfileStore();
  const {
    isLocked,
    hasEvaluatedColdStart,
    lock,
    markColdStartEvaluated,
  } = useLockStore();
  const segments = useSegments();
  const router = useRouter();
  const queryClient = useQueryClient();
  const notificationListenerRef = useRef<ReturnType<typeof addNotificationResponseListener> | null>(null);
  const previousUserIdRef = useRef<string | null>(null);
  const [appStateVisible, setAppStateVisible] = useState<AppStateStatus>(
    AppState.currentState,
  );

  // Request notification permissions and set up listener
  useEffect(() => {
    requestNotificationPermissions();

    notificationListenerRef.current = addNotificationResponseListener((taskId) => {
      router.push(`/(main)/tasks/${taskId}`);
    });

    return () => {
      notificationListenerRef.current?.remove();
    };
  }, [router]);

  // Deep-link handler for carelead://invite/[token]
  //   - Cold start: check Linking.getInitialURL()
  //   - While running: listen for 'url' events
  // If the user is authenticated and unlocked, we route immediately. Otherwise
  // the token is saved to SecureStore and consumed by the route-guard effect
  // below once auth is ready.
  useEffect(() => {
    let cancelled = false;

    async function handleIncomingUrl(url: string | null) {
      const token = parseInviteToken(url);
      if (!token) return;

      const { session } = useAuthStore.getState();
      const { isLocked } = useLockStore.getState();

      if (session?.user && !isLocked) {
        // Authenticated and unlocked — go straight to the accept screen
        await clearPendingInviteToken();
        router.push({
          pathname: '/(main)/caregivers/accept-invite',
          params: { token },
        });
      } else {
        // Stash the token; route-guard effect will pick it up once auth is ready.
        await setPendingInviteToken(token);
      }
    }

    (async () => {
      try {
        const initial = await Linking.getInitialURL();
        if (!cancelled) await handleIncomingUrl(initial);
      } catch {
        // Best-effort
      }
    })();

    const sub = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [router]);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const prevUserId = previousUserIdRef.current;
        const nextUserId = session?.user?.id ?? null;

        setSession(session);

        if (session?.user) {
          // If this is a different user than before, clear biometric prefs tied to the old user
          if (prevUserId && prevUserId !== nextUserId) {
            await clearBiometricPreferences();
          }

          // Session bookkeeping: record start for new sessions, audit refreshes.
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            const existingStart = await getSessionStartedAt();
            if (!existingStart) {
              await recordSessionStart();
            }
          } else if (event === 'TOKEN_REFRESHED') {
            logAuthEvent({
              eventType: 'session_refreshed',
              userId: session.user.id,
            });
          }

          // Ensure user has a household (handles sign-in after email confirmation)
          const hasHousehold = await userHasHousehold(session.user.id);
          if (!hasHousehold) {
            const metaName = session.user.user_metadata?.full_name as
              | string
              | undefined;
            await bootstrapNewUser(session.user.id, metaName || undefined);
          }

          // Load profiles into store
          const result = await fetchUserProfiles(session.user.id);
          if (result.success) {
            setProfiles(result.data);
          }
        } else {
          // User signed out — reset profile store and clear biometric prefs
          useProfileStore.getState().reset();
          useLockStore.getState().reset();
          await clearBiometricPreferences();
          queryClient.clear();
        }

        previousUserIdRef.current = nextUserId;
        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, [setSession, setLoading, setProfiles, queryClient]);

  // Session expiry enforcement: when a session loads, check how long it's
  // been since it started. If past the configured duration, sign the user
  // out and make them re-authenticate.
  useEffect(() => {
    if (isLoading) return;
    if (!session?.user) return;

    let cancelled = false;
    (async () => {
      const startedAt = await getSessionStartedAt();
      if (!startedAt) return;
      const duration = await getSessionDuration();
      const elapsed = Date.now() - startedAt;
      if (elapsed < sessionDurationMs(duration)) return;
      if (cancelled) return;

      logAuthEvent({
        eventType: 'session_expired',
        userId: session.user.id,
        detail: { duration, elapsed_hours: Math.round(elapsed / 3600000) },
      });
      await cleanupOnSignOut({
        queryClient,
        logAudit: false,
        reason: 'session_expired',
      });
      router.replace('/(auth)');
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, session, queryClient, router]);

  // Cold-start lock evaluation: once session loads, check if biometric is enabled
  useEffect(() => {
    if (isLoading) return;
    if (hasEvaluatedColdStart) return;
    if (!session?.user) {
      markColdStartEvaluated();
      return;
    }
    (async () => {
      const [bioEnabled, pinEnabled] = await Promise.all([
        isBiometricEnabledForUser(session.user.id),
        isPinSetForUser(session.user.id),
      ]);
      if (bioEnabled || pinEnabled) {
        lock();
      }
      await clearBackgroundTimestamp();
      markColdStartEvaluated();
    })();
  }, [isLoading, session, hasEvaluatedColdStart, lock, markColdStartEvaluated]);

  // AppState listener: record background time, lock on foreground if threshold exceeded,
  // and track current state for the privacy overlay (hides screen in app switcher).
  useEffect(() => {
    const handleChange = async (next: AppStateStatus) => {
      setAppStateVisible(next);

      if (next === 'background') {
        await recordBackgroundTimestamp();
        return;
      }
      if (next === 'active') {
        const currentSession = useAuthStore.getState().session;
        if (!currentSession?.user) return;
        if (useLockStore.getState().isLocked) return;

        const [bioEnabled, pinEnabled] = await Promise.all([
          isBiometricEnabledForUser(currentSession.user.id),
          isPinSetForUser(currentSession.user.id),
        ]);
        if (!bioEnabled && !pinEnabled) {
          await clearBackgroundTimestamp();
          return;
        }
        const bgTs = await getBackgroundTimestamp();
        if (!bgTs) return;
        const autoLock = await getAutoLockSetting();
        const elapsed = Date.now() - bgTs;
        if (shouldLockAfterBackground(elapsed, autoLock)) {
          useLockStore.getState().lock();
        }
        await clearBackgroundTimestamp();
      }
    };

    const sub = AppState.addEventListener('change', handleChange);
    return () => sub.remove();
  }, []);

  // Route guard
  useEffect(() => {
    if (isLoading) return;
    if (!hasEvaluatedColdStart) return;

    const inAuthGroup = segments[0] === '(auth)';
    const secondSegment = (segments as string[])[1];
    const onCollectName = inAuthGroup && secondSegment === 'collect-name';
    const onOnboarding = inAuthGroup && secondSegment === 'onboarding';
    const onAppLock = inAuthGroup && secondSegment === 'app-lock';
    const onboardingCompleted =
      session?.user?.user_metadata?.onboarding_completed === true;

    if (!session && !inAuthGroup) {
      router.replace('/(auth)');
      return;
    }

    // Session + locked → route to app-lock (unless already there)
    if (session && isLocked) {
      if (!onAppLock) {
        router.replace('/(auth)/app-lock');
      }
      return;
    }

    // Session + unlocked but on app-lock screen → move to main
    if (session && !isLocked && onAppLock && profilesLoaded) {
      if (onboardingCompleted) {
        router.replace('/(main)/(tabs)');
      } else {
        router.replace('/(auth)/onboarding');
      }
      return;
    }

    if (
      session &&
      inAuthGroup &&
      profilesLoaded &&
      !onCollectName &&
      !onOnboarding &&
      !onAppLock
    ) {
      // Authenticated + on a non-carveout auth screen — route based on onboarding state
      if (onboardingCompleted) {
        router.replace('/(main)/(tabs)');
      } else {
        router.replace('/(auth)/onboarding');
      }
    }
  }, [
    session,
    segments,
    isLoading,
    profilesLoaded,
    isLocked,
    hasEvaluatedColdStart,
    router,
  ]);

  // Resume a deferred invite once the user is fully signed in and unlocked.
  // The deep-link listener above stashes the token if auth wasn't ready; as
  // soon as we land in the main section we pick it up and navigate.
  useEffect(() => {
    if (isLoading) return;
    if (!hasEvaluatedColdStart) return;
    if (!session?.user) return;
    if (isLocked) return;
    if (!profilesLoaded) return;
    const inMainGroup = segments[0] === '(main)';
    if (!inMainGroup) return;
    const onboardingCompleted =
      session?.user?.user_metadata?.onboarding_completed === true;
    if (!onboardingCompleted) return;

    let cancelled = false;
    (async () => {
      const token = await getPendingInviteToken();
      if (cancelled || !token) return;
      await clearPendingInviteToken();
      router.push({
        pathname: '/(main)/caregivers/accept-invite',
        params: { token },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [session, isLoading, hasEvaluatedColdStart, isLocked, profilesLoaded, segments, router]);

  const showContent =
    !(isLoading || (session && !profilesLoaded) || !hasEvaluatedColdStart);

  // Privacy overlay: hide app content whenever AppState is not 'active' so
  // PHI can't be captured in the iOS app switcher.
  const showPrivacyOverlay = appStateVisible !== 'active';

  return (
    <View style={styles.root}>
      {showContent ? (
        <Slot />
      ) : (
        <LoadingSpinner message="Loading CareLead..." />
      )}
      {showPrivacyOverlay ? <PrivacyOverlay /> : null}
    </View>
  );
}

function PrivacyOverlay() {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.overlayLogoWrap}>
        <Image
          source={require('../assets/icon.png')}
          style={styles.overlayLogo}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.overlayBrand}>CareLead</Text>
      <Text style={styles.overlayTagline}>Your care. In your hands.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  overlayLogoWrap: {
    width: 120,
    height: 120,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  overlayLogo: {
    width: 96,
    height: 96,
  },
  overlayBrand: {
    fontSize: 36,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  overlayTagline: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.secondary.dark,
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
