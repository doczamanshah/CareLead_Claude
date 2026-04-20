# CLAUDE.md — CareLead Architectural Constitution

> **Read this file completely before making any changes to the codebase.**
> This document is the single source of truth for architecture, conventions, and patterns.
> Every file you create, every function you write, every component you build must follow these rules.

---

## Project Overview

**CareLead** — "Your care. In your hands."

CareLead is a patient-owned, AI-first care operations platform that helps patients and caregivers manage healthcare administration. It turns fragmented health information (bills, lab results, discharge papers, medication bottles, appointment notes) into structured, actionable, trackable workflows.

**What CareLead IS:** A healthcare admin companion that captures, organizes, and drives follow-through.
**What CareLead is NOT:** A diagnostic tool, medical advice system, or clinical decision support.

### Core Philosophy
- **Patient-owned interoperability** — data flows with the patient because they control it
- **AI-first, not AI-autonomous** — AI drafts, the user confirms. Nothing is silently committed.
- **Patient-voice-first** — AI suggestions are always secondary to the patient's own words and concerns
- **Execution over storage** — every piece of information should become an actionable step
- **Trust through transparency** — provenance, confidence labels, and audit trails are product features

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Client | Expo SDK 54 with React Native + TypeScript | Mobile app (iOS-first, Android soon after) |
| Navigation | Expo Router v4 (file-based routing) | Screen navigation |
| Server State | TanStack Query (React Query) v5 | Data fetching, caching, sync |
| Client State | Zustand | Local app state (active profile, UI state) |
| Backend | Supabase | Auth, Postgres DB, Storage, Edge Functions |
| ORM/Query | Supabase JS Client v2 | Type-safe database queries |
| AI | Anthropic Claude API (via Edge Functions) | Extraction, visit prep, smart features |
| AI Model | `claude-sonnet-4-20250514` | Used in all Edge Functions |
| Forms | React Hook Form + Zod | Form handling and validation |
| Icons | Ionicons via `@expo/vector-icons` | Consistent iconography throughout the app |
| Gradients | `expo-linear-gradient` | Hero header on Home screen |
| Date Picker | `@react-native-community/datetimepicker` | Wrapped in reusable `DatePicker` component |
| Styling | React Native `StyleSheet.create` + color constants | Consistent styling — no CSS-in-JS libraries |

### Key Rules
- **Never call AI APIs directly from the mobile app.** Always go through Supabase Edge Functions.
- **Never store API keys, secrets, or credentials in code.** Use environment variables only.
- **TypeScript strict mode is always on.** No `any` types. No `@ts-ignore` unless absolutely necessary with a comment explaining why.
- **All styling uses `StyleSheet.create()` with color constants from `lib/constants/colors.ts`.** No NativeWind, no Tailwind className syntax. Note: `nativewind`, `tailwindcss`, `tailwind.config.js`, `global.css`, and `nativewind-env.d.ts` still exist in the project as dead config — they are unused and can be removed in a cleanup pass.
- **Icons use Ionicons only** (`@expo/vector-icons/Ionicons`). No mixing icon libraries.

---

## Supabase Setup Requirements

### Storage Buckets
All buckets are **private** and must be created manually in the Supabase Dashboard (Storage > New Bucket, private: true). Bucket policies (INSERT/SELECT/DELETE for authenticated users) must be created via the Dashboard UI — not via SQL Editor (the `storage.objects` table has an ownership issue that prevents policy creation via SQL).

| Bucket | Phase | Purpose |
|--------|-------|---------|
| `artifacts` | Phase 1 | All Intent Sheet documents, photos, note artifacts |
| `billing-documents` | Phase 2 | Bills, EOBs, appeal-related documents |
| `result-documents` | Phase 2 | Lab/imaging reports (also used for preventive care proof documents) |

### Edge Function Secrets
The following secrets must be set for Edge Functions:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref ccpxoidlqsolzypmkiul
```

Secret names are **case-sensitive** — `ANTHROPIC_API_KEY` must match exactly what the Edge Function reads via `Deno.env.get('ANTHROPIC_API_KEY')`.

### Edge Function Deployment
Deploy Edge Functions with JWT verification disabled (required for the current architecture):
```bash
supabase functions deploy extract-document --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
supabase functions deploy process-visit-prep --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
supabase functions deploy extract-billing --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
supabase functions deploy generate-appeal-letter --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
supabase functions deploy extract-result --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
supabase functions deploy extract-preventive-date --no-verify-jwt --project-ref ccpxoidlqsolzypmkiul
```

---

## Folder Structure

```
carelead/
├── CLAUDE.md                         # THIS FILE — read first, always
├── app.json                          # Expo configuration
├── package.json
├── package-lock.json
├── tsconfig.json
├── metro.config.js                   # Metro bundler configuration
├── .env.local                        # Local environment variables (NEVER commit)
├── .gitignore
├── tailwind.config.js                # UNUSED — legacy from abandoned NativeWind setup
├── global.css                        # UNUSED — legacy from abandoned NativeWind setup
├── nativewind-env.d.ts               # UNUSED — legacy from abandoned NativeWind setup
│
├── app/                              # ALL SCREENS (Expo Router file-based routing)
│   ├── _layout.tsx                   # Root layout (providers, auth gate)
│   ├── index.tsx                     # Entry redirect
│   ├── (auth)/                       # Auth screens
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (main)/                       # Authenticated app shell
│   │   ├── _layout.tsx               # Main layout wrapper
│   │   ├── today.tsx                 # Today Detail screen (all today's items expanded)
│   │   ├── (tabs)/                   # Bottom tab screens
│   │   │   ├── _layout.tsx           # Tab bar configuration
│   │   │   ├── index.tsx             # Home screen (5-zone redesign with gradient hero)
│   │   │   ├── tasks.tsx             # Tasks & Reminders (priority + action plan views)
│   │   │   ├── documents.tsx         # Documents & Exports
│   │   │   ├── household.tsx         # Household & Profiles
│   │   │   └── settings.tsx          # Settings
│   │   ├── appointments/             # Appointment module screens
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx             # Appointment list (upcoming/past)
│   │   │   ├── create.tsx            # Create new appointment
│   │   │   └── [appointmentId]/
│   │   │       ├── index.tsx         # Appointment detail
│   │   │       ├── plan.tsx          # Visit prep builder (patient-voice-first)
│   │   │       ├── suggest.tsx       # Caregiver suggestion screen
│   │   │       └── closeout.tsx      # Post-visit closeout flow
│   │   ├── medications/              # Medication module screens
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx             # Medication list (active/paused/stopped)
│   │   │   ├── create.tsx            # Add medication (AI-assisted entry)
│   │   │   ├── [medicationId].tsx    # Medication detail & editing
│   │   │   └── refill/
│   │   │       └── [medicationId].tsx  # Refill workflow screen
│   │   ├── caregivers/               # Caregiver module screens
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx             # Caregiver list & access grants
│   │   │   ├── invite.tsx            # Invite caregiver (email or phone)
│   │   │   └── [grantId].tsx         # Manage individual access grant
│   │   ├── profile/                  # Profile module screens
│   │   │   ├── _layout.tsx
│   │   │   └── [profileId]/
│   │   │       ├── _layout.tsx
│   │   │       ├── index.tsx         # Profile overview (facts grouped by category + strengthen card)
│   │   │       ├── edit.tsx          # Edit profile sections
│   │   │       ├── add-fact.tsx      # Add new profile fact
│   │   │       └── strengthen.tsx    # Strengthen Your Profile (fill gaps)
│   │   ├── capture/                  # Data capture screens
│   │   │   ├── _layout.tsx
│   │   │   ├── camera.tsx            # Photo/scan capture (saves as JPEG)
│   │   │   ├── voice.tsx             # Text dictation screen (type or use iOS keyboard dictation)
│   │   │   └── upload.tsx            # Document upload (PDF/image picker)
│   │   ├── intent-sheet/             # Intent Sheet review screens
│   │   │   └── [intentSheetId].tsx   # Review and confirm extracted data
│   │   └── tasks/                    # Task management screens
│   │       ├── _layout.tsx
│   │       ├── [taskId].tsx          # Task detail/edit screen
│   │       └── create.tsx            # Create new task form
│
├── components/                       # REUSABLE UI COMPONENTS
│   ├── ui/                           # Generic, module-agnostic components
│   │   ├── Button.tsx                # Primary/secondary/outline/ghost variants, sm/md/lg sizes
│   │   ├── Card.tsx                  # White card with shadow, optional onPress
│   │   ├── DatePicker.tsx            # Cross-platform date/time/datetime picker
│   │   ├── Input.tsx                 # Text input with label, error, focus states
│   │   ├── EmptyState.tsx            # Empty state placeholder
│   │   ├── LoadingSpinner.tsx        # Loading indicator
│   │   └── ScreenLayout.tsx          # Consistent screen wrapper (SafeArea, scroll, keyboard)
│   └── modules/                      # Module-specific compound components
│       ├── ProfileCard.tsx           # Profile summary card
│       └── DocumentCard.tsx          # Document/artifact display card
│
├── hooks/                            # CUSTOM REACT HOOKS
│   ├── useActiveProfile.ts           # Get/set the currently active profile
│   ├── useAuth.ts                    # Authentication state and actions
│   ├── useProfiles.ts                # List profiles in household
│   ├── useProfileDetail.ts           # Fetch profile with facts
│   ├── useIntentSheet.ts             # Intent sheet fetch and trigger extraction
│   ├── useArtifacts.ts               # Upload and create note artifacts
│   ├── useCommitIntentSheet.ts       # Commit accepted intent items (tasks auto-generated silently)
│   ├── useTasks.ts                   # Task CRUD, chains, assignment with TanStack Query
│   ├── useProactiveChecks.ts         # Proactive task suggestions with daily cooldown
│   ├── usePreferences.ts             # User preferences (care guidance level, weekly digest)
│   ├── useProfileGaps.ts             # Profile gap analysis and filling
│   ├── useAppointments.ts            # Appointment CRUD, visit prep, caregiver suggestions, visit packet
│   ├── useMedications.ts             # Medication CRUD, supply, sigs, adherence, refill status
│   ├── useCaregivers.ts              # Access grants, invites, consent history, permissions
│   └── useCloseout.ts                # Post-visit closeout flow (summary, outcomes, finalization)
│
├── services/                         # API/DATABASE CALLS (organized by module)
│   ├── auth.ts                       # Authentication service
│   ├── profiles.ts                   # Profile CRUD operations
│   ├── profileFactUpsert.ts          # Profile fact upsert with change tracking (used by commit + closeout)
│   ├── artifacts.ts                  # Document/artifact upload and creation
│   ├── extraction.ts                 # AI extraction pipeline calls
│   ├── commit.ts                     # Commit engine — SINGLE source of task generation, context gates, dedup
│   ├── tasks.ts                      # Task CRUD operations with assignment support
│   ├── taskChains.ts                 # Task chain creation, progression, and recurrence
│   ├── proactiveChecks.ts            # Proactive task suggestions (refills, appointments, overdue, stale)
│   ├── preferences.ts                # User preferences CRUD (care guidance, weekly digest)
│   ├── profileGaps.ts                # Profile Intelligence — gap analysis and filling
│   ├── appointments.ts               # Appointment CRUD, visit prep saving, caregiver suggestions
│   ├── appointmentPlanGenerator.ts   # Pure function: appointment + profile facts + caregivers → VisitPrep
│   ├── visitPrepProcessor.ts         # Patient free-text → structured VisitPrep via Edge Function
│   ├── visitPacket.ts                # Visit Packet generator (plain-text for printing/sharing)
│   ├── closeout.ts                   # Post-visit closeout pipeline (summary, outcomes, finalization)
│   ├── medications.ts                # Medication CRUD, supply/sig updates, adherence, refill checks
│   ├── medicationMigration.ts        # One-time migration: profile_facts → med_medications
│   ├── medicationSync.ts             # Syncs extracted medications from Intent Sheet commit → med_medications
│   └── caregivers.ts                 # Access grants, invites (email/phone), consent history, permissions
│
├── stores/                           # ZUSTAND STORES (client-side state only)
│   ├── authStore.ts                  # Session, user object
│   ├── profileStore.ts               # Active profile ID, profile switching
│   └── uiStore.ts                    # UI state (modals, toasts, loading)
│
├── lib/                              # CORE UTILITIES AND CONFIGURATION
│   ├── supabase.ts                   # Supabase client initialization
│   ├── types/                        # TypeScript type definitions
│   │   ├── profile.ts                # Profile, Household, ProfileFact, ProfileFactCategory
│   │   ├── artifacts.ts              # Artifact, ArtifactWithUrl, upload params
│   │   ├── intent-sheet.ts           # IntentSheet, IntentItem, status enums
│   │   ├── tasks.ts                  # Task, CreateTaskParams, TaskFilter, TaskChainTemplate, ProactiveSuggestion
│   │   ├── appointments.ts           # Appointment, VisitPrep, VisitPrepQuestion, Closeout, Outcome, CaregiverSuggestion
│   │   ├── medications.ts            # Medication, MedicationSig, MedicationSupply, AdherenceEvent, RefillStatus, TodaysDose
│   │   └── caregivers.ts             # AccessGrant, ConsentRecord, CaregiverInvite, PermissionScope, PermissionTemplateId
│   ├── utils/
│   │   ├── formatProfileFact.ts      # Category-aware profile fact display formatting
│   │   ├── fieldLabels.ts            # Human-readable labels for field keys
│   │   ├── notifications.ts          # Push notification scheduling utilities
│   │   └── medicalInference.ts       # Smart defaults for medications and conditions (data entry assistance)
│   └── constants/
│       ├── colors.ts                 # COLORS object — design system colors
│       ├── typography.ts             # FONT_SIZES, FONT_WEIGHTS, LINE_HEIGHTS
│       ├── config.ts                 # App configuration values
│       ├── taskTemplates.ts          # Pre-built task chain templates (NEW_MEDICATION_CHAIN, POST_VISIT_CHAIN, etc.)
│       ├── appointmentTemplates.ts   # Appointment type templates (default_purpose, fallback_questions)
│       └── permissionTemplates.ts    # 6 permission templates with scopes (full_helper, view_only, etc.)
│
├── assets/                           # Static assets
│   ├── icon.png
│   ├── adaptive-icon.png
│   ├── favicon.png
│   └── splash-icon.png
│
└── supabase/                         # SUPABASE BACKEND
    ├── migrations/                   # Database schema migrations (ordered)
    │   ├── 00001_foundation.sql      # Users, households, profiles, profile_facts, artifacts, extracted_fields, intent_sheets, intent_items, tasks, audit_events
    │   ├── 00002_signup_function.sql  # RPC function for user signup (SECURITY DEFINER)
    │   ├── 00003_fix_rls_policies.sql      # RLS policy fixes (v1)
    │   ├── 00003_fix_rls_policies_v2.sql   # RLS policy fixes (v2)
    │   ├── 00004_task_enhancements.sql     # Task system: context_json, chains, dependencies, assignment, recurrence, triggers
    │   ├── 00005_user_preferences.sql      # User preferences table
    │   ├── 00006_appointments.sql          # apt_appointments, apt_plan_items, apt_closeouts, apt_outcomes
    │   ├── 00007_visit_prep.sql            # prep_json column on apt_appointments
    │   ├── 00008_medications.sql           # med_medications, med_medication_sigs, med_medication_supply, med_adherence_events
    │   ├── 00009_caregivers.sql            # profile_access_grants, consent_records, caregiver_invites
    │   └── 00010_invite_phone.sql          # invited_phone column + email made optional on caregiver_invites
    └── functions/                    # Edge Functions (server-side code)
        ├── _shared/
        │   └── cors.ts               # Shared CORS headers
        ├── extract-document/
        │   └── index.ts              # AI document extraction via Claude API
        └── process-visit-prep/
            └── index.ts              # Patient free-text → structured visit prep via Claude API
