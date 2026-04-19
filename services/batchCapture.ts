/**
 * Batch capture service — orchestrates upload + extraction for a batch of
 * photos captured via the "Catch Up" flow. Each photo is routed to the
 * appropriate pipeline based on its user-classified document type.
 *
 * All docs process in parallel. Failures surface per-item without blocking
 * the rest of the batch.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { uploadArtifact } from '@/services/artifacts';
import { triggerExtraction } from '@/services/extraction';
import {
  createResult,
  uploadResultDocument,
  triggerResultExtraction,
} from '@/services/results';
import {
  createBillingCase,
  uploadBillingDocument,
  triggerDocumentExtraction,
} from '@/services/billing';
import { createMedication } from '@/services/medications';
import type {
  CapturedPhoto,
  PhotoProcessingResult,
  DocumentClassification,
} from '@/stores/batchCaptureStore';
import type { MedicationForm } from '@/lib/types/medications';

export interface BatchContext {
  profileId: string;
  householdId: string;
  userId: string;
}

type OnUpdate = (r: PhotoProcessingResult) => void;

interface MedLabelExtraction {
  medication_name?: string | null;
  dose?: string | null;
  form?: string | null;
  frequency?: string | null;
  refills_remaining?: number | null;
  prescriber?: string | null;
  pharmacy_name?: string | null;
  pharmacy_phone?: string | null;
  last_fill_date?: string | null;
  instructions?: string | null;
}

const ALLOWED_MED_FORMS: ReadonlySet<MedicationForm> = new Set<MedicationForm>([
  'tablet',
  'capsule',
  'liquid',
  'cream',
  'injection',
  'inhaler',
  'patch',
  'drops',
  'other',
]);

function normalizeForm(raw: string | null | undefined): MedicationForm | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  // Normalize common synonyms
  const mapped =
    lower === 'solution' || lower === 'suspension' || lower === 'syrup'
      ? 'liquid'
      : lower === 'ointment' || lower === 'gel' || lower === 'lotion'
        ? 'cream'
        : lower === 'spray'
          ? 'inhaler'
          : lower;
  return ALLOWED_MED_FORMS.has(mapped as MedicationForm)
    ? (mapped as MedicationForm)
    : undefined;
}

export async function processPhoto(
  photo: CapturedPhoto,
  context: BatchContext,
  onUpdate: OnUpdate,
): Promise<PhotoProcessingResult> {
  const { tempId, uri, type } = photo;

  const report = (result: PhotoProcessingResult): PhotoProcessingResult => {
    onUpdate(result);
    return result;
  };

  report({ tempId, status: 'uploading' });

  try {
    const info = await FileSystem.getInfoAsync(uri);
    const fileSize = info.exists ? info.size ?? 0 : 0;
    const timestamp = Date.now();
    const fileName = `batch-${type}-${timestamp}.jpg`;

    if (type === 'medication_label') {
      return await processMedicationLabel(
        { tempId, uri, fileName, fileSize },
        context,
        report,
      );
    }

    if (type === 'lab_result') {
      return await processLabResult(
        { tempId, uri, fileName },
        context,
        report,
      );
    }

    if (type === 'bill' || type === 'eob') {
      return await processBilling(
        { tempId, uri, fileName, docType: type },
        context,
        report,
      );
    }

    return await processGenericDocument(
      { tempId, uri, fileName, fileSize, type },
      context,
      report,
    );
  } catch (e) {
    return report({
      tempId,
      status: 'failed',
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
}

async function processMedicationLabel(
  input: { tempId: string; uri: string; fileName: string; fileSize: number },
  ctx: BatchContext,
  report: (r: PhotoProcessingResult) => PhotoProcessingResult,
): Promise<PhotoProcessingResult> {
  const artifactRes = await uploadArtifact({
    profileId: ctx.profileId,
    fileName: input.fileName,
    fileUri: input.uri,
    mimeType: 'image/jpeg',
    artifactType: 'document',
    sourceChannel: 'camera',
    fileSizeBytes: input.fileSize,
  });
  if (!artifactRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: artifactRes.error });
  }

  report({ tempId: input.tempId, status: 'extracting' });

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return report({ tempId: input.tempId, status: 'failed', error: 'Not authenticated' });
  }

  const { data, error } = await supabase.functions.invoke('extract-med-label', {
    body: { artifactId: artifactRes.data.id, profileId: ctx.profileId },
  });

  if (error || !data?.medication) {
    return report({
      tempId: input.tempId,
      status: 'failed',
      error: error?.message ?? 'Could not read medication label',
    });
  }

  const med = data.medication as MedLabelExtraction;
  const drugName = med.medication_name?.trim();
  if (!drugName) {
    return report({
      tempId: input.tempId,
      status: 'failed',
      error: 'No medication name found on label',
    });
  }

  const medRes = await createMedication(
    {
      profile_id: ctx.profileId,
      drug_name: drugName,
      strength: med.dose ?? undefined,
      form: normalizeForm(med.form),
      dose_text: med.dose ?? undefined,
      frequency_text: med.frequency ?? undefined,
      instructions: med.instructions ?? undefined,
      last_fill_date: med.last_fill_date ?? undefined,
      refills_remaining: med.refills_remaining ?? undefined,
      pharmacy_name: med.pharmacy_name ?? undefined,
      pharmacy_phone: med.pharmacy_phone ?? undefined,
      prescriber_name: med.prescriber ?? undefined,
    },
    ctx.userId,
  );

  if (!medRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: medRes.error });
  }

  const summary = [drugName, med.dose].filter(Boolean).join(' ');
  return report({
    tempId: input.tempId,
    status: 'completed',
    summary: summary || 'Medication added',
    medicationId: medRes.data.id,
  });
}

async function processLabResult(
  input: { tempId: string; uri: string; fileName: string },
  ctx: BatchContext,
  report: (r: PhotoProcessingResult) => PhotoProcessingResult,
): Promise<PhotoProcessingResult> {
  const testName = `Lab Result — ${new Date().toLocaleDateString()}`;

  const resultRes = await createResult(
    {
      profileId: ctx.profileId,
      householdId: ctx.householdId,
      resultType: 'lab',
      testName,
      sourceMethod: 'document',
    },
    ctx.userId,
  );
  if (!resultRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: resultRes.error });
  }

  const docRes = await uploadResultDocument({
    resultId: resultRes.data.id,
    profileId: ctx.profileId,
    householdId: ctx.householdId,
    fileUri: input.uri,
    fileName: input.fileName,
    mimeType: 'image/jpeg',
    source: 'photo',
    userId: ctx.userId,
  });
  if (!docRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: docRes.error });
  }

  report({ tempId: input.tempId, status: 'extracting' });

  const extractRes = await triggerResultExtraction({
    resultId: resultRes.data.id,
    profileId: ctx.profileId,
    householdId: ctx.householdId,
    resultType: 'lab',
    documentId: docRes.data.id,
  });

  return report({
    tempId: input.tempId,
    status: 'completed',
    summary: extractRes.success ? 'Lab uploaded — extraction running' : 'Lab uploaded',
    resultId: resultRes.data.id,
  });
}

async function processBilling(
  input: { tempId: string; uri: string; fileName: string; docType: 'bill' | 'eob' },
  ctx: BatchContext,
  report: (r: PhotoProcessingResult) => PhotoProcessingResult,
): Promise<PhotoProcessingResult> {
  const title =
    input.docType === 'eob'
      ? `EOB — ${new Date().toLocaleDateString()}`
      : `Bill — ${new Date().toLocaleDateString()}`;

  const caseRes = await createBillingCase(
    { profileId: ctx.profileId, householdId: ctx.householdId, title },
    ctx.userId,
  );
  if (!caseRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: caseRes.error });
  }

  const docRes = await uploadBillingDocument({
    caseId: caseRes.data.id,
    profileId: ctx.profileId,
    householdId: ctx.householdId,
    docType: input.docType,
    fileUri: input.uri,
    fileName: input.fileName,
    mimeType: 'image/jpeg',
    userId: ctx.userId,
  });
  if (!docRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: docRes.error });
  }

  report({ tempId: input.tempId, status: 'extracting' });

  await triggerDocumentExtraction(
    docRes.data.id,
    caseRes.data.id,
    ctx.profileId,
    ctx.householdId,
  );

  return report({
    tempId: input.tempId,
    status: 'completed',
    summary: input.docType === 'eob' ? 'EOB case opened' : 'Bill case opened',
    billingCaseId: caseRes.data.id,
  });
}

async function processGenericDocument(
  input: {
    tempId: string;
    uri: string;
    fileName: string;
    fileSize: number;
    type: DocumentClassification;
  },
  ctx: BatchContext,
  report: (r: PhotoProcessingResult) => PhotoProcessingResult,
): Promise<PhotoProcessingResult> {
  const artifactRes = await uploadArtifact({
    profileId: ctx.profileId,
    fileName: input.fileName,
    fileUri: input.uri,
    mimeType: 'image/jpeg',
    artifactType: 'document',
    sourceChannel: 'camera',
    fileSizeBytes: input.fileSize,
  });
  if (!artifactRes.success) {
    return report({ tempId: input.tempId, status: 'failed', error: artifactRes.error });
  }

  report({ tempId: input.tempId, status: 'extracting' });

  const extractRes = await triggerExtraction({
    artifactId: artifactRes.data.id,
    profileId: ctx.profileId,
  });

  const intentSheetId = extractRes.success ? extractRes.data.intentSheetId : '';
  const fieldCount = extractRes.success ? extractRes.data.fieldCount : 0;
  const summary = fieldCount > 0 ? `${fieldCount} item${fieldCount === 1 ? '' : 's'} to review` : classificationLabel(input.type);

  return report({
    tempId: input.tempId,
    status: 'completed',
    summary,
    intentSheetId: intentSheetId || undefined,
  });
}

function classificationLabel(c: DocumentClassification): string {
  switch (c) {
    case 'insurance_card':
      return 'Insurance card saved';
    case 'discharge_summary':
      return 'Discharge summary saved';
    case 'prescription':
      return 'Prescription saved';
    default:
      return 'Document saved';
  }
}

/**
 * Process an entire batch of photos in parallel. Each photo reports its
 * progress via onUpdate; the promise resolves when all have finished
 * (success or failure).
 */
export async function processBatchDocuments(
  photos: CapturedPhoto[],
  context: BatchContext,
  onUpdate: OnUpdate,
): Promise<PhotoProcessingResult[]> {
  return Promise.all(photos.map((p) => processPhoto(p, context, onUpdate)));
}
