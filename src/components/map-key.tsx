// Map key: what each line and pin on the map means.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { COLORS, FONT } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { LINE_STYLE, lineColor, PLACE_META, type LineStyle } from '@/lib/labels';
import type { PlaceKind } from '@/lib/osm';
import { makeStyles, useTheme } from '@/lib/theme';

/** `label` is an i18n key. */
const LINES: { style: LineStyle; label: string }[] = [
  { style: LINE_STYLE.path_paved, label: 'map.path.paved' },
  { style: LINE_STYLE.path_unpaved, label: 'map.key.unpaved' },
  { style: LINE_STYLE.lane, label: 'map.path.lane' },
  { style: LINE_STYLE.hiking, label: 'map.key.hiking' },
  { style: LINE_STYLE.parkUnknown, label: 'map.key.parkUnknown' },
];

const PLACE_ORDER: PlaceKind[] = ['shop', 'repair', 'parking', 'water', 'restroom', 'playground', 'food', 'drink'];

export function MapKey({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('map.key.close')} accessibilityRole="button" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{t('map.mapKey')}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('map.key.close')} style={styles.close}>
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={styles.section} accessibilityRole="header">{t('map.key.lines')}</Text>
          {LINES.map((l) => (
            <View key={l.label} style={styles.row}>
              <Svg width={44} height={12} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Line
                  x1={2} y1={6} x2={42} y2={6}
                  stroke={lineColor(l.style.color, c.dark)}
                  strokeWidth={l.style.width + 1}
                  strokeDasharray={l.style.dash?.join(' ')}
                  strokeLinecap="round"
                />
              </Svg>
              <Text style={styles.label}>{t(l.label)}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <View style={styles.highlight} />
            <Text style={styles.label}>{t('map.key.selected')}</Text>
          </View>

          <Text style={styles.section} accessibilityRole="header">{t('map.key.pins')}</Text>
          <View style={styles.row}>
            <View style={[styles.pin, { backgroundColor: c.dark ? '#3B5BA9' : COLORS.bcycle }]}>
              <Ionicons name="bicycle" size={13} color="#fff" />
            </View>
            <Text style={styles.label}>{t('map.key.bcycle')}</Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.pin, { backgroundColor: COLORS.partner }]}>
              <Ionicons name="star" size={12} color={c.onGold} />
            </View>
            <Text style={styles.label}>{t('map.key.sponsored')}</Text>
          </View>
          <View style={styles.row}>
            <View style={[styles.pin, { backgroundColor: COLORS.park }]}>
              <Ionicons name="leaf" size={12} color="#fff" />
            </View>
            <Text style={styles.label}>{t('map.kicker.statePark')}</Text>
          </View>
          {PLACE_ORDER.map((k) => (
            <View key={k} style={styles.row}>
              <View style={[styles.pin, { backgroundColor: PLACE_META[k].color }]}>
                <Ionicons name={PLACE_META[k].icon as keyof typeof Ionicons.glyphMap} size={12} color="#fff" />
              </View>
              <Text style={styles.label}>{PLACE_META[k].plural === PLACE_META[k].label ? PLACE_META[k].label : PLACE_META[k].plural}</Text>
            </View>
          ))}
          <Text style={styles.note}>{t('map.key.note')}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%', backgroundColor: c.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  title: { fontSize: 22, fontFamily: FONT.black, color: c.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 16, fontFamily: FONT.bold, color: c.text, marginTop: 12, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40, paddingVertical: 4 },
  label: { flex: 1, fontSize: 15, color: c.text },
  pin: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff', marginHorizontal: 9,
    shadowColor: c.shadow, shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  highlight: { width: 44, height: 8, borderRadius: 4, backgroundColor: '#facc15' },
  note: { fontSize: 14, color: c.textMuted, marginTop: 12 },
}));