```

### Folder Rules
- **Screens go in `app/` only.** Never put screen components elsewhere.
- **Reusable components go in `components/`.** If it's used on more than one screen, extract it.
- **Data fetching logic goes in `services/`.** Components never call Supabase directly.
- **Hooks wrap services for React components.** Hooks call services; components call hooks.
- **Types go in `lib/types/`.** Never define types inline unless they're component-only props.
- **No cross-module imports in services.** `services/medications.ts` must not import from `services/appointments.ts`. Shared logic goes in a shared service (e.g., `profileFactUpsert.ts`).

---

## The Canonical Data Flow

**This is the most important pattern in the entire codebase.** Every module follows this flow:

```
CAPTURE → ARTIFACT → PROCESS → INTENT SHEET → COMMIT → ACTION
```

### Step by step:

1. **CAPTURE**: User provides input via one of three methods:
   - **Camera** (`capture/camera.tsx`): Takes a photo, saved as JPEG (not HEIC — Claude API doesn't support HEIC)
   - **Text dictation** (`capture/voice.tsx`): User types text or uses iOS keyboard dictation. Saved as a note artifact with `ocr_text` populated directly — no audio file is uploaded.
   - **Document upload** (`capture/upload.tsx`): User picks a PDF or image file from their device
2. **ARTIFACT**: Input is stored as a canonical artifact in Supabase:
   - File artifacts (photo/upload): file uploaded to `artifacts` storage bucket, metadata in `artifacts` table
   - Note artifacts (text dictation): no file upload, text stored directly in `artifacts.ocr_text`
3. **PROCESS**: The `extract-document` Edge Function runs AI extraction via Claude API → produces structured entries with confidence scores and evidence
4. **INTENT SHEET**: Extracted entries are stored as `intent_items` in an `intent_sheet` (status: `pending_review`), presented to user for review. **Only data items** — no task suggestions in the Intent Sheet.
5. **COMMIT**: User reviews each item (accept / edit+accept / reject). Accepted items are committed atomically via `services/commit.ts`:
   - Profile facts are created/updated in the `profile_facts` table
   - Medications are synced to `med_medications` via `medicationSync.ts`
   - Tasks are auto-generated silently based on care guidance level, with context gates and deduplication
   - A Smart Follow-Up card appears asking for optional enrichment data
   - Audit events are logged
6. **ACTION**: Committed items appear in the Profile overview, grouped by category. Profile gaps feed into the "Strengthen Your Profile" system.

### Rules for this flow:
- **Nothing becomes verified data without user confirmation.** No exceptions.
- **AI outputs are always "suggestions" until committed.** They live in `extracted_fields` and `intent_items`, never in profile fact tables.
- **Commits are atomic.** If 5 items are accepted, all 5 are written in a single transaction. If one fails, none persist.
- **Every commit creates audit events.** No silent writes.

---

## Home Screen Architecture (5-Zone Layout)

The Home screen (`app/(main)/(tabs)/index.tsx`) uses a 5-zone vertical layout:

### Zone 1: Hero Header (Gradient)
- **LinearGradient**: diagonal from `primary.DEFAULT` → `primary.light` → `secondary.dark`
- Time-based greeting ("Good morning" / "Good afternoon" / "Good evening")
- Profile name with chevron for navigation
- Tagline: "Your care. In your hands."
- Profile switcher avatars (only visible when multiple profiles exist)

### Zone 2: Today's Briefing Card
- Card with 4px left accent bar (`secondary` color)
- Dynamic content: all-clear state (checkmark icon) OR list of items (meds due, next appointment, tasks due, items needing attention)
- Briefing aggregates items from multiple modules via per-module briefing services (`services/billingBriefing.ts`, `services/resultsBriefing.ts`, `services/preventiveBriefing.ts`, plus tasks/appointments/meds)
- "View details" link navigates to the Today Detail screen (`/(main)/today`)

### Zone 3: Quick Actions
- Horizontal scroll of 5 action cards: Take Photo, Add Document, Voice Note, New Task, New Appointment
- Each card: icon in a light circle, subtle border, `secondary.DEFAULT + '14'` background (8% opacity)

### Zone 4: Module Shortcuts
- Horizontal scroll of module cards with dynamic stat badges
- Cards: Medications (`medkit`), Appointments (`calendar`), Care Team (`people`), Documents (`document-text`), Bills (`receipt-outline`), Results (`flask-outline`), Preventive Care (`shield-checkmark-outline`)
- Each shows: icon, label, dynamic stat (e.g., "5 active", "2 upcoming", "3 due", "1 needs review")

### Zone 5: Body Container
- 24px horizontal padding, `COLORS.background.DEFAULT` (#F8F9FA) background
- Houses Zones 2–4 content

### Today Detail Screen (`app/(main)/today.tsx`)
Expanded view of today's items with sections:
1. **Medications** — today's scheduled doses with Take/Skip buttons
2. **Appointments** — today/tomorrow with prep status indicators
3. **Tasks** — overdue + due today, priority-sorted
4. **Bills** — open cases with pending actions, reconciliation findings, upcoming payments
5. **Results** — items needing review, pinned results, recently added
6. **Preventive Care** — items due / due soon, needs_review items
7. **Needs Attention** — post-visit closeouts + high-priority profile gaps
8. **All Clear** — success state when nothing is pending

---

## Styling Architecture

### Design System Colors (`lib/constants/colors.ts`)
```
PRIMARY (Teal):    #0C3B2E (dark), #1A5C47 (default), lighter variants
SECONDARY (Sage):  #6D9773 (default), #8DB393 (light), #547A59 (dark)
ACCENT (Gold):     #FFBA00 (default), #FFCB3D (light), #CC9500 (dark)
TERTIARY (Orange):  #B46617 (default), #D4841F (light), #8E5012 (dark)
BACKGROUND:        #F8F9FA (default), #FFFFFF (secondary)
SURFACE:           #FFFFFF (default/elevated), #F1F3F5 (muted)
TEXT:              #1A1A1A (default), #6B7280 (secondary), #9CA3AF (tertiary), #FFFFFF (inverse)
ERROR:             #DC2626 (red), #FEE2E2 (light)
SUCCESS:           #16A34A (green), #DCFCE7 (light)
WARNING:           #F59E0B (amber), #FEF3C7 (light)
BORDERS:           #E5E7EB (default), #F3F4F6 (light), #D1D5DB (dark)
```

### Card Shadows
Standard card shadow used across the app:
```javascript
{
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,   // Android
}
```
Variations by context: subtle (0.05 opacity), medium (0.2, elevation 6), heavy (0.25, elevation 4).

### Color Opacity Technique
Backgrounds use hex opacity notation: `COLORS.secondary.DEFAULT + '14'` = 8% opacity. Common values: `'0D'` (5%), `'14'` (8%), `'1A'` (10%), `'20'` (13%), `'33'` (20%).

### Ionicons Usage
All icons use `Ionicons` from `@expo/vector-icons`. Common icons:
- Navigation: `chevron-back`, `chevron-forward`
- Actions: `camera`, `document-text`, `mic`, `add-circle`
- Status: `checkmark-circle`, `alert-circle`, `warning`
- Modules: `medkit` (meds), `calendar` (appointments), `people` (care team)
- Sizes: headers 18–24px, cards 18–22px, inline 14–16px

### Typography (`lib/constants/typography.ts`)
```
FONT_SIZES: xs(12), sm(14), base(16), lg(18), xl(20), 2xl(24), 3xl(30), 4xl(36)
FONT_WEIGHTS: normal('400'), medium('500'), semibold('600'), bold('700')
LINE_HEIGHTS: tight(1.25), normal(1.5), relaxed(1.75)
```
- Section titles: semibold 13px, uppercase, letter-spacing 1px
- Card titles: semibold/medium 15–18px
- Meta text: secondary color, 13px

### Shared Layout Patterns
- **Horizontal padding**: 24px (base for all screens)
- **Border radius**: 12px for cards/inputs, 8px for buttons, 16px for chips
- **Active touch opacity**: 0.7–0.8
- **Gradient**: Only on Home screen hero header (3-color diagonal via `expo-linear-gradient`)

---

## DatePicker Component (`components/ui/DatePicker.tsx`)

Reusable cross-platform date/time picker wrapping `@react-native-community/datetimepicker`.

### Props
- `mode`: `'date'` | `'time'` | `'datetime'` (datetime = two-step: date first, then time on iOS)
- `value`: `Date | null`
- `onChange`: `(date: Date | null) => void`
- `label?`, `placeholder?`, `error?`: standard form field props
- `minimumDate?`, `maximumDate?`: date constraints

### Formatting
- Date: "January 15, 2026"
- Time: "2:30 PM"
- Datetime: "January 15, 2026 at 2:30 PM"

### Behavior
- iOS: Spinner display with Clear/Done/Next buttons in a 200px container
- Android: Native system picker
- Border color reactive: error (red) → focused (primary) → default (gray)

---

## Edge Functions

### 1. `extract-document` — AI Document Extraction
**File**: `supabase/functions/extract-document/index.ts`
**Purpose**: Analyzes healthcare documents (images, PDFs, text notes) and extracts structured healthcare data.

**Request**: `POST { artifactId: string, profileId: string }`
**Response**: `{ intentSheetId: string, documentType: string, fieldCount: number }`

**Flow**:
1. Marks artifact as `processing`
2. For text: sends `ocr_text` directly. For files: downloads via signed URL, converts to base64
3. Claude extracts structured fields with confidence scores
4. Creates `extracted_fields`, `intent_sheet`, and `intent_items`
5. Marks artifact as `completed` with classification

**Extracted field categories**: `medication.entry`, `allergy.entry`, `condition.entry`, `insurance.entry`, `care_team.entry`, `pharmacy.entry`, `surgery.entry`, `family_history.entry`, `emergency_contact.entry`, `lab.entry`, `followup.entry`

**Supported file types**: JPEG, PNG, GIF, WebP, PDF. **NOT supported**: HEIC/HEIF.
**File size limit**: 20MB.

### 2. `process-visit-prep` — Patient-Voice-First Visit Prep
**File**: `supabase/functions/process-visit-prep/index.ts`
**Purpose**: Converts patient free-text input into a structured Visit Prep object, prioritizing the patient's own words.

**Request**: `POST { patientInput: string, profileContext: { display_name, facts[] }, appointmentDetails: { title, appointment_type, provider_name, start_time, purpose } }`

**Response**:
```json
{
  "questions_and_concerns": [{ "text": "...", "source": "patient" }],
  "logistics": { "driver": { "name": null }, "what_to_bring": [], "notes": [], "needs_driver": false, "special_needs": [] },
  "refills_needed": [{ "medication": "...", "reason": "..." }],
  "ai_suggestions": [{ "text": "...", "source": "ai_suggested", "reason": "..." }]
}
```

**Key rules**:
- Patient's voice comes FIRST (source: `"patient"`)
- AI suggestions clearly marked with `"ai_suggested"` source and reason
- Driver info goes to `logistics.driver`, NOT `what_to_bring`
- Never invents symptoms, diagnoses, or medications

### 3. `extract-billing` — Bill & EOB Extraction (Phase 2)
**File**: `supabase/functions/extract-billing/index.ts`
**Purpose**: Analyzes uploaded bills/EOBs OR freeform text about a billing case and extracts structured billing data (totals, line items, provider/payer, dates, denial info).
**Used by**: Bills & EOBs module (document uploads + "Start a New Bill" freeform entry mode).

### 4. `generate-appeal-letter` — Appeal Letter Drafting (Phase 2)
**File**: `supabase/functions/generate-appeal-letter/index.ts`
**Purpose**: Drafts an editable appeal letter from denial context, case details, and patient rationale.
**Used by**: Bills & EOBs appeal packet screen.

### 5. `extract-result` — Lab/Imaging Result Extraction (Phase 2)
**File**: `supabase/functions/extract-result/index.ts`
**Purpose**: Type-aware extraction — labs produce an analyte list with flags and reference ranges; imaging produces findings + impression; "other" produces key findings.
**Used by**: Results module (all three entry modes: type/paste, dictate, upload).

### 6. `extract-preventive-date` — Completion Date Extraction (Phase 2)
**File**: `supabase/functions/extract-preventive-date/index.ts`
**Purpose**: Extracts completion date from an uploaded proof document (e.g., mammogram report) for marking a preventive care item complete.
**Used by**: Preventive Care item detail (mark-complete with document proof).

---

## Extraction Architecture: Structured Entries

The extraction pipeline produces **structured entries**, not fragmented individual fields. Each intent item represents a complete, coherent entity.

### Example: Medication extraction
One intent item contains the full medication as a structured JSON value:
```json
{
  "field_key": "medication",
  "proposed_value": {
    "drug_name": "lisinopril",
    "dose": "25mg",
    "frequency": "once daily",
    "route": "oral"
  },
  "confidence": 0.95,
  "evidence_json": { "source_text": "Lisinopril 25mg PO daily" }
}
```

This is **one** intent item — not four separate items for drug_name, dose, frequency, and route.

### Other structured entry examples:
- **Allergy**: `{ "substance": "penicillin", "reaction": "hives", "severity": "moderate" }`
- **Condition**: `{ "condition_name": "Type 2 Diabetes", "status": "active", "diagnosed_date": "2019" }`
- **Insurance**: `{ "plan_name": "Blue Cross PPO", "member_id": "XYZ123", "group_number": "G456" }`

### Profile Facts Display
Profile facts store their values as structured JSON. The `lib/utils/formatProfileFact.ts` utility provides category-aware formatting — it knows how to render a medication fact differently from an allergy fact or insurance fact. Each category has its own display logic that extracts the title and detail lines from the JSON value.

---

## Seven Shared Primitives

These are built ONCE and reused by every module:

### 1. Artifact Pipeline
- Accepts: photos (JPEG), document uploads (PDF/images), typed text (note artifacts)
- Stores: files in private `artifacts` Supabase Storage bucket, metadata in `artifacts` table
- Note artifacts have no file — text goes directly into `artifacts.ocr_text`
- Processes: extraction via `extract-document` Edge Function
- Status tracking: `pending` → `processing` → `completed` → `failed`
- Key column: `file_size` (not `file_size_bytes`)

### 2. Intent Sheet
- Generated after extraction completes
- Contains `intent_items`, each with:
  - `field_key` (category key like `medication`, `allergy`, `condition`, `insurance`)
  - `proposed_value` (structured JSON object — a complete entry, not a single field)
  - `confidence` (0.0 to 1.0)
  - `evidence_json` (reference to source text in artifact)
  - `status`: `pending` → `accepted` | `edited` | `rejected`
- Sheet statuses: `draft` → `pending_review` → `partially_committed` | `committed` | `dismissed`
- UI component: Intent Sheet review screen renders all items with accept/edit/reject controls

### 3. Commit Engine
- Implemented in `services/commit.ts` with hook `hooks/useCommitIntentSheet.ts`
- Takes accepted intent items and writes them to `profile_facts` table
- **SINGLE source of AI-suggested task generation** — no task items in Intent Sheet
- Medication commits also sync to `med_medications` via `medicationSync.ts`
- Fetches user's care guidance level and filters tasks by tier (essentials/balanced/comprehensive)
- **Context gates**: tasks are only generated when sufficient data exists (e.g., "fill prescription" requires pharmacy on file)
- **Deduplication**: checks for existing similar tasks before creating
- When context is insufficient, creates profile gap entries instead of low-quality tasks
- Returns committed items info for the Smart Follow-Up card
- All writes happen in a single database transaction
- Logs audit events for every committed change and every skipped task generation

### 4. Task System
- Tasks are the operational output of CareLead — a smart care operations engine
- Core fields: `title`, `description`, `due_date`, `priority`, `status`, `profile_id`, `source_type`, `source_ref`
- Enhanced fields: `context_json` (call scripts, contact info, instructions, reference numbers), `parent_task_id`, `chain_order`, `depends_on_task_id`, `dependency_status`, `assigned_to_user_id`, `recurrence_rule`, `trigger_type`, `trigger_source`
- Statuses: `pending` → `in_progress` → `completed` | `dismissed`
- Trigger types: `manual` | `extraction` | `proactive` | `time_based` | `chain`
- Tasks can be auto-generated (from Intent Sheet commit with AI-suggested tasks), created from task chain templates, proactively suggested, or manually created
- **Smart Task Generation**: AI extraction suggests contextual follow-up tasks based on committed data category (medication, allergy, insurance, condition)
- **Task Chains**: Sequences of linked tasks where each depends on the previous one completing (e.g., NEW_MEDICATION_CHAIN, POST_VISIT_CHAIN)
- **Proactive Checks**: Runs on app open (daily cooldown) to suggest refill reminders, appointment prep, overdue escalation, and stale profile reviews
- **Caregiver Assignment**: Tasks can be assigned to household members
- Reminders are scheduled via push notifications
- Every task links back to its source and includes rich context (call scripts, instructions, contact info)

### 5. Profile Intelligence (Gaps)
- Implemented in `services/profileGaps.ts` with hook `hooks/useProfileGaps.ts`
- Analyzes profile facts to identify missing data that would unlock better functionality
- Gap categories: medication (dose, frequency, pharmacy, prescriber), condition (managing provider, status), allergy (reaction, severity), insurance (PCP), general (emergency contact, care team, pharmacy)
- Gaps are prioritized by impact: HIGH = unlocks task generation, MEDIUM = improves context, LOW = nice to have
- "Strengthen Your Profile" card on profile overview links to fill-gaps screen
- Filling a gap triggers task query invalidation — newly unlocked tasks appear automatically

### 6. Profile Fact Upsert
- Implemented in `services/profileFactUpsert.ts`
- Shared upsert logic with change tracking used by both the Commit Engine and Closeout flow
- Prevents duplication when inserting profile facts from different sources

### 7. Audit Trail
- Append-only `audit_events` table
- Every significant action creates an audit event:
  - `event_type` (e.g., `profile_fact.created`, `intent_item.accepted`, `task.completed`)
  - `actor_id` (user who performed the action)
  - `profile_id` (which profile was affected)
  - `metadata` (JSON with non-PHI context — IDs, counts, status changes)
  - `created_at` (timestamp)
- **No PHI in audit metadata.** Only IDs, counts, and status values.
- Audit events are never deleted or modified.

---

## Module Architecture

### Appointments Module
**Tables**: `apt_appointments`, `apt_plan_items`, `apt_closeouts`, `apt_outcomes`
**Services**: `appointments.ts`, `appointmentPlanGenerator.ts`, `visitPrepProcessor.ts`, `visitPacket.ts`, `closeout.ts`
**Hooks**: `useAppointments.ts`, `useCloseout.ts`

**Appointment lifecycle**: `draft` → `scheduled` → `preparing` → `ready` → `completed` → (closeout)

**Visit Prep system** (stored as `prep_json` on `apt_appointments`):
- Patient-voice-first: user types concerns/questions in free text
- `process-visit-prep` Edge Function structures the input, separating patient voice from AI suggestions
- Structured prep includes: `questions_and_concerns`, `logistics` (driver, what_to_bring, special_needs), `refills_needed`, `ai_suggestions`
- Caregivers can add suggestions (`CaregiverSuggestion`) that the patient accepts/dismisses
- Visit Packet: plain-text export for printing/sharing with provider

**Post-visit closeout** (stored in `apt_closeouts` + `apt_outcomes`):
- Quick-capture answers (did visit happen, quick summary, followup timeframe, attendees)
- Free-text summary processing → AI-proposed outcomes
- Document extraction on uploaded after-visit summaries
- Outcome types: `followup_action`, `medication_change`, `diagnosis_change`, `allergy_change`, `order`, `instruction`
- Outcomes follow Intent Sheet pattern: `proposed` → `accepted` | `edited` | `rejected`
- Finalization: accepted outcomes become profile facts + generate related tasks

### Medications Module
**Tables**: `med_medications`, `med_medication_sigs`, `med_medication_supply`, `med_adherence_events`
**Services**: `medications.ts`, `medicationMigration.ts`, `medicationSync.ts`
**Hooks**: `useMedications.ts`

**Medication record structure**:
- **Core** (`med_medications`): drug_name, strength, form (tablet/capsule/liquid/etc.), route (oral/topical/etc.), status (active/paused/stopped), prn_flag
- **Sig/directions** (`med_medication_sigs`): dose_text, frequency_text, timing_json, instructions
- **Supply** (`med_medication_supply`): last_fill_date, days_supply, refills_remaining, pharmacy contact, prescriber contact
- **Adherence** (`med_adherence_events`): event_type (taken/skipped/snoozed), scheduled_time, recorded_at

**Key capabilities**:
- AI-assisted medication entry with smart defaults from `medicalInference.ts`
- Refill status checking based on supply data
- Today's doses query for adherence tracking on Home/Today screens
- Medication sync from Intent Sheet commits (extracted medication data → `med_medications`)
- One-time migration from legacy `profile_facts` medication entries

### Caregivers Module
**Tables**: `profile_access_grants`, `consent_records`, `caregiver_invites`
**Services**: `caregivers.ts`
**Hooks**: `useCaregivers.ts`
**Constants**: `permissionTemplates.ts`

**Permission system**:
- 6 pre-built templates: `full_helper`, `bills_insurance`, `medications`, `appointments_tasks`, `documents_only`, `view_only`
- Fine-grained scopes: `profile.read/write`, `health.read/write`, `docs.read/write`, `tasks.read/write`, `appointments.read/write`, `medications.read/write`, `export.generate`, `intent.confirm`
- Each template maps to a set of scopes stored as JSONB array

**Invitation flow**:
- Invites by email OR phone number (phone support added in migration 00010)
- Token-based acceptance
- Invite statuses: `pending` → `accepted` | `expired` | `revoked`
- On acceptance: creates `profile_access_grants` for each profile in the invite

**Consent records** (append-only):
- Every permission grant, modification, and revocation creates a consent record
- Types: `access_granted`, `access_modified`, `access_revoked`
- Never deleted — full audit trail of who had access to what and when

---

## Database Schema

### Core Tables (Migration 00001)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `households` | Family/household container | name |
| `profiles` | Individual people (patients/dependents) | household_id, user_id, display_name, date_of_birth, relationship |
| `household_members` | Users in a household | household_id, user_id, role (owner/admin/caregiver/viewer), status |
| `profile_facts` | Medical/personal information | profile_id, category, field_key, value_json, source_type, verification_status |
| `artifacts` | Uploaded documents/photos/notes | profile_id, artifact_type, file_path, ocr_text, processing_status |
| `extracted_fields` | AI-extracted data from artifacts | artifact_id, field_key, value_json, confidence, status |
| `intent_sheets` | Review containers for extracted data | profile_id, artifact_id, source_type, status |
| `intent_items` | Individual items for review | intent_sheet_id, item_type, field_key, proposed_value, confidence, status |
| `tasks` | Operational tasks and reminders | profile_id, title, due_date, priority, status, context_json, trigger_type |
| `audit_events` | Append-only audit trail | profile_id, actor_id, event_type, metadata |

### Appointments Tables (Migrations 00006, 00007)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `apt_appointments` | Visit/procedure records | profile_id, title, appointment_type, provider_name, start_time, status, plan_status, prep_json |
| `apt_plan_items` | Preparation checklist items | appointment_id, item_type (task/logistics/prep/question), title, status, source |
| `apt_closeouts` | Post-visit summaries | appointment_id, status, visit_happened, quick_summary, followup_timeframe |
| `apt_outcomes` | Individual outcomes from a visit | closeout_id, outcome_type, description, proposed_value, status |

### Medications Tables (Migration 00008)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `med_medications` | Core medication records | profile_id, drug_name, strength, form, route, status, prn_flag |
| `med_medication_sigs` | Dosing directions | medication_id, dose_text, frequency_text, timing_json, instructions |
| `med_medication_supply` | Refill/supply tracking | medication_id, last_fill_date, days_supply, refills_remaining, pharmacy_name/phone, prescriber_name/phone |
| `med_adherence_events` | Dose logging | medication_id, event_type (taken/skipped/snoozed), scheduled_time, recorded_at |

### Caregivers Tables (Migrations 00009, 00010)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `profile_access_grants` | Who can access what profile | profile_id, grantee_user_id, permission_template, scopes, status |
| `consent_records` | Append-only permission audit trail | profile_id, consenter_user_id, grantee_user_id, consent_type |
| `caregiver_invites` | Pending invitations | household_id, invited_email (optional), invited_phone (optional), profile_ids, permission_template, token, status |

### Other Tables
| Table | Purpose | Migration |
|-------|---------|-----------|
| `user_preferences` | User settings (care guidance level, weekly digest) | 00005 |

---

## Database Conventions

### Table Naming
- Use `snake_case` for all table and column names
- Module-prefixed tables: `med_medications`, `apt_appointments`
- Shared tables have no prefix: `profiles`, `artifacts`, `tasks`, `audit_events`
- Caregiver tables: `profile_access_grants`, `consent_records`, `caregiver_invites`

### Module Prefixes (Database)
- Profile/Core: no prefix (`profiles`, `artifacts`, `tasks`)
- Medications: `med_` (`med_medications`, `med_medication_sigs`, `med_medication_supply`, `med_adherence_events`)
- Appointments: `apt_` (`apt_appointments`, `apt_plan_items`, `apt_closeouts`, `apt_outcomes`)
- Billing: `bill_` (future — `bill_cases`, `bill_documents`)
- Caregivers: no prefix (`profile_access_grants`, `consent_records`, `caregiver_invites`)

### Required Columns (every table)
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Profile Scoping
- Every patient-data table MUST have a `profile_id UUID REFERENCES profiles(id)` column
- This is the foundation of data isolation — one profile's data never leaks to another
- Row Level Security (RLS) policies enforce this at the database level

### Row Level Security (RLS)
- **RLS is enabled on every table that contains patient data.**
- Policies check that the requesting user has access to the `profile_id` on each row
- Access is determined through the `household_members` and `profile_access_grants` tables
- Helper functions: `is_household_member()` and `has_profile_access()`
- Service role (Edge Functions) bypasses RLS only for system operations (extraction, processing)

### Soft Deletes
- Use `deleted_at TIMESTAMPTZ` column instead of hard deletes for patient data
- Filter with `WHERE deleted_at IS NULL` in all queries
- Hard deletes only via explicit user data deletion request

---

## Component Patterns

### Screen Components (in `app/`)
Every screen follows this structure:
```tsx
import { ScreenLayout } from '@/components/ui/ScreenLayout';

