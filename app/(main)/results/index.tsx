import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  TextInput,
  FlatList,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useResults, useTogglePin } from '@/hooks/useResults';
import { getEffectiveData } from '@/services/results';
import type {
  EffectiveLabData,
  EffectiveImagingData,
  EffectiveOtherData,
} from '@/services/results';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { formatRelativeTime } from '@/lib/utils/relativeTime';
import type {
  ResultItemWithDocCount,
  ResultType,
  ResultStatus,
} from '@/lib/types/results';
import {
  RESULT_TYPE_LABELS,
  RESULT_STATUS_LABELS,
} from '@/lib/types/results';

const TYPE_COLORS: Record<ResultType, string> = {
  lab: '#2563EB',
  imaging: '#7C3AED',
  other: '#0D9488',
};

const STATUS_COLORS: Record<ResultStatus, string> = {
  draft: COLORS.text.tertiary,
  processing: COLORS.primary.DEFAULT,
  needs_review: COLORS.accent.dark,
  ready: COLORS.success.DEFAULT,
  archived: COLORS.text.tertiary,
};

type TypeFilter = 'all' | ResultType;
type StatusFilter = 'all' | 'needs_review' | 'ready';
type TimeFilter = 'all' | '30d' | '90d' | '1y';
type SortOption = 'newest' | 'oldest' | 'name_asc' | 'name_desc';

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name_asc: 'Name A–Z',
  name_desc: 'Name Z–A',
};

const TIME_LABELS: Record<TimeFilter, string> = {
  '30d': '30 days',
  '90d': '3 months',
  '1y': '1 year',
  all: 'All time',
};

