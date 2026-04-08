/**
 * Artifact service — handles file uploads to Supabase Storage and artifact CRUD.
 *
 * SETUP REQUIRED: Create a **private** bucket named "artifacts" in Supabase Dashboard:
 *   Storage → New Bucket → Name: "artifacts" → Public: OFF (private)
 *
 * RLS policies on the `artifacts` table should scope access by profile_id
 * through household membership, matching the pattern used by profile_facts.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { APP_CONFIG } from '@/lib/constants/config';
import type {
  Artifact,
  ArtifactWithUrl,
  UploadArtifactParams,
} from '@/lib/types/artifacts';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

const BUCKET = 'artifacts';

/**
 * Upload a file to Supabase Storage and create a corresponding artifact row.
 * Storage path: {profileId}/{artifactId}/{fileName}
 */
export async function uploadArtifact(
  params: UploadArtifactParams,
): Promise<ServiceResult<Artifact>> {
  const {
    profileId,
    fileName,
    fileUri,
    mimeType,
    artifactType,
    sourceChannel,
    fileSizeBytes,
    metadata = {},
  } = params;

  // 1. Create the artifact row first to get an ID for the storage path
  const { data: artifact, error: insertError } = await supabase
    .from('artifacts')
    .insert({
      profile_id: profileId,
      artifact_type: artifactType,
      source_channel: sourceChannel,
      file_name: fileName,
      file_path: '', // will update after upload
      mime_type: mimeType,
      file_size: fileSizeBytes,
      processing_status: 'pending',
    })
    .select()
    .single();

  if (insertError) {
    return { success: false, error: insertError.message, code: insertError.code };
  }

  const artifactId = (artifact as Artifact).id;
  const storagePath = `${profileId}/${artifactId}/${fileName}`;

  // 2. Read file as base64 and upload to storage
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'base64',
    });

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, decode(base64), {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      // Clean up the artifact row on upload failure
      await supabase.from('artifacts').delete().eq('id', artifactId);
      return { success: false, error: uploadError.message };
    }
  } catch (err) {
    await supabase.from('artifacts').delete().eq('id', artifactId);
    const message = err instanceof Error ? err.message : 'File read failed';
    return { success: false, error: message };
  }

  // 3. Update the artifact row with the actual storage path
  const { data: updated, error: updateError } = await supabase
    .from('artifacts')
    .update({ file_path: storagePath })
    .eq('id', artifactId)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: updateError.message, code: updateError.code };
  }

  return { success: true, data: updated as Artifact };
}

/**
 * Fetch all artifacts for a profile, ordered by most recent first.
 */
export async function fetchArtifacts(
  profileId: string,
): Promise<ServiceResult<Artifact[]>> {
  const { data, error } = await supabase
    .from('artifacts')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as Artifact[] };
}

/**
 * Fetch a single artifact with a short-lived signed URL for viewing.
 */
export async function fetchArtifactDetail(
  artifactId: string,
): Promise<ServiceResult<ArtifactWithUrl>> {
  const { data, error } = await supabase
    .from('artifacts')
    .select('*')
    .eq('id', artifactId)
    .is('deleted_at', null)
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const artifact = data as Artifact;
  let signedUrl: string | null = null;

  if (artifact.file_path) {
    const urlResult = await getArtifactSignedUrl(artifact.file_path);
    if (urlResult.success) {
      signedUrl = urlResult.data;
    }
  }

  return { success: true, data: { ...artifact, signed_url: signedUrl } };
}

/**
 * Generate a short-lived signed URL for a storage file (default 1 hour).
 */
export async function getArtifactSignedUrl(
  filePath: string,
): Promise<ServiceResult<string>> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, APP_CONFIG.signedUrlExpiry);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data.signedUrl };
}