export default function MedicationsScreen() {
  const { activeProfileId } = useActiveProfile();
  const { data, isLoading, error } = useMedications(activeProfileId);

  if (isLoading) return <ScreenLayout loading />;
  if (error) return <ScreenLayout error={error} />;

  return (
    <ScreenLayout title="Medications">
      {/* Screen content */}
    </ScreenLayout>
  );
}
```

### Rules:
- Screens use `ScreenLayout` wrapper for consistent headers, padding, and scroll behavior
- Screens call hooks for data — never call services directly
- Screens handle three states: loading, error, and content
- Screens never contain business logic — they orchestrate components

### Reusable Components (in `components/`)
```tsx
interface MedicationCardProps {
  medication: Medication;
  onPress?: () => void;
}

export function MedicationCard({ medication, onPress }: MedicationCardProps) {
  // Component logic and rendering
}
```

### Rules:
- Every component has a typed Props interface
- Components are functional (no class components)
- Components receive data via props — they don't fetch their own data
- Components use `StyleSheet.create()` for styling with colors from `lib/constants/colors.ts`

---

## State Management Rules

### Server State (TanStack Query)
- **All data from Supabase goes through TanStack Query.**
- Query keys follow the pattern: `[module, action, ...params]`
  - Example: `['medications', 'list', profileId]`
  - Example: `['profile', 'detail', profileId]`
- Mutations use `useMutation` with `onSuccess` invalidation
- Optimistic updates are allowed for simple status changes (task completion)

### Client State (Zustand)
- **Only for UI state that doesn't come from the server:**
  - Active profile ID
  - Authentication session
  - Modal/toast visibility
  - Form draft state
- Zustand stores are small and focused — one store per concern
- Never duplicate server data in Zustand

### Rules:
- If the data comes from the database → TanStack Query
- If the data is local UI state → Zustand
- If the data is form input → React Hook Form
- **Never mix these.** No storing server data in Zustand. No fetching data inside Zustand stores.

---

## Naming Conventions

### Files and Folders
- **Screens**: `kebab-case.tsx` (e.g., `care-team.tsx`, `sign-in.tsx`)
- **Components**: `PascalCase.tsx` (e.g., `MedicationCard.tsx`, `ProfileCard.tsx`)
- **Hooks**: `camelCase.ts` starting with `use` (e.g., `useProfiles.ts`)
- **Services**: `camelCase.ts` (e.g., `commit.ts`, `profiles.ts`)
- **Types**: `camelCase.ts` (e.g., `profile.ts` inside `lib/types/`)
- **Utils**: `camelCase.ts` (e.g., `formatProfileFact.ts`)

### Code
- **Functions**: `camelCase` (e.g., `fetchMedications`, `commitIntentSheet`)
- **Components**: `PascalCase` (e.g., `MedicationCard`, `ProfileCard`)
- **Types/Interfaces**: `PascalCase` (e.g., `Medication`, `IntentItem`, `ProfileFact`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_CONFIDENCE_THRESHOLD`)
- **Database columns**: `snake_case` (e.g., `profile_id`, `created_at`)
- **Enum values**: `snake_case` strings (e.g., `status: 'in_progress'`)

