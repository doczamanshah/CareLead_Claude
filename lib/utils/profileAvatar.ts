import { COLORS } from '@/lib/constants/colors';
import type { Profile, RelationshipLabel } from '@/lib/types/profile';

const AVATAR_PALETTE = [
  COLORS.primary.DEFAULT,
  COLORS.secondary.DEFAULT,
  COLORS.accent.dark,
  COLORS.tertiary.DEFAULT,
  COLORS.primary.light,
  COLORS.secondary.dark,
];

export function getAvatarInitial(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

/**
 * Deterministic color per profile — so the same profile always shows the same
 * colour in the switcher, family list, and header avatar.
 */
export function getAvatarColor(profileId: string | null | undefined): string {
  if (!profileId) return COLORS.primary.DEFAULT;
  let hash = 0;
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash * 31 + profileId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx];
}

const RELATIONSHIP_LABELS: Record<RelationshipLabel, string> = {
  self: 'You',
  parent: 'Parent',
  spouse: 'Spouse',
  child: 'Child',
  sibling: 'Sibling',
  grandparent: 'Grandparent',
  other: 'Family',
};

export function getRelationshipLabel(profile: Pick<Profile, 'relationship' | 'relationship_label'>): string {
  if (profile.relationship_label && RELATIONSHIP_LABELS[profile.relationship_label]) {
    return RELATIONSHIP_LABELS[profile.relationship_label];
  }
  return profile.relationship === 'self' ? 'You' : 'Family';
}
