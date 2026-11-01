// Small inline row for screens that work better with location: offers to use
// it (with the one-line explanation first), or, when it's off, a button to the
// phone's Settings. Renders nothing once location is on.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, FONT } from '@/lib/config';
import { useData } from '@/lib/data';

interface Props {
  /** What the rider gets, e.g. "Sort by distance from you". */
  action?: string;
}

export function LocationPrompt({ action = 'Use my location' }: Props) {
  const { locationStatus, requestLocation, openLocationSettings } = useData();
  if (locationStatus === 'granted') return null;
  const denied = locationStatus === 'denied';
  return (
    <View style={styles.row}>
      <Ionicons name={denied ? 'location-outline' : 'navigate-outline'} size={18} color={COLORS.brand} />
      <Text style={styles.text}>{denied ? 'Location is off' : 'Location not in use'}</Text>
      <Pressable
        onPress={() => (denied ? openLocationSettings() : void requestLocation())}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityHint={denied ? 'Opens Settings so you can turn on location for Ride Madison' : undefined}>
        <Text style={styles.btnText}>{denied ? 'Open Settings' : action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6, flexWrap: 'wrap' },
  text: { fontSize: 14, color: COLORS.text, flexShrink: 1 },
  btn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  btnText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.brand, textDecorationLine: 'underline' },
});