---

## Security Rules (HIPAA-Aligned Skeleton)

### PHI Handling
- **PHI-allowed zones**: Supabase database (RLS-protected), Supabase Storage (private buckets), encrypted transport
- **PHI-forbidden zones**: console.log, error tracking payloads, analytics events, crash reports, Git repository
- **Never log PHI.** Use IDs and counts only in any logging.
- **Never put PHI in URL parameters or query strings.**

### Authentication
- Supabase Auth handles sign-up, sign-in, and session management
- Tokens stored in secure device storage (expo-secure-store), never AsyncStorage
- Session refresh handled automatically by Supabase client

### Authorization
- Every data query is scoped to profiles the user has access to
- Access is checked server-side via RLS policies — never trust client-side checks alone
- Caregiver access is permission-scoped (via `profile_access_grants`) and revocable
- Consent records provide a complete audit trail of permission changes

### Storage
- All document uploads go to private Supabase Storage buckets
- Access via short-lived signed URLs (expire after 1 hour)
- Never generate public URLs for patient documents

### Edge Functions
- All AI processing happens in Edge Functions (server-side)
- API keys for AI providers are stored as Supabase secrets
- JWT verification is disabled on Edge Functions (`--no-verify-jwt` during deployment)
- Edge Functions minimize data sent to AI providers — only send what's needed
- AI provider responses are not logged in full — only non-PHI metadata (model, latency, token count, status)

