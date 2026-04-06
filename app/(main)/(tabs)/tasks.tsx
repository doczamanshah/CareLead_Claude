import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { EmptyState } from '@/components/ui/EmptyState';

export default function TasksScreen() {
  return (
    <ScreenLayout title="Tasks & Reminders">
      <EmptyState
        title="No tasks yet"
        description="Tasks will appear here as you capture and process health documents."
      />
    </ScreenLayout>
  );
}