const TIME_WINDOW_MS: Record<Exclude<TimeFilter, 'all'>, number> = {
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

export default function ResultsListScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: results, isLoading, refetch, error } = useResults(activeProfileId);
  const togglePinMutation = useTogglePin();
  const [refreshing, setRefreshing] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const hasActiveFilters =
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    timeFilter !== 'all' ||
    debouncedSearch.length > 0;

  const clearFilters = () => {
    setTypeFilter('all');
    setStatusFilter('all');
    setTimeFilter('all');
    setSearchText('');
  };

  const filtered = useMemo(() => {
    const list = results ?? [];
    const now = Date.now();

    const afterFilters = list.filter((r) => {
      if (typeFilter !== 'all' && r.result_type !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;

      if (timeFilter !== 'all') {
        const ref = r.performed_at ?? r.reported_at ?? r.created_at;
        const t = new Date(ref).getTime();
        if (isNaN(t)) return false;
        if (now - t > TIME_WINDOW_MS[timeFilter]) return false;
      }

      if (debouncedSearch.length > 0) {
        const haystack = [
          r.test_name,
          r.facility,
          r.ordering_clinician,
          r.raw_text,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(debouncedSearch)) return false;
      }

      return true;
    });

    const getSortDate = (r: ResultItemWithDocCount): number => {
      const ref = r.performed_at ?? r.reported_at ?? r.created_at;
      const t = new Date(ref).getTime();
      return isNaN(t) ? 0 : t;
    };

    return [...afterFilters].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      switch (sortBy) {
        case 'newest':
          return getSortDate(b) - getSortDate(a);
        case 'oldest':
          return getSortDate(a) - getSortDate(b);
        case 'name_asc':
          return a.test_name.localeCompare(b.test_name, undefined, { sensitivity: 'base' });
        case 'name_desc':
          return b.test_name.localeCompare(a.test_name, undefined, { sensitivity: 'base' });
      }
    });
  }, [results, typeFilter, statusFilter, timeFilter, debouncedSearch, sortBy]);

  const handleLongPress = useCallback(
    (item: ResultItemWithDocCount) => {
      const action = item.is_pinned ? 'Unpin' : 'Pin';
      Alert.alert(
        item.test_name,
        item.is_pinned ? 'Remove this result from the top of the list?' : 'Pin this result to the top of the list?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: action,
            onPress: () =>
              togglePinMutation.mutate({ resultId: item.id, isPinned: !item.is_pinned }),
          },
        ],
      );
    },
    [togglePinMutation],
  );

  if (isLoading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <HeaderRow
        onBack={() => router.back()}
        onAdd={() => router.push('/(main)/results/add')}
        onAsk={() => router.push({ pathname: '/(main)/ask', params: { domain: 'results' } })}
      />
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading results...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <HeaderRow
        onBack={() => router.back()}
        onAdd={() => router.push('/(main)/results/add')}
        onAsk={() => router.push({ pathname: '/(main)/ask', params: { domain: 'results' } })}
      />
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={36} color={COLORS.text.tertiary} />
          <Text style={styles.errorText}>Couldn't load your results.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const allEmpty = (results ?? []).length === 0;
  const totalCount = (results ?? []).length;
  const visibleCount = filtered.length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <HeaderRow
        onBack={() => router.back()}
        onAdd={() => router.push('/(main)/results/add')}
        onAsk={() => router.push({ pathname: '/(main)/ask', params: { domain: 'results' } })}
      />

      {allEmpty ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary.DEFAULT} />
          }
        >
          <View style={styles.section}>
            <Card>
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="flask-outline"
                  size={48}
                  color={COLORS.text.tertiary}
                  style={styles.emptyIcon}
                />
                <Text style={styles.emptyText}>No results yet</Text>
                <Text style={styles.emptySubtext}>
                  Add your first lab result, imaging report, or test result.
                </Text>
                <TouchableOpacity
                  style={styles.emptyCta}
                  onPress={() => router.push('/(main)/results/add')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyCtaText}>Add a Result</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary.DEFAULT} />
          }
          ListHeaderComponent={
            <ListHeader
              searchText={searchText}
              onSearchChange={setSearchText}
              onClearSearch={() => setSearchText('')}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortMenuOpen={sortMenuOpen}
              setSortMenuOpen={setSortMenuOpen}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              timeFilter={timeFilter}
              setTimeFilter={setTimeFilter}
              showCount={hasActiveFilters}
              visibleCount={visibleCount}
              totalCount={totalCount}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <ResultCard
                item={item}
                onPress={() => router.push(`/(main)/results/${item.id}`)}
                onLongPress={() => handleLongPress(item)}
              />
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.section}>
              <Card>
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="funnel-outline"
                    size={40}
                    color={COLORS.text.tertiary}
                    style={styles.emptyIcon}
                  />
                  <Text style={styles.emptyText}>No results match your filters</Text>
                  <Text style={styles.emptySubtext}>
                    Try broadening your search or clear the filters below.
                  </Text>
                  <TouchableOpacity
                    style={styles.clearFiltersButton}
                    onPress={clearFilters}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.clearFiltersText}>Clear filters</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ── Header / Filters ────────────────────────────────────────────────────────

function HeaderRow({
  onBack,
  onAdd,
  onAsk,
}: {
  onBack: () => void;
  onAdd: () => void;
  onAsk: () => void;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Results</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={onAsk}
            style={styles.askButton}
            activeOpacity={0.7}
            accessibilityLabel="Ask CareLead about results"
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.askButtonText}>Ask</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onAdd} style={styles.addButton} activeOpacity={0.7}>
            <Ionicons name="add" size={24} color={COLORS.text.inverse} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

interface ListHeaderProps {
  searchText: string;
  onSearchChange: (v: string) => void;
  onClearSearch: () => void;
  sortBy: SortOption;
  setSortBy: (s: SortOption) => void;
  sortMenuOpen: boolean;
  setSortMenuOpen: (v: boolean) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (f: TypeFilter) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  timeFilter: TimeFilter;
  setTimeFilter: (f: TimeFilter) => void;
  showCount: boolean;
  visibleCount: number;
  totalCount: number;
}