### Notifications (PHI Rules)
- **Never include PHI in notification content.** Push and local notifications appear on lock screens, in notification trays, on paired watches, and may be captured by OS analytics — all outside our controlled zone.
- Route every scheduled notification through `services/notifications.ts` — use `sanitizeNotificationContent()` or `genericNotification()` to ensure safe content.
- Forbidden in notification title/body: patient names (including "Mom", "Dad"), medication names/doses, lab values, provider names, facility names, diagnoses, allergy details, bill amounts, insurance plan names, appointment types.
- Use category-specific generic templates: "You have a medication reminder", "You have an upcoming appointment", "A new result is available", "A billing update is available".
- Deep-link data (e.g., `taskId`) is attached via notification `data` payload — safe because it is opaque and only opened after the user taps through to the authenticated app.

### App Lock (Biometrics, PIN, Session)
- **Biometric lock** (Face ID / Touch ID) is the primary unlock path — configured via `services/biometric.ts` + `app/(auth)/app-lock.tsx`.
- **PIN fallback** — devices without biometrics can set a 4-digit PIN stored as SHA-256(pin + user_id salt) in SecureStore. Max 5 attempts, then forced sign-out.
- **Auto-lock** re-prompts for biometric/PIN after backgrounding (30s / 1min / 5min / never).
- **Session expiry** — configurable full re-authentication window (24h / 7d / 30d, default 7d) stored in SecureStore and enforced in AuthGate.
- **Sign-out cleanup** — every sign-out path must call `cleanupOnSignOut()` in `services/auth.ts` (clears SecureStore, Zustand stores, TanStack Query cache, pending invite tokens, scheduled notifications).
- **App switcher privacy overlay** — a full-screen brand overlay replaces app content whenever `AppState !== 'active'`, preventing PHI leakage in the iOS app switcher.

### Audit Logging
- Auth/session events write to `security_audit_log` via `services/securityAudit.ts` — fire-and-forget; UI never blocks on audit writes.
- Stored per-event: `event_type`, `user_id`, generic `device_info` (platform only), non-PHI `detail`, `created_at`.
- **Never log to this table**: IP addresses, device IDs/models, names, phone numbers, email addresses, or any health data.
- RLS: users can only insert their own events (or anonymous for pre-session events like `otp_requested`). No user-facing reads — service role only.

---

## Error Handling

### Service Layer
```typescript
// Services return typed results, never throw to the UI
type ServiceResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code?: string };
```

### UI Layer
- Every screen handles: loading state, error state, empty state, and content state
- Errors are shown to users in plain, non-technical language
- Network errors prompt retry options
- Never show raw error messages or stack traces to users

---

## Known Patterns and Gotchas

Patterns that emerged during development — read these before building new features:

### RLS Chicken-and-Egg Problem
When a new user signs up, they need to create a household and profile — but RLS policies require the user to already be a household member to insert rows. This was solved with a `SECURITY DEFINER` RPC function (`00002_signup_function.sql`) that runs with elevated privileges to bootstrap the user's household, membership, and first profile in a single transaction.

### Edge Function Secrets
Secret names are **case-sensitive** and must match exactly what the code reads via `Deno.env.get()`. A mismatch silently returns `undefined`. Always verify with `supabase secrets list`.

### expo-file-system Legacy Import
In Expo SDK 54, `expo-file-system` requires importing from the legacy path:
```typescript
import * as FileSystem from 'expo-file-system/legacy';
```
Not `from 'expo-file-system'` — the default export has breaking changes in SDK 54.

### HEIC Files Not Supported
iPhone cameras default to HEIC format, which the Claude API does not accept. The camera capture screen is configured to save photos as **JPEG** to avoid this issue. Any future file upload flow must also reject or convert HEIC files.

### Artifacts Table Column Name
The column for file size in the `artifacts` table is `file_size` (not `file_size_bytes`). This has caused bugs when the wrong name was assumed.

### Profile Facts Use Structured JSON
Profile facts store their `value` as structured JSON (not flat strings). The `formatProfileFact.ts` utility handles category-aware display formatting. When adding new profile fact categories, add a corresponding formatter in that file.

### Dual Medication Storage
Medications exist in two places: `profile_facts` (category: `medication`) and `med_medications` table. The `medicationSync.ts` service keeps them in sync during Intent Sheet commits. New medication features should read from `med_medications` (the dedicated table), not `profile_facts`.

### Closeout Outcomes Follow Intent Sheet Pattern
Post-visit closeout outcomes use the same accept/edit/reject pattern as Intent Sheet items. Accepted outcomes become profile facts via `profileFactUpsert.ts` and generate tasks — the same commit pattern used elsewhere.

### Caregiver Invites Support Email or Phone
Migration 00010 made `invited_email` optional and added `invited_phone`. An invite must have at least one of email or phone, but not necessarily both.

### Visit Prep is Patient-Voice-First
The `process-visit-prep` Edge Function always puts the patient's own words first (source: `"patient"`). AI suggestions are separate and clearly marked (source: `"ai_suggested"`). Never mix or re-order these — the patient's voice is always primary.

### crypto.randomUUID() Does Not Exist in React Native
Generate client-side IDs with `Date.now() + Math.random()` (or similar) — `crypto.randomUUID()` is not available in the React Native runtime. Server-generated UUIDs (via Postgres `gen_random_uuid()`) remain the default; only use client-generated IDs for optimistic/local state.

### Storage Bucket Policies via Dashboard, Not SQL Editor
`storage.objects` has an ownership issue that prevents INSERT/SELECT/DELETE policies from being created via the SQL Editor. Always create bucket policies through the Supabase Dashboard UI. This applies to `artifacts`, `billing-documents`, and `result-documents`.

---

## Cross-Module Patterns

Patterns followed by every Phase 2 module (Bills, Results, Preventive Care) and expected for any future module:

### Service Layer
- All service functions return `ServiceResult<T>` wrappers (`{ success: true, data } | { success: false, error }`)
- Services never throw to UI — errors flow through the wrapper
- Audit events logged for every create/update/delete operation (non-PHI metadata only)
- No cross-module service imports — shared logic lives in shared services (e.g., `profileFactUpsert.ts`)

### Hooks & State
- TanStack Query hooks with consistent cache invalidation on mutations
- Query keys follow `[module, action, ...params]` pattern
- Server state in TanStack Query, UI state in Zustand, form state in React Hook Form

### UI
- `StyleSheet.create()` with colors from `lib/constants/colors.ts` (no NativeWind)
- Ionicons via `@expo/vector-icons` (never mix icon libraries)
- `@react-native-community/datetimepicker` (via reusable `DatePicker` component) for all date inputs
- `KeyboardAvoidingView` on any screen with text inputs
- Home button (`home-outline`) in the header on screens 3+ levels deep

### Backend
- Same RLS pattern on every table: `has_profile_access(profile_id)` helper
- Every Edge Function: CORS headers from `_shared/cors.ts`, Claude API call, JSON parse, structured error handling
- Storage bucket policies created via Supabase Dashboard (never SQL Editor)

### Client-Side IDs
- Use `Date.now() + Math.random()` (or similar) for optimistic/local IDs
- Server-generated UUIDs (Postgres `gen_random_uuid()`) remain the default for persisted rows

---

## Git Workflow

### Commit Messages
Use conventional commits:
- `feat: add medication list screen`
- `fix: correct profile snapshot date formatting`
- `chore: update dependencies`
- `refactor: extract IntentSheet into shared component`

### Branch Strategy
- `main` — stable, deployable code
- `feat/module-name` — feature branches for new modules
- `fix/description` — bug fix branches

### Rules
- Never commit `.env.local` or any file containing secrets
- Commit frequently — small, focused commits are better than large ones
- Every commit should leave the app in a working state

---

## Testing Approach

### Priority (what to test first)
1. **Authorization**: Can a user only see their own profile's data?
2. **Intent Sheet commit**: Do accepted items correctly become verified data?
3. **Task creation**: Are tasks correctly created from committed intent items?
4. **Profile scoping**: Does switching profiles correctly isolate data?
5. **Medication sync**: Do committed medications correctly populate `med_medications`?
6. **Caregiver permissions**: Do scopes correctly restrict access?

### Approach
- Use Expo's built-in testing support with Jest
- Focus on service layer tests (data logic) over UI tests initially
- Edge Function tests for extraction and visit prep pipelines

---

## Adding New Modules (Checklist)

When building a new module, follow this exact sequence:

1. **Database migration**: Create tables in `supabase/migrations/` following naming conventions
2. **Types**: Add TypeScript types in `lib/types/`
3. **Service**: Create service file in `services/` with CRUD operations
4. **Hook**: Create hook in `hooks/` that wraps the service with TanStack Query
5. **Components**: Build module-specific components in `components/modules/`
6. **Screens**: Create screen files in `app/(main)/module-name/`
7. **Navigation**: Add to tab bar or navigation if needed
8. **Integration**: Connect to Intent Sheet commit engine if the module receives extracted data
9. **Tasks**: Define what tasks/reminders this module can generate
10. **Audit**: Add audit event types for this module's key actions

**Every module follows this sequence. No exceptions.**

---

## V1 Module Scope

