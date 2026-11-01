// Two-question onboarding: what do you ride, and how comfortable are you in
// traffic. Answers set route defaults; changeable later under More.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon, Wordmark } from '@/components/brand';
import { BRAND, COLORS, FONT } from '@/lib/config';
import { BIKE_OPTIONS, COMFORT_OPTIONS, type BikeType, type Comfort, type Prefs } from '@/lib/prefs';

interface Props {
  visible: boolean;
  initial?: Prefs | null;
  onDone: (p: Prefs) => void;
  onSkip?: () => void;
}

export function Onboarding({ visible, initial, onDone, onSkip }: Props) {
  const [bike, setBike] = useState<BikeType | null>(initial?.bike ?? null);
  const [comfort, setComfort] = useState<Comfort | null>(initial?.comfort ?? null);
  const ready = bike && comfort;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onSkip}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <AppIcon size={64} />
          <Text style={styles.welcome}>
            Welcome to <Wordmark size={28} />
          </Text>
          <Text style={styles.sub}>Two quick questions so routes fit how you ride.</Text>

          <Text style={styles.q}>What do you ride?</Text>
          <View style={styles.grid}>
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

          <Text style={styles.q}>How comfortable are you riding in traffic?</Text>
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
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            disabled={!ready}
            onPress={() => ready && onDone({ bike, comfort })}
            style={[styles.cta, !ready && { opacity: 0.4 }]}
            accessibilityRole="button">
            <Text style={styles.ctaText}>Start riding</Text>
          </Pressable>
          {onSkip && (
            <Pressable onPress={onSkip} hitSlop={10} style={{ alignSelf: 'center', padding: 8 }}>
              <Text style={styles.skip}>Skip for now</Text>
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
  welcome: { fontSize: 28, fontFamily: FONT.black, color: COLORS.text, marginTop: 16 },
  sub: { fontSize: 16, color: COLORS.muted, marginTop: 6 },
  q: { fontSize: 19, fontFamily: FONT.black, color: COLORS.text, marginTop: 28, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', flexGrow: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', gap: 6,
  },
  tileOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tileText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.text },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  optionOn: { borderColor: COLORS.brand, backgroundColor: BRAND.cream },
  optionTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  optionDetail: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  footer: { paddingHorizontal: 24, paddingBottom: 8, gap: 4 },
  cta: { backgroundColor: BRAND.red, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontFamily: FONT.black },
  skip: { color: COLORS.muted, fontSize: 15 },
});
