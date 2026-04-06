import { useAuthStore } from '@/stores/authStore';

export function useAuth() {
  const { session, user, isLoading } = useAuthStore();

  return {
    session,
    user,
    isLoading,
    isAuthenticated: !!session,
  };
}