### Included in V1 — ALL COMPLETE
- [x] Authentication (sign up, sign in, session)
- [x] Household & Profile foundation
- [x] Profile management (all sections: meds, allergies, conditions, insurance, care team, history)
- [x] Data Entry: text input, text dictation, photo/scan capture, document upload
- [x] Smart Extraction pipeline (AI-powered, 11+ field categories)
- [x] Intent Sheet (review and confirm)
- [x] Commit Engine (with medication sync to dedicated tables)
- [x] Tasks & Reminders with push notifications, smart generation, chains, proactive checks, caregiver assignment
- [x] Appointments (CRUD, pre-visit prep with patient-voice-first, caregiver suggestions, visit packet, post-visit closeout with outcome extraction)
- [x] Medications (dedicated tables, AI-assisted entry, sig/supply tracking, adherence logging, refill workflows)
- [x] Caregivers (invite via email/phone, 6 permission templates, fine-grained scopes, consent audit trail)
- [x] Home screen redesign (5-zone layout with gradient hero, Today's Briefing, quick actions, module shortcuts)

### NOT in V1 (future modules)
- [ ] Profile Snapshot & Export
- [ ] Bills & EOBs
- [ ] Results (labs/imaging)
- [ ] Voice Retrieval ("Ask Profile")
- [ ] Calling Agent
- [ ] Preventive Care
- [ ] Analytics & Dashboards
- [ ] During-Visit Capture
- [ ] Email Intake

---

## Build Phases

### Phase 0: Foundation — COMPLETE
- [x] Expo project scaffold with folder structure
- [x] Supabase connection and auth flow
- [x] Design system (colors, typography, shared components)
- [x] Navigation skeleton (tabs, auth gate)
- [x] Database: foundation migration (users, households, profiles)

### Phase 1: Core Platform — COMPLETE
- [x] **Step 1**: Database schema — foundation tables, RLS policies, signup RPC function
- [x] **Step 2**: Profile system — household, profile facts, family members, profile overview screen
- [x] **Step 3**: Data capture — photo capture, document upload, text dictation screen
- [x] **Step 4**: AI extraction — Edge Function with Claude API, extraction service and hooks
- [x] **Step 5**: Intent Sheet review, commit engine, smart extraction, profile fact display with formatProfileFact
- [x] **Step 6**: Tasks & reminders — full task management, push notifications, home screen action items
- [x] **Step 7**: Appointments — CRUD, patient-voice-first visit prep, caregiver suggestions, visit packet, post-visit closeout with outcome extraction and finalization
- [x] **Step 8**: Medications — dedicated tables, AI-assisted entry, full editing, sig/supply tracking, adherence logging, refill workflows, medication sync from extraction
- [x] **Step 9**: Caregivers — invite via email/phone, 6 permission templates, fine-grained scopes, consent audit trail, access revocation
- [x] **Step 10**: Home screen redesign — 5-zone layout, gradient hero, Today's Briefing, quick actions, module shortcuts, Today Detail screen

### Phase 2: IN PROGRESS

#### Step 1: Bills & EOBs Module — COMPLETE (all 9 steps)
- **Database**: 13 billing tables across migrations `20260410_billing_cases_schema.sql`, `20260410_billing_add_freeform.sql`, `20260417_fix_billing_rls.sql`:
  - `billing_cases`, `billing_documents`, `billing_extract_jobs`, `billing_ledger_lines`, `billing_case_findings`, `billing_case_actions`, `billing_case_call_logs`, `billing_case_payments`, `billing_denial_records`, `billing_appeal_packets`, `billing_contacts`, `billing_case_parties`, `billing_case_status_events`
- **Storage bucket**: `billing-documents` (private) with INSERT/SELECT/DELETE policies for authenticated users
- **Edge Functions**: `extract-billing` (document + freeform text extraction), `generate-appeal-letter` (appeal drafting)
- **Key files**:
  - `lib/types/billing.ts` — all billing type definitions
  - `services/billing.ts` — full CRUD, extraction triggers, payments, call logs, findings persistence, action activation with task creation
  - `services/billingReconciliation.ts` — deterministic engine with 10 checks: `missing_bill`, `missing_eob`, `low_doc_quality`, `low_confidence`, `total_mismatch`, `denial_detected`, `possible_overpayment`, `missing_provider`, `missing_payer`, `no_service_dates`
  - `services/billingActionPlan.ts` — action plan generation from findings, auto-complete/auto-dismiss logic
  - `services/billingCallScripts.ts` — context-aware call scripts (provider/payer/pharmacy)
  - `services/billingBriefing.ts` — Home screen briefing items
  - `services/billingTimeline.ts` — chronological timeline from all billing events
  - `hooks/useBilling.ts` — all TanStack Query hooks
  - Screens: `app/(main)/billing/` — index (case list), create (two entry modes), start (freeform), `[id]/index` (detail with totals, line items, documents, findings, action plan, calls, payments, denials, timeline), `[id]/add-document`, `[id]/call-helper`, `[id]/appeals`
- **Patterns established**:
  - Two-mode case creation: "Snap a Bill" (camera) + "Start a New Bill" (freeform/blank)
  - Freeform text → AI extraction → auto-populate case fields
  - Reconciliation runs client-side after extraction, document upload, payment changes
  - Action plan: findings → proposed actions → user review → activate → creates tasks
  - "Strengthen Your Case" indicator derived from findings
  - Call scripts with copyable reference numbers; call logs can create follow-up tasks
  - Appeal packet: checklist, document selector, AI-generated editable letter, status tracking

#### Step 2: Results Module — COMPLETE (all 7 steps)
- **Database**: 4 tables across migrations `20260417_results_schema.sql`, `20260418_result_observations_unique.sql`:
  - `result_items`, `result_documents`, `result_lab_observations`, `result_extract_jobs`
- **Storage bucket**: `result-documents` (private) with INSERT/SELECT/DELETE policies for authenticated users
- **Edge Function**: `extract-result` (type-specific prompts for labs / imaging / other)
- **Key files**:
  - `lib/types/results.ts` — all result type definitions
  - `services/results.ts` — full CRUD, extraction triggers, lab observations, pin/tags
  - `services/resultExport.ts` — shareable text summary with disclaimer
  - `services/resultsBriefing.ts` — Home screen briefing items
  - `hooks/useResults.ts` — all TanStack Query hooks
  - Screens: `app/(main)/results/` — index (search, filters, sort, pin), add (three modes), add-typed, add-dictated, add-upload, `[id]/index` (type-aware structured display, extraction status, share), `[id]/review` (corrections + Intent Sheet confirmation)
- **Patterns established**:
  - Three entry modes: Type/Paste, Dictate, Upload Report
  - Type-aware extraction: labs → analyte list with flags; imaging → findings/impression; other → key findings
  - Needs Review state + user corrections overlay (`user_corrections` stored separately from `structured_data`)
  - `getEffectiveData()` merges extraction + corrections for display
  - Lab observations written to the trend-ready `result_lab_observations` table on confirmation
  - Search with debounce, multi-dimension filters (type/status/time), sort options
  - Long-press to pin; pinned items sort first

#### Step 3: Preventive Care Module — COMPLETE (all 6 steps)
- **Database**: 4 tables + 10 seed rules across migrations `20260418_preventive_care_schema.sql`, `20260418_preventive_task_source.sql`, `20260419_preventive_evidence_path.sql`:
  - `preventive_rules`, `preventive_items`, `preventive_item_events`, `preventive_intent_sheets`
- **Edge Function**: `extract-preventive-date` (completion date extraction from proof documents)
- **Key files**:
  - `lib/types/preventive.ts` — all preventive type definitions
  - `services/preventiveEngine.ts` — deterministic eligibility engine (age/sex/condition evaluation, cadence-based due-date calculation, missing-data detection)
  - `services/preventive.ts` — full CRUD, scan orchestration, intent sheet management, completion with document proof
  - `services/preventiveIntentSheet.ts` — task/reminder generation from selected preventive items
  - `services/preventiveBriefing.ts` — Home screen briefing items
  - `hooks/usePreventive.ts` — all TanStack Query hooks
  - Screens: `app/(main)/preventive/` — index (dashboard grouped by status), `[id]` (item detail with rule explanation, missing-data prompts, mark complete, defer/decline), intent-review (Intent Sheet review + commit)
- **Patterns established**:
  - Deterministic eligibility engine (no AI) evaluates profile facts against rule criteria
  - Status model: `due` → `due_soon` → `scheduled` → `completed` → `up_to_date`, plus `needs_review`, `deferred`, `declined`
  - Missing-data prompts update profile facts and re-run eligibility
  - Intent Sheet pattern: select items → review proposed tasks → confirm → tasks created
  - Document-backed completion: upload proof → AI extracts date → user confirms
  - Items with cadence auto-calculate `next_due_date` on completion
  - `deferred` / `declined` are user choices the engine respects (never overrides)

#### Step 4: Voice Retrieval / Ask Profile Module — COMPLETE (all 6 steps)
- No new database tables (reads from existing domain tables)
- **Edge Function**: `ask-profile` (AI fallback for unmatched queries)
- **Key files**:
  - `lib/types/ask.ts` — CanonicalFact, ProfileIndex, AnswerCard, AskResponse, TableCard, TrendChartCard, ComparisonTableCard, SummaryListCard, TimelineCard, all visualization types
  - `services/profileIndex.ts` — builds ProfileIndex by aggregating across all domain tables (meds, labs, results, allergies, conditions, appointments, insurance, care team, preventive, billing)
  - `services/askIntents.ts` — 17+ deterministic intent definitions covering all domains
  - `services/askRouter.ts` — intent classification with keyword matching, entity extraction, confidence scoring
  - `services/askEngine.ts` — deterministic retrieval engine with smart format selection (table, trend chart, comparison, summary list, timeline, single card)
  - `services/askFallback.ts` — Claude AI fallback for unmatched queries
  - `services/askOrchestrator.ts` — top-level orchestrator: route → deterministic or AI → response
  - `services/askVerify.ts` — fact verification and conflict resolution across all source types
  - `lib/utils/formatLabValue.ts` — prevents duplicate unit display
  - `components/AnswerCard.tsx` — trust UI with provenance, freshness, verify/resolve actions
  - `components/SummaryListCard.tsx` — compact list card for medications, allergies, conditions, care team
  - `components/LabTableCard.tsx` — lab panel table with flag colors
  - `components/TrendChartCard.tsx` — SVG line chart with reference range band
  - `components/ComparisonTableCard.tsx` — multi-date panel comparison
  - `components/TimelineCard.tsx` — upcoming/past timeline for appointments
  - `components/ConflictResolution.tsx` — conflict resolution modal
  - `hooks/useAsk.ts` — useProfileIndex, useAskProfile, useVerifyFact, useResolveConflict
  - Screens: `app/(main)/ask/` — index (Ask screen with conversation UI, dynamic chips, voice input, visualizations)
- **Patterns established**:
  - Deterministic-first retrieval: intent router → template queries → AI fallback only when needed
  - Smart format selection: engine auto-picks table/chart/list/card based on query + data shape
  - Provenance on every answer: source, freshness, verification status always visible
  - Conflict detection and resolution with audit trail
  - Voice input via iOS keyboard dictation (Expo Go compatible)
  - Global access: FAB on Home, Ask buttons on module headers, profile Ask button
  - Dynamic personalized quick-ask chips based on profile data
  - Cross-domain querying: single Ask interface searches across all CareLead modules

### Phase 2: Remaining Candidates
- [x] Bills & EOBs module — COMPLETE
- [x] Results (labs/imaging) — COMPLETE
- [x] Preventive Care — COMPLETE
- [x] Voice Retrieval ("Ask Profile") — COMPLETE
- [ ] Calling Agent — PLANNED
- [ ] During-Visit Capture — PLANNED
- [ ] Analytics & Dashboards — PLANNED
- [ ] Email Intake — PLANNED
- [ ] UI/UX polish pass across all screens — PLANNED
- [ ] Performance optimization — PLANNED
- [ ] App Store preparation — PLANNED

### Phase 3: POLISH, REFINE, AND DEPLOY — IN PROGRESS

#### Item 1: Sign-up / Sign-in Overhaul — COMPLETE
- **Phone OTP as primary auth** via Twilio Verify + Supabase Phone provider
- **New auth screens**: `welcome`, `phone-entry`, `verify-otp`, `collect-name`, `email-auth` (fallback)
- **Onboarding wizard**: 4-step flow (who is this for → basic profile → quick win → welcome)
- **Biometric unlock**: Face ID / Touch ID with auto-lock on background, PIN fallback
- **Caregiver invites**: simplified 3-step wizard, QR codes, accept-invite screen, deep linking
- **HIPAA security**: auth audit logging, session expiry, sign-out cleanup, PHI-safe notifications, app switcher privacy overlay
- **Key files**: `app/(auth)/` screens, `services/auth.ts`, `services/biometric.ts`, `services/securityAudit.ts`, `stores/lockStore.ts`

#### Item 2: Profile Building Strategy — COMPLETE
**Group 1 — Passive Enrichment:**
- Cross-document profile enrichment (`services/profileEnrichment.ts`)
- Ask gap detection (`services/askGapActions.ts`)
- Post-appointment quick capture (`app/(main)/appointments/[id]/post-visit-capture.tsx`)
- Medication refill change detection (`components/RefillChangeSheet.tsx`, `SkipReasonSheet.tsx`)

**Group 2 — Active Triggers:**
- Pre-appointment profile accuracy check (`services/preAppointmentCheck.ts`)
- Periodic profile review (`services/profileReview.ts`, `app/(main)/profile/review.tsx`)
- Life event triggers (`services/lifeEventTriggers.ts`, `stores/lifeEventStore.ts`)
- Caregiver-driven enrichment (`services/caregiverEnrichment.ts`, `app/(main)/caregivers/contribute.tsx`)

**Group 3 — External Sources:**
- Photo batch import "Catch Up" flow (`app/(main)/capture/catch-up*.tsx`, `services/batchCapture.ts`)
- Standalone medication label snap (`app/(main)/medications/snap-label.tsx`)
- CCD/CCDA health summary import (`supabase/functions/extract-health-summary`, `app/(main)/capture/import-*.tsx`)

**Group 4 — Progressive Enrichment UX:**
- Smart context-aware nudge engine (`services/smartEnrichment.ts`)
- Micro-capture inline components (`components/MicroCapture.tsx`)
- Milestone celebration system
- Profile tier visualization (seedling → tree)
- Redesigned Strengthen Your Profile screen

**Group 5 — Data Quality and Trust:**
- Staleness detection with category-specific thresholds (`services/dataQuality.ts`)
- Cross-module validation (medication↔condition, condition↔provider)
- Freshness indicators on AnswerCards / SummaryListCards / LabTableCards
- Confirm-still-current quick actions
- Data quality detail screen

**New Edge Functions added in Phase 3:**
- `extract-med-label` — medication bottle/label extraction
- `extract-health-summary` — CCD/CCDA and health summary extraction

**New patterns established in Phase 3:**
- Enrichment store (`stores/enrichmentStore.ts`) for cross-document suggestions
- Life event store (`stores/lifeEventStore.ts`) for contextual follow-up prompts
- Smart nudge engine replaces static completeness scores
- Micro-capture pattern: inline one-tap actions without navigation
- Profile tiers replace percentage-based completeness
- 14-day dismissal cooldown for nudges and prompts
- Batch capture store for multi-photo processing

#### Item 3: Bills & EOBs Simplification — COMPLETE
Pure UI/UX refactor of the billing module — services, hooks, and data layer unchanged.

**Progressive disclosure (stage-based case detail):**
- `services/billingStage.ts` — `determineBillingStage()` maps a case to one of four stages (`just_started` → `analyzed` → `in_progress` → `resolved`) based on its data, not its `status` column
- `isSimpleBill()` — detects straightforward bills (no critical findings, ≤1 warning, confidence ≥0.7, clear patient responsibility)
- Case detail (`app/(main)/billing/[id]/index.tsx`) renders only the content relevant to the current stage; tabs (Overview / Details / Activity) appear once there's enough content to warrant them

**Simple bill card:**
- `components/modules/SimpleBillCard.tsx` — for clean bills, shows "You owe: $X" + three actions (Record Payment, Something seems wrong, Save for later); everything else collapsed behind "See full details"
- "Something seems wrong" transitions to the full tabbed view; the ideal path for 60%+ of bills

**Tabbed detailed view:**
- Three sticky tabs: Overview (findings + action plan + summary), Details (charges, documents, denials), Activity (calls, payments, timeline)
- Tabs are hidden when their content is empty — no "Activity" tab until there are calls/payments/timeline events

**Case list cleanup (`app/(main)/billing/index.tsx`):**
- Header: "Bills & EOBs" → "Your Bills"
- Cards show only provider + service date + key number ("You owe: $X" / "Paid in full" / "Needs attention" / "Processing…" / "Resolved — Paid $X") + friendly status pill + subtle stage icon
- Removed: findings count badge, document count, last-activity timestamp (available inside the case)

**Language cleanup across the module:**
- "Billing Case" → "Bill"; "New Billing Case" → "Track a Bill"
- "Line Items" → "Charges"; "Your Action Plan" → "What To Do"
- "Case strength" card title → "How complete is this bill?"
- Status labels: `open` "New", `in_review` "Reviewing", `action_plan` "Has next steps", `in_progress` "In Progress", `resolved` "Done", `closed` "Closed" (in `BILLING_STATUS_LABELS`)
- Home module shortcut: "Bills" → "Bills & Insurance"
- "Reconciliation" removed from user-facing copy entirely

**Extraction states (stage 1):**
- Processing: "Reading your bill…"
- Failed: "We couldn't read this clearly. You can try a better photo or add details manually."
- Context-aware next-step hint: "Upload your bill or EOB", "Upload your EOB to check for errors", "Upload the matching bill"

**Freeform appointment creation (added during Item 3):**
- Dictation-first entry with AI extraction (Edge Function: `extract-appointment`)
- Structured review form with enhanced context fields: `reason`, `companion`, `transportation`, `special_needs`
- Smart prep generation from extracted context
- Screens: `app/(main)/appointments/freeform.tsx`, `app/(main)/appointments/review.tsx`

**Key files for Item 3:** `services/billingStage.ts`, `components/modules/SimpleBillCard.tsx`, `app/(main)/appointments/freeform.tsx`, `app/(main)/appointments/review.tsx`

#### Item 4: Tasks & Reminders Refinement — COMPLETE

**Part 1 — Smart organization & priorities:**
- Task tiering: Today / This Week / When You're Ready buckets based on urgency + due date
- Bundling by source (one card per source artifact, expandable into individual tasks)
- Context enrichment (call scripts, contact info, reference numbers attached at creation time)
- "What Matters to You" priority layer — Edge Function `extract-priorities` parses patient free-text into structured priorities; `patient_priorities` table stores them; tasks scored against priorities for personalized ordering

**Part 2 — Lifecycle & fatigue controls:**
- Auto-expiry rules per task type (e.g., refill reminders expire after fill-date passes + grace window)
- Smart snooze with contextual options (until next appointment, until refill due, "remind me tomorrow", custom)
- Fatigue controls: per-user volume control (max active tasks), dismissal dampening (suppress similar tasks for N days after dismissal)
- Enhanced daily briefing card (`DailyBriefingCard`) — single-glance summary of what matters today
- Completion celebrations: progress tracking, streaks, milestone confetti

**Part 4c — Living priorities:**
- Priorities are always-accessible (no one-time onboarding capture)
- Incremental updates with quick-add chips
- Priority badges visible on boosted tasks throughout the app
- Merge logic prevents duplicate or near-duplicate priorities

**Key files for Item 4:**
- Services: `services/taskBundling.ts`, `services/taskPrioritization.ts`, `services/taskLifecycle.ts`, `services/taskSnooze.ts`, `services/taskVolumeControl.ts`, `services/taskProgress.ts`, `services/dailyBriefing.ts`, `services/patientPriorities.ts`
- State: `stores/wellnessVisitStore.ts`
- Components: `components/SmartSnoozeSheet.tsx`, `components/DailyBriefingCard.tsx`
- Screens: `app/(main)/profile/[profileId]/priorities.tsx`

#### Item 5: Preventive Care Expansion — COMPLETE

**Part 1 — Expanded rule engine:**
- Multiple screening methods per rule with independent cadences (e.g., colonoscopy every 10y vs. FIT every 1y)
- Condition-based triggers (rules can fire only when relevant conditions are present)
- HEDIS measure codes attached to rules for quality reporting alignment
- Seasonal windows (e.g., flu shot recommended Sep–Mar)
- 25 rules total (up from 10)
- New utility: `lib/utils/conditionMatcher.ts` for evaluating condition triggers
- Screening method selection UI on item detail

**Part 2 — Notifications, outcomes, reporting:**
- Smart notification strategy with three modes: Active / Visit-only / Quiet
- Appointment-anchored reminders with "Discuss at my next visit" action
- 30-day cooldown between notifications for the same item
- Measurable outcomes: gap closure metrics, compliance rate, HEDIS compliance
- Shareable Preventive Care Summary report
- Wellness visit bundle for one-shot preparation

**Part 5c — Dashboard overhaul:**
- Categorized collapsible sections: Cancer / Immunizations / Diabetes / Cardiovascular / Behavioral / Wellness
- Eligibility engine fix — properly skips items outside age/sex/condition range instead of surfacing them as "Needs Review"
- Progressive reveal demographics prompt (asks for missing facts only when needed to evaluate a relevant rule)
- New `archived` status for items that become ineligible (e.g., post-surgery, age-out)

**Part 5d — Annual Wellness Visit dedicated flow:**
- 5-step wizard: freeform dictation → profile review → preventive agenda → questions → shareable visit packet
- Edge Function: `extract-wellness-input` (parses freeform wellness-visit input into structured agenda)
- Wellness visit store with persistence across app sessions
- Access points: preventive dashboard, home screen, appointment detail
- Sex field normalization fix in `lib/utils/gender.ts` (consistent handling of "M"/"F"/"male"/"female"/null across rule evaluation)

**Key files for Item 5:**
- Services: `services/preventiveEngine.ts`, `services/preventiveReminders.ts`, `services/preventiveBriefingStrategy.ts`, `services/preventiveMetrics.ts`, `services/preventiveReport.ts`, `services/wellnessVisitBundle.ts`, `services/wellnessVisit.ts`
- Utils: `lib/utils/conditionMatcher.ts`, `lib/utils/gender.ts`
- Screens: `app/(main)/preventive/wellness-visit/` (5-step wizard screens)

#### New Edge Functions added in Items 3–5
- `extract-appointment` — freeform appointment extraction (Item 3)
- `extract-priorities` — patient priorities extraction (Item 4)
- `extract-wellness-input` — wellness visit freeform extraction (Item 5)

#### Item 6: Retrieval Efficiency — COMPLETE

Caching, performance, and cost optimization for the Ask CareLead retrieval system. Pure performance work — no behavior changes from the user's perspective.

**Profile Index caching:**
- TanStack Query options on `useProfileIndex`: `staleTime: 5 min`, `gcTime: 10 min`, `refetchOnWindowFocus: false`, `refetchOnMount: false`
- New `prefetchProfileIndex(queryClient, profileId, householdId)` and `usePrefetchProfileIndex` hooks
- Home screen warms the index speculatively on mount so the first Ask query feels instant
- Index build also logs `[Ask] indexBuild` timing in `__DEV__`

**Response cache (`services/askCache.ts`):**
- In-memory singleton `askCache` (LRU, max 50 entries)
- Query normalization: lowercase, punctuation stripping, prefix stripping ("please tell me", "show me", "what is my"), synonym collapsing (medications → meds, providers → doctors, vaccines → immunizations)
- Per-source TTL: deterministic answers 5 min, AI fallback answers 60 min (cost amortization)
- Methods: `get`, `set`, `invalidate`, `invalidateByDomain` (clears entries whose normalized query mentions a domain keyword)
- Cache hits annotate the response with `cached: true` and the original `source`

**Centralized cache invalidation (`services/askInvalidation.ts`):**
- Single helper module: `invalidateAskForProfile` (full clear) and `invalidateAskByDomain` (targeted)
- Both clear the response cache AND invalidate the profile index TanStack Query
- Wired into mutation `onSuccess` for: meds (CRUD + sig/supply/status), results (CRUD + extraction + confirm), appointments (CRUD + reschedule), preventive (full lifecycle via `invalidatePreventiveCaches`), billing (CRUD), profile facts (add/delete + demographics update), closeout finalization, commit intent sheet, verify fact, resolve conflict
- `CommitSummary` extended with `profileId` so the commit hook can target the right profile

**Pre-computed common answers (`services/profileIndex.ts` + `lib/types/ask.ts`):**
- `PreComputedAnswers` interface attached to `ProfileIndex`
- Computed during the same walk that builds CanonicalFacts — zero additional DB queries
- Fields: `activeMedCount`, `activeMedNames`, `latestA1c`, `latestBP`, `latestLipids`, `nextAppointment`, `lastAppointment`, `allergySummary`, `conditionSummary`, `insuranceSummary`, `preventiveDueCount`, `preventiveDueSoonCount`, `primaryCareProvider`, `primaryPharmacy`, `totalOwed`, `openBillCount`, `totalProfileFacts`
- Engine fast path: `executeListAll` for medications now reads name list and count from the snapshot instead of re-iterating; `executeCompute` returns directly from the snapshot

**Expanded deterministic intent coverage:**
- New `compute` query type for derived answers (no underlying single-fact)
- New entity domain `specialty_name`; new attributes for the new med/lab/profile intents
- 12 new intents:
  - Medications: `GET_MED_FREQUENCY`, `GET_MED_PHARMACY`, `GET_MED_DURATION`, `IS_TAKING_MED`
  - Labs: `IS_LAB_NORMAL`
  - Care team: `GET_PRIMARY_CARE`, `GET_PHARMACY_INFO`
  - Billing: `GET_TOTAL_OWED`
  - Preventive: `IS_UP_TO_DATE`
  - Profile: `GET_DOB`, `GET_AGE`, `GET_BLOOD_TYPE`
- Router now strips verbal opener prefixes before keyword matching ("please show me…", "tell me about…")
- Gap actions extended so all new med-entity and lab-entity intents share the existing add-medication / add-lab CTAs

**Performance timing:**
- `__DEV__`-only console logs in `services/askOrchestrator.ts`
- Per-query line: `[Ask] "<query>" | src=<source> | cached=<bool> | total=<ms> | route=<ms> | engine=<ms> | fallback=<ms>`
- Index build line: `[Ask] indexBuild profileId=… facts=… time=…ms`
- No production cost, no DB writes

**Key files for Item 6:** `services/askCache.ts`, `services/askInvalidation.ts`, `services/askOrchestrator.ts`, `services/askIntents.ts`, `services/askEngine.ts`, `services/askRouter.ts`, `services/profileIndex.ts`, `services/askGapActions.ts`, `services/commit.ts`, `lib/types/ask.ts`, `hooks/useAsk.ts`

#### UI Overhaul — COMPLETE

End-to-end navigation, home screen, and visual system refresh. Pure UI/UX work — no service or data-layer changes.

**Part 1 — Navigation restructure:**
- 5 new tabs: **Home**, **Health**, **Activity**, **Documents**, **Ask**
- **Health tab** is the consolidated hub for profile / medications / conditions / results / preventive / care team
- **Activity tab** combines tasks + appointments into a single timeline
- **Ask** promoted from FAB to a permanent tab
- **Settings** moved out of the tab bar to a gear icon in the header
- FAB removed entirely; `TabHeader` component renders profile avatar + settings gear consistently across tabs
- Old tab files removed: `household.tsx`, `settings.tsx`, `tasks.tsx`

**Part 2 — Home screen redesign:**
- Reduced from 1457 lines to **134 lines** by extracting logic into hooks and components
- Four zones only: **Greeting**, **Today Card**, **Quick Actions Grid (2×4)**, **Needs Attention List** (max 3 items)
- New `services/needsAttention.ts` aggregator consolidates all prompts/nudges into a single ranked list
- `MilestoneToast` for one-time celebrations (e.g., profile tier upgrades, streak milestones)
- Side-effect logic split into `useHomeSideEffects` hook (notification scheduling, prefetches, etc.)
- Data-fetching logic split into `useHomeScreen` hook

**Part 3 — Visual polish:**
- Design token system in `lib/constants/design.ts`: `SPACING`, `RADIUS`, `SHADOWS`, `TYPOGRAPHY`
- Updated color palette: warm tones, expanded status colors, accent colors
- Reusable UI primitives: `Card`, `StatusBadge`, `SectionHeader`
- Global warm background `#F9FAFB` replaces previous neutral

**Part 3b — Quick actions grid + flow polish:**
- 2×4 quick actions grid: **Priorities, Catch Up, Snap Photo, Import, Medications, Appointments, Voice Note, Tasks**
- Catch Up flow integrates profile strengthening at top of the batch capture pipeline
- Back-navigation fixes across all deep screens (consistent home button + chevron behavior 3+ levels deep)

**Key files for the UI Overhaul:**
- New components: `components/ui/Card.tsx`, `components/ui/StatusBadge.tsx`, `components/ui/SectionHeader.tsx`, `components/ui/TabHeader.tsx`, `components/TodayCard.tsx`, `components/QuickActionsGrid.tsx`, `components/NeedsAttentionList.tsx`, `components/MilestoneToast.tsx`, `components/modules/TasksContent.tsx`
- New service: `services/needsAttention.ts`
- New hooks: `hooks/useHomeScreen.ts`, `hooks/useHomeSideEffects.ts`
- New tokens: `lib/constants/design.ts`
- New tab screens: `app/(main)/(tabs)/health.tsx`, `app/(main)/(tabs)/activity.tsx`, `app/(main)/(tabs)/ask.tsx`
- New settings location: `app/(main)/settings/`

#### UI Overhaul — Additional Polish — COMPLETE

Follow-up pass on the UI Overhaul covering family/caregivers restructure, multi-profile switching, branded Home header, and full dark-mode support.

**Family member management:**
- New flow to add dependent profiles (parent, child, spouse, sibling, grandparent) directly from the Family & Caregivers tab
- Migration `20260422_family_members.sql` adds `add_family_member` RPC (SECURITY DEFINER) — bypasses the RLS chicken-and-egg for new profiles in the same household
- Household screen restructured into two sections: **Family Members** (dependents you manage) and **Caregivers** (people who can help with your care)
- Header renamed: "Caregivers" → "Family & Caregivers"
- New screen: `app/(main)/caregivers/add-member.tsx`

**Profile switcher:**
- Bottom-sheet modal (`components/ProfileSwitcher.tsx`) triggered from the `TabHeader` avatar
- Deterministic avatar colors per profile via `lib/utils/profileAvatar.ts` (stable hash → color)
- "View Profile" action navigates straight to the profile detail screen
- Nuclear TanStack Query invalidation on profile switch — guarantees zero data leakage between profiles
- Chevron-down hint on the avatar appears only when multiple profiles exist
- "Viewing [Name]'s Profile" subtitle shown when the active profile is a dependent (not the account holder)

**Branded Home header:**
- `TabHeader` `variant='branded'` renders with dark-green background, "CL" wordmark + leaf icon, white UI elements
- Safe-area painted in brand color so the status bar blends seamlessly
- Centered greeting on Home uses the **account holder's** first name (not the active profile's name) — keeps the greeting personal even when caregivers are viewing a dependent's data

