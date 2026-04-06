import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { fetchUserProfiles } from '@/services/profiles';
import { bootstrapNewUser, userHasHousehold } from '@/services/auth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

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

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);

        if (session?.user) {
          // Ensure user has a household (handles sign-in after email confirmation)
          const hasHousehold = await userHasHousehold(session.user.id);
          if (!hasHousehold) {
            await bootstrapNewUser(session.user.id);
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

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup && profilesLoaded) {
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
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}
