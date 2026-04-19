import { create } from 'zustand';
import type {
  HealthSummaryExtraction,
  DuplicateMap,
  ImportSelection,
  ImportCounts,
} from '@/services/healthSummaryImport';
import { makeEmptySelection } from '@/services/healthSummaryImport';

interface HealthSummaryImportState {
  artifactId: string | null;
  fileName: string | null;
  extraction: HealthSummaryExtraction | null;
  duplicates: DuplicateMap | null;
  selection: ImportSelection;
  importedCounts: ImportCounts | null;

  setArtifact(artifactId: string, fileName: string): void;
  setExtraction(extraction: HealthSummaryExtraction): void;
  setDuplicates(duplicates: DuplicateMap): void;
  setSelection(selection: ImportSelection): void;
  setImportedCounts(counts: ImportCounts): void;
  clear(): void;
}

export const useHealthSummaryImportStore = create<HealthSummaryImportState>((set) => ({
  artifactId: null,
  fileName: null,
  extraction: null,
  duplicates: null,
  selection: makeEmptySelection(),
  importedCounts: null,

  setArtifact: (artifactId, fileName) => set({ artifactId, fileName }),
  setExtraction: (extraction) => set({ extraction }),
  setDuplicates: (duplicates) => set({ duplicates }),
  setSelection: (selection) => set({ selection }),
  setImportedCounts: (importedCounts) => set({ importedCounts }),
  clear: () =>
    set({
      artifactId: null,
      fileName: null,
      extraction: null,
      duplicates: null,
      selection: makeEmptySelection(),
      importedCounts: null,
    }),
}));