**Dark mode:**
- Full theme system: `lib/constants/themes.ts` (LIGHT_THEME / DARK_THEME palettes), `stores/themeStore.ts` (persisted preference), `hooks/useTheme.ts` (resolves theme + system preference)
- Settings toggle: Light / Dark / System
- Wired into: Home, Health, Activity, tab bar, `Card`, `TodayCard`, `QuickActionsGrid`, `NeedsAttentionList`, `TabHeader`
- Status bar adapts to active theme
- Existing module screens (medications, results, billing, preventive, etc.) stay light-only for now — gradual migration path via the `useColors` hook avoids one giant rewrite

**Key new files for Additional Polish:**
- `lib/constants/themes.ts`, `stores/themeStore.ts`, `hooks/useTheme.ts`
- `lib/utils/profileAvatar.ts`
- `components/ProfileSwitcher.tsx`
- `app/(main)/caregivers/add-member.tsx`
- Migration: `supabase/migrations/20260422_family_members.sql`

#### Item 7: HIPAA Alignment Review & Remediation — COMPLETE

Security hardening sweep across logging, persistence, RLS, Edge Functions, error display, account lifecycle, and data portability. No new user-facing features; several new internal primitives.

**PHI-safe logging (`lib/utils/safeLog.ts`, `supabase/functions/_shared/logging.ts`):**
- `safeLog` / `safeWarn` are no-ops outside `__DEV__`, so dev debugging stays intact without leaking PHI in production builds.
- `safeError` always runs but summarizes errors to `name` / `code` / `status` and redacts quoted strings, emails, and phone numbers from error messages.
- Client-side `console.log`/`console.error` that touched extraction responses, profile data, or Supabase error bodies were swapped for these helpers (`services/extraction.ts`, `services/biometric.ts`, `services/profileIndex.ts`, `services/healthSummaryImport.ts`, `hooks/useIntentSheet.ts`, capture screens, onboarding screens).
- Every Edge Function now imports `logError` from `_shared/logging.ts`. Response bodies from the Claude API (`await resp.text()`) are drained but never logged, and `textBlock.text` — the extracted PHI — is never logged even on parse failure.

