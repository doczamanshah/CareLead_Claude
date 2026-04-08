export type ArtifactType = 'document' | 'note';

export type SourceChannel = 'camera' | 'upload' | 'voice' | 'manual';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Artifact {
  id: string;
  profile_id: string;
  artifact_type: ArtifactType;
  source_channel: SourceChannel;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number | null;
  processing_status: ProcessingStatus;
  classification: string | null;
  ocr_text: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ArtifactWithUrl extends Artifact {
  signed_url: string | null;
}

export interface UploadArtifactParams {
  profileId: string;
  fileName: string;
  fileUri: string;
  mimeType: string;
  artifactType: ArtifactType;
  sourceChannel: SourceChannel;
  fileSizeBytes: number;
  metadata?: Record<string, unknown>;
}
