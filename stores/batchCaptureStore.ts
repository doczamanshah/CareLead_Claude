import { create } from 'zustand';

export type DocumentClassification =
  | 'insurance_card'
  | 'lab_result'
  | 'medication_label'
  | 'bill'
  | 'eob'
  | 'discharge_summary'
  | 'prescription'
  | 'other';

export interface CapturedPhoto {
  tempId: string;
  uri: string;
  type: DocumentClassification;
}

export type PhotoProcessingStatus =
  | 'pending'
  | 'uploading'
  | 'extracting'
  | 'completed'
  | 'failed';

export interface PhotoProcessingResult {
  tempId: string;
  status: PhotoProcessingStatus;
  error?: string;
  summary?: string;
  intentSheetId?: string;
  resultId?: string;
  medicationId?: string;
  billingCaseId?: string;
}

interface BatchCaptureState {
  photos: CapturedPhoto[];
  initialCategories: string[];
  processingResults: PhotoProcessingResult[];
  addPhoto: (photo: CapturedPhoto) => void;
  removePhoto: (tempId: string) => void;
  updatePhotoType: (tempId: string, type: DocumentClassification) => void;
  setInitialCategories: (cats: string[]) => void;
  setProcessingResults: (results: PhotoProcessingResult[]) => void;
  updateProcessingResult: (result: PhotoProcessingResult) => void;
  clear: () => void;
}

export const useBatchCaptureStore = create<BatchCaptureState>((set) => ({
  photos: [],
  initialCategories: [],
  processingResults: [],
  addPhoto: (photo) =>
    set((s) => ({ photos: [...s.photos, photo] })),
  removePhoto: (tempId) =>
    set((s) => ({ photos: s.photos.filter((p) => p.tempId !== tempId) })),
  updatePhotoType: (tempId, type) =>
    set((s) => ({
      photos: s.photos.map((p) => (p.tempId === tempId ? { ...p, type } : p)),
    })),
  setInitialCategories: (cats) => set({ initialCategories: cats }),
  setProcessingResults: (results) => set({ processingResults: results }),
  updateProcessingResult: (result) =>
    set((s) => {
      const existing = s.processingResults.find((r) => r.tempId === result.tempId);
      if (existing) {
        return {
          processingResults: s.processingResults.map((r) =>
            r.tempId === result.tempId ? { ...r, ...result } : r,
          ),
        };
      }
      return { processingResults: [...s.processingResults, result] };
    }),
  clear: () =>
    set({ photos: [], initialCategories: [], processingResults: [] }),
}));
