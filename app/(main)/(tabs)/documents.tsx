import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { EmptyState } from '@/components/ui/EmptyState';

export default function DocumentsScreen() {
  return (
    <ScreenLayout title="Documents">
      <EmptyState
        title="No documents yet"
        description="Capture photos, upload files, or record voice notes to get started."
      />
    </ScreenLayout>
  );
}
