// Every turn of a ride as text ("In 0.3 mi turn left onto Capital City
// Trail"), for reading ahead and for screen reader users.

import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { ManeuverIcon } from '@/components/maneuver-icon';
import { BRAND, COLORS, FONT } from '@/lib/config';
import { formatDistance } from '@/lib/geo';
import { directionsList, type Maneuver } from '@/lib/navigation';

export function DirectionsSheet({ visible, title, maneuvers, totalM, onClose }: {
  visible: boolean;
  title: string;
  maneuvers: Maneuver[];
  totalM: number;
  onClose: () => void;
}) {
  const rows = directionsList(maneuvers);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">Directions</Text>
            <Text style={styles.sub} numberOfLines={2}>{title} · {formatDistance(totalM)}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <FlatList
          data={rows}
          keyExtractor={(r, i) => `${r.maneuver.index}:${i}`}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListHeaderComponent={<Text style={styles.row}>Start the ride</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No turns: just follow the route.</Text>}
          renderItem={({ item }) => (
            <View style={styles.item} accessible accessibilityLabel={item.text}>
              <View style={styles.icon}>
                <ManeuverIcon type={item.maneuver.type} size={22} color="#fff" />
              </View>
              <Text style={styles.text}>{item.text}</Text>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  title: { fontSize: 22, fontFamily: FONT.black, color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.muted, marginTop: 2 },
  done: { minHeight: 44, justifyContent: 'center' },
  doneText: { fontSize: 16, fontFamily: FONT.bold, color: BRAND.navy },
  row: { fontSize: 15, color: COLORS.muted, paddingHorizontal: 16, paddingBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: BRAND.navy, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 16, color: COLORS.text },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginLeft: 64 },
  empty: { padding: 24, textAlign: 'center', color: COLORS.muted, fontSize: 15 },
});
