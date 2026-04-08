import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchArtifacts,
  fetchArtifactDetail,
  uploadArtifact,
} from '@/services/artifacts';
import type { UploadArtifactParams } from '@/lib/types/artifacts';

export function useArtifacts(profileId: string | undefined) {
  return useQuery({
    queryKey: ['artifacts', 'list', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchArtifacts(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useArtifactDetail(artifactId: string | undefined) {
  return useQuery({
    queryKey: ['artifacts', 'detail', artifactId],
    queryFn: async () => {
      if (!artifactId) return null;
      const result = await fetchArtifactDetail(artifactId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!artifactId,
  });
}

export function useUploadArtifact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UploadArtifactParams) => {
      const result = await uploadArtifact(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['artifacts', 'list', variables.profileId],
      });
    },
  });
}