**Persistent storage audit:**
- No `AsyncStorage` usage in the codebase. Confirmed in `stores/*`, `services/*`, `hooks/*`.
- Auth tokens, PIN hashes, biometric prefs, session duration, cooldown timestamps, pending invite tokens, and dismissal IDs all go through `expo-secure-store` (Keychain / Keystore).
- The wellness visit store persists freeform PHI to the app-sandboxed `FileSystem.documentDirectory` (encrypted at rest on iOS via default File Protection; app-private on Android) because the freeform dictation can exceed SecureStore's 2KB-per-key limit. `clearWellnessVisitPersisted()` is now called from `cleanupOnSignOut` so the file never survives across sign-outs.

**RLS audit migration (`supabase/migrations/20260421_rls_audit.sql`):**
- Idempotently re-asserts `ENABLE ROW LEVEL SECURITY` on every patient-data table (41 tables) + `storage.objects`.
- Fills in missing DELETE policies: `profile_facts`, `apt_appointments`, `apt_closeouts`, `apt_outcomes`, `profile_access_grants`, `household_members`, `caregiver_invites` — each scoped with `has_profile_access()` or `is_household_member()` / `user_id = auth.uid()`.
- Defensive `DROP POLICY IF EXISTS` on `preventive_rules` write paths and `security_audit_log` read/write paths to document that those tables remain service-role-only.
- Runs a `DO $$` block at the end that counts SELECT policies per expected table and raises if any are missing — a sanity tripwire for future regressions.

**Account deletion (`supabase/migrations/20260421_delete_account.sql`, `services/auth.ts`, `app/(main)/settings/delete-account.tsx`):**
- `delete_user_account()` RPC (SECURITY DEFINER) wipes every public-schema row for households where the caller is the sole active member: billing (13 tables), results (4), preventive (3), appointments (4), medications (4), intent/extraction, tasks, profile facts, priorities, access grants, consent records, caregiver invites, user preferences.
- For shared households the RPC only removes the caller's `household_members` row and access grants; other members retain their data.
- `auth.users` row is left for an admin/cron cleanup (needs service role); local sign-out + SecureStore clear happens immediately so the device can't reuse the lingering auth row.
- Settings screen: "Delete Account" button below Sign Out opens a dedicated screen with two-step confirmation (warning → type `DELETE` to confirm).
- Final `audit_events` row `account.deleted` is written before the RPC returns (non-PHI metadata only — counts of households/profiles/grants removed).

**User-facing error sanitization (`lib/utils/sanitizeError.ts`):**
- Maps recognizable error shapes (network / auth / rate limit / extraction / DB constraint violation) to short, generic user-safe strings. Anything unrecognized falls through to `DEFAULT_FALLBACK` — raw messages are never echoed to the user.
- Applied at the highest-risk `Alert.alert(..., err.message)` sites: `MicroCapture.tsx`, caregivers screens, profile edit / add-fact, results detail + review, billing appeals + add-document, capture camera/upload.

**Data export (`services/dataExport.ts`, `app/(main)/settings/export-data.tsx`):**
- HIPAA right-of-access fulfillment. Builds a plain-text snapshot of profile, medications, conditions, allergies, care team, insurance, appointments, tasks, results, preventive care, bills, and patient priorities, then opens the system Share sheet.
- Structured data only — uploaded document binaries are excluded (already retrievable one-at-a-time from each module).
- Linked from Settings → Account → "Export My Data" above Sign Out.

**Storage bucket verification:**
- `artifacts`, `billing-documents`, `result-documents` all have INSERT/SELECT/UPDATE/DELETE policies scoped to the first path segment (profile UUID or household UUID) via `has_profile_access()` / `is_household_member()`. All private buckets, all authenticated-only. `storage.objects` RLS re-asserted in the audit migration.

#### Phase 3: Remaining Items
- [ ] Item 8: App Store preparation

