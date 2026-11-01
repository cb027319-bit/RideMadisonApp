// Short onboarding: what do you ride (plus e-bike class), and how comfortable
// are you in traffic. Answers set route defaults; changeable later under More
// (mode="edit": "Your riding" with Save / Cancel).

import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon, Wordmark } from '@/components/brand';
import { BRAND, COLORS, FONT } from '@/lib/config';
import {
  BIKE_OPTIONS, COMFORT_OPTIONS, EBIKE_CLASS_OPTIONS, buildPrefs, prefsComplete, type BikeType, type Comfort, type EbikeClass,
  type Prefs,
} from '@/lib/rider';

interface Props {
  visible: boolean;
  /** 'welcome' on first open; 'edit' when opened from More. */
  mode?: 'welcome' | 'edit';
  initial?: Prefs | null;
  onDone: (p: Prefs) => void;
  /** First open: "Skip for now". Edit: "Cancel". */
  onSkip?: () => void;
}

export function Onboarding({ visible, mode = 'welcome', initial, onDone, onSkip }: Props) {
  const editing = mode === 'edit';
  const [bike, setBike] = useState<BikeType | null>(initial?.bike ?? null);
  const [comfort, setComfort] = useState<Comfort | null>(initial?.comfort ?? null);
  const [ebikeClass, setEbikeClass] = useState<EbikeClass | null>(initial?.ebikeClass ?? null);
  const ready = prefsComplete(bike, comfort, ebikeClass);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onSkip}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {editing ? (
            <>
              <Text style={styles.welcome} accessibilityRole="header">Your riding</Text>
              <Text style={styles.sub}>Routes and trail rules follow your answers.</Text>
            </>
          ) : (
            <>
              <AppIcon size={64} />
              <View style={styles.titleRow} accessible accessibilityRole="header" accessibilityLabel="Welcome to Ride Madison">
                <Text style={styles.welcome}>Welcome to </Text>
                <Wordmark size={28} />
              </View>
              <Text style={styles.sub}>Two quick questions so routes fit how you ride.</Text>
            </>
          )}

          <Text style={styles.q} accessibilityRole="header">What do you ride?</Text>
          <View style={styles.grid} accessibilityRole="radiogroup">
            {BIKE_OPTIONS.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setBike(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: bike === o.id }}
                style={[styles.tile, bike === o.id && styles.tileOn]}>
                <Ionicons name={o.icon as keyof typeof Ionicons.glyphMap} size={24} color={bike === o.id ? '#fff' : COLORS.brand} />
                <Text style={[styles.tileText, bike === o.id && { color: '#fff' }]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>

          {bike === 'ebike' && (
            <>
              <Text style={styles.q} accessibilityRole="header">Which class?</Text>
              <Text style={styles.hint}>It’s on a sticker on the frame. Trail rules differ by class.</Text>
              <View style={styles.grid} accessibilityRole="radiogroup">
                {EBIKE_CLASS_OPTIONS.map((o) => (
                  <Pressable
                    key={o.id}
                    onPress={() => setEbikeClass(o.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: ebikeClass === o.id }}
                    accessibilityHint={o.detail}
                    style={[styles.classChip, ebikeClass === o.id && styles.tileOn]}>
                    <Text style={[styles.tileText, ebikeClass === o.id && { color: '#fff' }]}>{o.label}</Text>
                    <Text style={[styles.chipDetail, ebikeClass === o.id && { color: BRAND.limestone }]}>{o.detail}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.q} accessibilityRole="header">How comfortable are you riding in traffic?</Text>
          <View accessibilityRole="radiogroup">
            {COMFORT_OPTIONS.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setComfort(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: comfort === o.id }}
                style={[styles.option, comfort === o.id && styles.optionOn]}>
                <Ionicons
                  name={comfort === o.id ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={comfort === o.id ? COLORS.brand : COLORS.muted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{o.label}</Text>
                  <Text style={styles.optionDetail}>{o.detail}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            disabled={!ready}
            onPress={() => {
              if (bike && comfort && ready) onDone(buildPrefs(bike, comfort, ebikeClass));
            }}
            style={[styles.cta, !ready && { opacity: 0.4 }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}>
            <Text style={styles.ctaText}>{editing ? 'Save' : 'Start riding'}</Text>
          </Pressable>
          {onSkip && (
            <Pressable onPress={onSkip} style={styles.skipBtn} accessibilityRole="button">
              <Text style={styles.skip}>{editing ? 'Cancel' : 'Skip for now'}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 24, paddingBottom: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 16 },
  welcome: { fontSize: 28, fontFamily: FONT.black, color: COLORS.text },
  sub: { fontSize: 16, color: COLORS.muted, marginTop: 6 },
  q: { fontSize: 19, fontFamily: FONT.black, color: COLORS.text, marginTop: 28, marginBottom: 12 },
  hint: { fontSize: 14, color: COLORS.muted, marginTop: -6, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', flexGrow: 1, minHeight: 72, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  classChip: {
    width: '48%', flexGrow: 1, minHeight: 56, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  tileOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tileText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.text, textAlign: 'center' },
  chipDetail: { fontSize: 13, color: COLORS.muted, textAlign: 'center' },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 14, padding: 14, marginBottom: 10, minHeight: 56,
  },
  optionOn: { borderColor: COLORS.brand, backgroundColor: BRAND.cream },
  optionTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  optionDetail: { fontSize: 14, color: COLORS.muted, marginTop: 2 },
  footer: { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
  cta: { backgroundColor: BRAND.red, borderRadius: 14, minHeight: 52, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontFamily: FONT.black },
  skipBtn: { alignSelf: 'center', minHeight: 44, minWidth: 120, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  skip: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
});
