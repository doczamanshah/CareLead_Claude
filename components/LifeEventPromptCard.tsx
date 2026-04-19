/**
 * Life-event prompt card.
 *
 * A small, warm, non-intrusive card that surfaces a contextual follow-up
 * after a profile change — e.g. "Do you have Type 2 Diabetes?" after adding
 * Metformin. Not a modal. Not a blocker. Dismissible.
 *
 * Behavior:
 *   • Primary/outline buttons reflect the action's `primary` flag.
 *   • Route actions navigate; handler actions bubble up to the parent via
 *     `onHandler` (keeps the store serializable — we don't wire functions
 *     into Zustand).
 *   • After 30s of inactivity the card fades out and dismisses itself.
 *   • Tap the X in the corner to dismiss immediately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  LifeEventAction,
  LifeEventPrompt,
} from '@/lib/types/lifeEvents';

const AUTO_DISMISS_MS = 30000;
const FADE_OUT_MS = 350;

interface Props {
  prompt: LifeEventPrompt;
  onDismiss: (promptId: string) => void;
  /**
   * Called for actions whose `handler` identifier can't be resolved via a
   * route. The parent screen supplies this — e.g. "add_condition" creates a
   * profile fact, "archive_condition" soft-deletes one.
   */
  onHandler?: (
    handlerId: string,
    payload: Record<string, unknown> | undefined,
    prompt: LifeEventPrompt,
  ) => void;
}

export function LifeEventPromptCard({ prompt, onDismiss, onHandler }: Props) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoDismiss = useCallback(() => {
    if (autoDismissTimer.current) {
      clearTimeout(autoDismissTimer.current);
      autoDismissTimer.current = null;
    }
  }, []);

  const fadeOutAndDismiss = useCallback(() => {
    if (dismissing) return;
    setDismissing(true);
    clearAutoDismiss();
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => {
      onDismiss(prompt.id);
    });
  }, [clearAutoDismiss, dismissing, onDismiss, opacity, prompt.id]);

  // Mount: fade in + start 30s auto-dismiss timer. Re-run when the prompt ID
  // changes so each new prompt gets its own fresh timer.
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    autoDismissTimer.current = setTimeout(() => {
      fadeOutAndDismiss();
    }, AUTO_DISMISS_MS);

    return clearAutoDismiss;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt.id]);

  const handleAction = useCallback(
    async (action: LifeEventAction) => {
      clearAutoDismiss();

      // "dismiss" / "confirm" quickActions just close the card.
      if (action.quickAction === 'dismiss' || action.quickAction === 'confirm') {
        fadeOutAndDismiss();
        return;
      }

      // Built-in share handler — used for "Send them a reminder" on caregiver
      // prompts. Keeps parent screens from having to know about Share.
      if (action.handler === 'caregiver_open_share') {
        const payload = action.handlerPayload ?? {};
        const url = typeof payload.shareUrl === 'string' ? payload.shareUrl : null;
        const message = url
          ? `I'm using CareLead to keep my health info organized. Would you help me by adding what you know? ${url}`
          : "I'm using CareLead to keep my health info organized. Would you help me by adding what you know?";
        try {
          await Share.share({ message });
        } catch {
          // user cancelled
        }
        fadeOutAndDismiss();
        return;
      }

      if (action.handler && onHandler) {
        onHandler(action.handler, action.handlerPayload, prompt);
        fadeOutAndDismiss();
        return;
      }

      if (action.route) {
        const params = action.params;
        if (params && Object.keys(params).length > 0) {
          router.push({ pathname: action.route, params } as never);
        } else {
          router.push(action.route as never);
        }
        fadeOutAndDismiss();
        return;
      }

      // No-op fallback — just close the card.
      fadeOutAndDismiss();
    },
    [clearAutoDismiss, fadeOutAndDismiss, onHandler, prompt, router],
  );

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Ionicons name="bulb-outline" size={18} color={COLORS.accent.dark} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{prompt.title}</Text>
          <Text style={styles.detail}>{prompt.detail}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            clearAutoDismiss();
            fadeOutAndDismiss();
          }}
          hitSlop={10}
          accessibilityLabel="Dismiss prompt"
          style={styles.dismissButton}
        >
          <Ionicons name="close" size={18} color={COLORS.text.tertiary} />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        {prompt.actions.map((action, idx) => {
          const isPrimary = action.primary === true;
          return (
            <TouchableOpacity
              key={`${prompt.id}-action-${idx}`}
              style={[
                styles.actionButton,
                isPrimary ? styles.actionButtonPrimary : styles.actionButtonSecondary,
              ]}
              activeOpacity={0.8}
              onPress={() => handleAction(action)}
            >
              <Text
                style={[
                  styles.actionButtonText,
                  isPrimary && styles.actionButtonTextPrimary,
                ]}
              >
                {action.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.accent.DEFAULT + '14',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT + '33',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.accent.DEFAULT + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  detail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
    lineHeight: 19,
  },
  dismissButton: {
    padding: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  actionButtonPrimary: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  actionButtonSecondary: {
    borderWidth: 1,
    borderColor: COLORS.border.dark,
    backgroundColor: 'transparent',
  },
  actionButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  actionButtonTextPrimary: {
    color: '#FFFFFF',
  },
});
