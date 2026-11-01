// Map key: what each line and pin on the map means.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { COLORS, FONT } from '@/lib/config';
import { LINE_STYLE, PLACE_META, type LineStyle } from '@/lib/labels';
import type { PlaceKind } from '@/lib/osm';

const LINES: { style: LineStyle; label: string }[] = [
  { style: LINE_STYLE.path_paved, label: 'Car-free paved path' },
  { style: LINE_STYLE.path_unpaved, label: 'Unpaved trail (gravel or crushed stone)' },
  { style: LINE_STYLE.lane, label: 'On-street bike lane' },
  { style: LINE_STYLE.hiking, label: 'Hiking only: no bikes (in state parks)' },
  { style: LINE_STYLE.parkUnknown, label: 'Park path: check signs for bikes' },
];

const PLACE_ORDER: PlaceKind[] = ['shop', 'repair', 'parking', 'water', 'restroom', 'playground', 'food', 'drink'];

export function MapKey({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close map key" accessibilityRole="button" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Map key</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close map key" style={styles.close}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={styles.section} accessibilityRole="header">Lines</Text>
          {LINES.map((l) => (
            <View key={l.label} style={styles.row}>
              <Svg width={44} height={12} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Line
                  x1={2} y1={6} x2={42} y2={6}
                  stroke={l.style.color}
                  strokeWidth={l.style.width + 1}
                  strokeDasharray={l.style.dash?.join(' ')}
                  strokeLinecap="round"
                />
              </Svg>
              <Text style={styles.label}>{l.label}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <View style={styles.highlight} />
            <Text style={styles.label}>Selected trail (red stripe: section where a state trail pass is needed)</Text>
          </View>

          <Text style={styles.section} accessibilityRole="header">Pins</Text>
          <View style={styles.row}>
            <View style={[styles.pin, { backgroundColor: COLORS.bcycle }]}>
              <Ionicons name="bicycle" size={13} color="#fff" />
            </View>
            <Text style={styles.label}>BCycle station (number = bikes ready; grey = none right now)</Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.pin, { backgroundColor: COLORS.partner }]}>
              <Ionicons name="star" size={12} color={COLORS.text} />
            </View>
            <Text style={styles.label}>Sponsored local business</Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.pin, { backgroundColor: COLORS.park }]}>
              <Ionicons name="leaf" size={12} color="#fff" />
            </View>
            <Text style={styles.label}>Wisconsin state park</Text>
          </View>
          {PLACE_ORDER.map((k) => (
            <View key={k} style={styles.row}>
              <View style={[styles.pin, { backgroundColor: PLACE_META[k].color }]}>
                <Ionicons name={PLACE_META[k].icon as keyof typeof Ionicons.glyphMap} size={12} color="#fff" />
              </View>
              <Text style={styles.label}>{PLACE_META[k].plural === PLACE_META[k].label ? PLACE_META[k].label : PLACE_META[k].plural}</Text>
            </View>
          ))}
          <Text style={styles.note}>Turn pins on and off with Layers. Some pins appear only when you zoom in.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  title: { fontSize: 22, fontFamily: FONT.black, color: COLORS.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.text, marginTop: 12, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40, paddingVertical: 4 },
  label: { flex: 1, fontSize: 15, color: COLORS.text },
  pin: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', marginHorizontal: 9,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  highlight: { width: 44, height: 8, borderRadius: 4, backgroundColor: '#facc15' },
  note: { fontSize: 14, color: COLORS.muted, marginTop: 12 },
});
