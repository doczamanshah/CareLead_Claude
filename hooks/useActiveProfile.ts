import { useProfileStore } from '@/stores/profileStore';

export function useActiveProfile() {
  const { profiles, activeProfileId, switchProfile } = useProfileStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  return {
    activeProfileId,
    activeProfile,
    profiles,
    switchProfile,
  };
}
