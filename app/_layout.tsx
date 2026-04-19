import { useEffect, useRef } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { fetchUserProfiles } from '@/services/profiles';
import { bootstrapNewUser, userHasHousehold } from '@/services/auth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  requestNotificationPermissions,
  addNotificationResponseListener,
} from '@/lib/utils/notifications';

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
  const segments = useSegments();
  const router = useRouter();
  const notificationListenerRef = useRef<ReturnType<typeof addNotificationResponseListener> | null>(null);

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

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);

        if (session?.user) {
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
          // User signed out — reset profile store
          useProfileStore.getState().reset();
          queryClient.clear();
        }

        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, [setSession, setLoading, setProfiles]);

  // Route guard
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onCollectName =
      inAuthGroup && (segments as string[])[1] === 'collect-name';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)');
    } else if (session && inAuthGroup && profilesLoaded && !onCollectName) {
      router.replace('/(main)/(tabs)');
    }
  }, [session, segments, isLoading, profilesLoaded, router]);

  if (isLoading || (session && !profilesLoaded)) {
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
