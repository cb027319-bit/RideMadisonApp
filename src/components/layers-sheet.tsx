// All map layers as named switches (the map itself shows only a few chips).

import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { COLORS, FONT } from '@/lib/config';

export interface LayerOption<Id extends string> {
  id: Id;
  label: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  group: 'map' | 'places';
  hint?: string;
}

interface Props<Id extends string> {
  visible: boolean;
  layers: LayerOption<Id>[];
  on: Record<Id, boolean>;
  onToggle: (id: Id) => void;
  onClose: () => void;
  onShowKey: () => void;
}

export function LayersSheet<Id extends string>({ visible, layers, on, onToggle, onClose, onShowKey }: Props<Id>) {
  const groups: { title: string; items: LayerOption<Id>[] }[] = [
    { title: 'Map', items: layers.filter((l) => l.group === 'map') },
    { title: 'Places', items: layers.filter((l) => l.group === 'places') },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close layers" accessibilityRole="button" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Layers</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close layers" style={styles.close}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {groups.map((g) => (
            <View key={g.title}>
              <Text style={styles.section} accessibilityRole="header">{g.title}</Text>
              {g.items.map((l) => (
                <Pressable
                  key={l.id}
                  style={styles.row}
                  onPress={() => onToggle(l.id)}
                  accessibilityRole="switch"
                  accessibilityLabel={l.label}
                  accessibilityHint={l.hint}
                  accessibilityState={{ checked: on[l.id] }}>
                  <View style={[styles.icon, { backgroundColor: l.color }]}>
                    <Ionicons name={l.icon} size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{l.label}</Text>
                    {l.hint ? <Text style={styles.hint}>{l.hint}</Text> : null}
                  </View>
                  <Switch
                    value={on[l.id]}
                    onValueChange={() => onToggle(l.id)}
                    trackColor={{ true: COLORS.brand, false: '#D1D5DB' }}
                    accessibilityLabel={l.label}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                  />
                </Pressable>
              ))}
            </View>
          ))}
          <Pressable style={styles.keyRow} onPress={onShowKey} accessibilityRole="button">
            <Ionicons name="information-circle-outline" size={20} color={COLORS.brand} />
            <Text style={styles.keyText}>What do the lines and pins mean?</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%', backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  title: { fontSize: 22, fontFamily: FONT.black, color: COLORS.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.muted, marginTop: 12, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.text },
  hint: { fontSize: 13, color: COLORS.muted, marginTop: 1 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginTop: 12 },
  keyText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.brand, textDecorationLine: 'underline' },
});
