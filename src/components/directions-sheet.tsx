// Every turn of a ride as text ("In 0.3 mi turn left onto Capital City
// Trail"), for reading ahead and for screen reader users.

import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { ManeuverIcon } from '@/components/maneuver-icon';
import { FONT } from '@/lib/config';
import { formatDistance } from '@/lib/geo';
import { useT } from '@/lib/i18n';
import { directionsList, type Maneuver } from '@/lib/navigation';
import { makeStyles, useTheme } from '@/lib/theme';

export function DirectionsSheet({ visible, title, maneuvers, totalM, onClose }: {
  visible: boolean;
  title: string;
  maneuvers: Maneuver[];
  totalM: number;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { c } = useTheme();
  const { t } = useT();
  const rows = directionsList(maneuvers);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">{t('route.directions')}</Text>
            <Text style={styles.sub} numberOfLines={2}>{title} · {formatDistance(totalM)}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.done}>
            <Text style={styles.doneText}>{t('common.done')}</Text>
          </Pressable>
        </View>
        <FlatList
          data={rows}
          keyExtractor={(r, i) => `${r.maneuver.index}:${i}`}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListHeaderComponent={<Text style={styles.row}>{t('route.dir.startRide')}</Text>}
          ListEmptyComponent={<Text style={styles.empty}>{t('route.dir.noTurns')}</Text>}
          renderItem={({ item }) => (
            <View style={styles.item} accessible accessibilityLabel={item.text}>
              <View style={styles.icon}>
                <ManeuverIcon type={item.maneuver.type} size={22} color={c.onPrimary} />
              </View>
              <Text style={styles.text}>{item.text}</Text>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  sheet: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  title: { fontSize: 22, fontFamily: FONT.black, color: c.text },
  sub: { fontSize: 14, color: c.textMuted, marginTop: 2 },
  done: { minHeight: 44, justifyContent: 'center' },
  doneText: { fontSize: 16, fontFamily: FONT.bold, color: c.primary },
  row: { fontSize: 15, color: c.textMuted, paddingHorizontal: 16, paddingBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 16, color: c.text },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 64 },
  empty: { padding: 24, textAlign: 'center', color: c.textMuted, fontSize: 15 },
}));
