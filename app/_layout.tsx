import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLockStore } from '@/stores/lockStore';
import { fetchUserProfiles } from '@/services/profiles';
import { bootstrapNewUser, userHasHousehold } from '@/services/auth';
import {
  clearBiometricPreferences,
  clearBackgroundTimestamp,
  getAutoLockSetting,
  getBackgroundTimestamp,
  isBiometricEnabledForUser,
  recordBackgroundTimestamp,
  shouldLockAfterBackground,
} from '@/services/biometric';
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
  const notificationListenerRef = useRef<ReturnType<typeof addNotificationResponseListener> | null>(null);
  const previousUserIdRef = useRef<string | null>(null);

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
      async (_event, session) => {
        const prevUserId = previousUserIdRef.current;
        const nextUserId = session?.user?.id ?? null;

        setSession(session);

        if (session?.user) {
          // If this is a different user than before, clear biometric prefs tied to the old user
          if (prevUserId && prevUserId !== nextUserId) {
            await clearBiometricPreferences();
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
  }, [setSession, setLoading, setProfiles]);

  // Cold-start lock evaluation: once session loads, check if biometric is enabled
  useEffect(() => {
    if (isLoading) return;
    if (hasEvaluatedColdStart) return;
    if (!session?.user) {
      markColdStartEvaluated();
      return;
    }
    (async () => {
      const enabled = await isBiometricEnabledForUser(session.user.id);
      if (enabled) {
        lock();
      }
      await clearBackgroundTimestamp();
      markColdStartEvaluated();
    })();
  }, [isLoading, session, hasEvaluatedColdStart, lock, markColdStartEvaluated]);

  // AppState listener: record background time, lock on foreground if threshold exceeded
  useEffect(() => {
    const handleChange = async (next: AppStateStatus) => {
      if (next === 'background') {
        await recordBackgroundTimestamp();
        return;
      }
      if (next === 'active') {
        const currentSession = useAuthStore.getState().session;
        if (!currentSession?.user) return;
        if (useLockStore.getState().isLocked) return;

        const enabled = await isBiometricEnabledForUser(currentSession.user.id);
        if (!enabled) {
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

  if (isLoading || (session && !profilesLoaded) || !hasEvaluatedColdStart) {
    return <LoadingSpinner message="Loading CareLead..." />;
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
