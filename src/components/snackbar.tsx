// A brief message at the bottom of the screen, with an optional action
// ("Stop added · Undo"). Announced to VoiceOver/TalkBack; hides itself.

import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { BRAND, FONT } from '@/lib/config';

export interface SnackbarMessage {
  /** Changes for each new message so repeats are shown again. */
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Snackbar({ message, onDismiss, bottom = 24, durationMs = 4000 }: {
  message: SnackbarMessage | null;
  onDismiss: () => void;
  bottom?: number;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    AccessibilityInfo.announceForAccessibility(message.actionLabel ? `${message.text}. ${message.actionLabel} available.` : message.text);
    // Leave more time when there's an action to take.
    const t = setTimeout(onDismiss, message.actionLabel ? durationMs + 2000 : durationMs);
    return () => clearTimeout(t);
  }, [message?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!message) return null;
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={styles.bar} accessibilityLiveRegion="polite">
        <Text style={styles.text}>{message.text}</Text>
        {message.actionLabel && message.onAction ? (
          <Pressable
            onPress={() => {
              message.onAction?.();
              onDismiss();
            }}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.action}>
            <Text style={styles.actionText}>{message.actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: BRAND.navy, borderRadius: 14,
    paddingLeft: 16, paddingRight: 8, minHeight: 48, alignSelf: 'stretch',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  text: { flex: 1, color: '#fff', fontSize: 15, fontFamily: FONT.bold, paddingVertical: 12 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: BRAND.gold, fontSize: 15, fontFamily: FONT.black },
});
