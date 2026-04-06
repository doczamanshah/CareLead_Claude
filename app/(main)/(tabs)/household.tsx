import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { EmptyState } from '@/components/ui/EmptyState';

export default function HouseholdScreen() {
  return (
    <ScreenLayout title="Household">
      <EmptyState
        title="No profiles yet"
        description="Add yourself or a family member to start building a health profile."
      />
    </ScreenLayout>
  );
}