function ListHeader({
  searchText,
  onSearchChange,
  onClearSearch,
  sortBy,
  setSortBy,
  sortMenuOpen,
  setSortMenuOpen,
  typeFilter,
  setTypeFilter,
  statusFilter,
  setStatusFilter,
  timeFilter,
  setTimeFilter,
  showCount,
  visibleCount,
  totalCount,
}: ListHeaderProps) {
  return (
    <View>
      {/* Search + Sort row */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons
            name="search-outline"
            size={16}
            color={COLORS.text.tertiary}
            style={styles.searchIcon}
          />
          <TextInput
            value={searchText}
            onChangeText={onSearchChange}
            placeholder="Search tests, facility, clinician"
            placeholderTextColor={COLORS.text.tertiary}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={onClearSearch} style={styles.searchClear} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={16} color={COLORS.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => setSortMenuOpen(!sortMenuOpen)}
          style={[styles.sortButton, sortMenuOpen && styles.sortButtonActive]}
          activeOpacity={0.7}
        >
          <Ionicons
            name="swap-vertical-outline"
            size={18}
            color={sortMenuOpen ? COLORS.primary.DEFAULT : COLORS.text.secondary}
          />
        </TouchableOpacity>
      </View>

      {sortMenuOpen && (
        <View style={styles.sortMenu}>
          {(Object.keys(SORT_LABELS) as SortOption[]).map((key) => (
            <TouchableOpacity
              key={key}
              onPress={() => {
                setSortBy(key);
                setSortMenuOpen(false);
              }}
              style={styles.sortItem}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.sortItemText,
                  sortBy === key && styles.sortItemTextSelected,
                ]}
              >
                {SORT_LABELS[key]}
              </Text>
              {sortBy === key && (
                <Ionicons name="checkmark" size={16} color={COLORS.primary.DEFAULT} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Type filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRowContent}
        style={styles.chipRow}
      >
        <FilterChip label="All" selected={typeFilter === 'all'} onPress={() => setTypeFilter('all')} />
        <FilterChip label="Labs" selected={typeFilter === 'lab'} onPress={() => setTypeFilter('lab')} />
        <FilterChip label="Imaging" selected={typeFilter === 'imaging'} onPress={() => setTypeFilter('imaging')} />
        <FilterChip label="Other" selected={typeFilter === 'other'} onPress={() => setTypeFilter('other')} />
      </ScrollView>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRowContent}
        style={styles.chipRowTight}
      >
        <FilterChip label="Any status" selected={statusFilter === 'all'} onPress={() => setStatusFilter('all')} />
        <FilterChip
          label="Needs review"
          selected={statusFilter === 'needs_review'}
          onPress={() => setStatusFilter('needs_review')}
        />
        <FilterChip
          label="Ready"
          selected={statusFilter === 'ready'}
          onPress={() => setStatusFilter('ready')}
        />
      </ScrollView>

      {/* Time filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRowContent}
        style={styles.chipRowTight}
      >
        <FilterChip
          label={TIME_LABELS['30d']}
          selected={timeFilter === '30d'}
          onPress={() => setTimeFilter('30d')}
        />
        <FilterChip
          label={TIME_LABELS['90d']}
          selected={timeFilter === '90d'}
          onPress={() => setTimeFilter('90d')}
        />
        <FilterChip
          label={TIME_LABELS['1y']}
          selected={timeFilter === '1y'}
          onPress={() => setTimeFilter('1y')}
        />
        <FilterChip
          label={TIME_LABELS.all}
          selected={timeFilter === 'all'}
          onPress={() => setTimeFilter('all')}
        />
      </ScrollView>

      {showCount && (
        <Text style={styles.countLine}>
          Showing {visibleCount} of {totalCount} results
        </Text>
      )}
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.filterChip, selected && styles.filterChipSelected]}
    >
      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Result Card ─────────────────────────────────────────────────────────────

function getResultPreview(item: ResultItemWithDocCount): string | null {
  const effective = getEffectiveData({
    result_type: item.result_type,
    structured_data: item.structured_data,
    user_corrections: item.user_corrections,
  });
  if (!effective) return null;

  if (item.result_type === 'lab') {
    const lab = effective as EffectiveLabData;
    const analytes = lab.analytes.slice(0, 2);
    if (analytes.length === 0) return null;
    return analytes
      .map((a) => {
        const val = a.value != null ? `${a.value}${a.unit ? ' ' + a.unit : ''}` : '';
        return val ? `${a.name}: ${val}` : a.name;
      })
      .join(' | ');
  }

  if (item.result_type === 'imaging') {
    const img = effective as EffectiveImagingData;
    const line = img.impression?.split('\n')[0]?.trim();
    return line && line.length > 0 ? line : null;
  }

  const other = effective as EffectiveOtherData;
  const line = other.summary?.split('\n')[0]?.trim();
  return line && line.length > 0 ? line : null;
}

function getRelativeDate(item: ResultItemWithDocCount): string | null {
  const ref = item.performed_at ?? item.reported_at;
  if (!ref) return null;
  // Date-only columns (YYYY-MM-DD) → interpret as local midnight for nicer relative text.
  return formatRelativeTime(ref + 'T00:00:00');
}

function ResultCard({
  item,
  onPress,
  onLongPress,
}: {
  item: ResultItemWithDocCount;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const typeColor = TYPE_COLORS[item.result_type];
  const statusColor = STATUS_COLORS[item.status];
  const preview = getResultPreview(item);
  const dateStr = getRelativeDate(item);
  const showStatus = item.status === 'needs_review';

  return (
    <Card style={styles.resultCard} onPress={onPress} onLongPress={onLongPress} delayLongPress={400}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, { backgroundColor: typeColor + '1A' }]}>
          <Text style={[styles.typeBadgeText, { color: typeColor }]}>
            {RESULT_TYPE_LABELS[item.result_type]}
          </Text>
        </View>
        {item.is_pinned && (
          <Ionicons name="pin" size={14} color={COLORS.accent.dark} style={styles.pinIcon} />
        )}
        {showStatus && (
          <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusPillText, { color: statusColor }]}>
              {RESULT_STATUS_LABELS[item.status]}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.testName} numberOfLines={2}>
        {item.test_name}
      </Text>

      {preview && (
        <Text style={styles.preview} numberOfLines={2}>
          {preview}
        </Text>
      )}

      <View style={styles.metaRow}>
        {dateStr && <Text style={styles.metaText}>{dateStr}</Text>}
        {item.facility && (
          <>
            {dateStr && <Text style={styles.metaDot}>·</Text>}
            <Text style={styles.metaText} numberOfLines={1}>
              {item.facility}
            </Text>
          </>
        )}
        {item.document_count > 0 && (
          <>
            {(dateStr || item.facility) && <Text style={styles.metaDot}>·</Text>}
            <View style={styles.docCount}>
              <Ionicons name="attach-outline" size={12} color={COLORS.text.tertiary} />
              <Text style={styles.metaText}>{item.document_count}</Text>
            </View>
          </>
        )}
      </View>
    </Card>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  scrollContent: { paddingBottom: 40 },
  listContent: { paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  retryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginLeft: -4,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  askButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  askButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },

  // Search + Sort
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 12,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    padding: 0,
  },
  searchClear: {
    padding: 2,
  },
  sortButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  sortButtonActive: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  sortMenu: {
    marginHorizontal: 24,
    marginTop: 6,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    overflow: 'hidden',
  },
  sortItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sortItemText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  sortItemTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Filter chips rows
  chipRow: {
    marginTop: 12,
  },
  chipRowTight: {
    marginTop: 6,
  },
  chipRowContent: {
    paddingHorizontal: 24,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  filterChipSelected: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  filterChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  filterChipTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  countLine: {
    paddingHorizontal: 24,
    marginTop: 10,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },

  section: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  cardWrap: {
    paddingHorizontal: 24,
    marginTop: 10,
  },

  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIcon: { marginBottom: 16 },
  emptyText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  emptyCta: {
    marginTop: 20,
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  clearFiltersText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Result card
  resultCard: {},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  typeBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  pinIcon: {
    marginLeft: -2,
  },
  statusPill: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  testName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  preview: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  metaDot: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  docCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
