// Small inline row for screens that work better with location: offers to use
// it (with the one-line explanation first), or, when it's off, a button to the
// phone's Settings. Renders nothing once location is on.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { FONT } from '@/lib/config';
import { useData } from '@/lib/data';
import { useT } from '@/lib/i18n';
import { makeStyles, useTheme } from '@/lib/theme';

interface Props {
  /** What the rider gets, e.g. "Sort by distance from you" (already translated). Defaults to "Use my location". */
  action?: string;
}

export function LocationPrompt({ action }: Props) {
  const { locationStatus, requestLocation, openLocationSettings } = useData();
  const { t } = useT();
  const { c } = useTheme();
  const styles = useStyles();
  if (locationStatus === 'granted') return null;
  const denied = locationStatus === 'denied';
  return (
    <View style={styles.row}>
      <Ionicons name={denied ? 'location-outline' : 'navigate-outline'} size={18} color={c.primary} />
      <Text style={styles.text}>{denied ? t('map.loc.offTitle') : t('map.loc.notInUse')}</Text>
      <Pressable
        onPress={() => (denied ? openLocationSettings() : void requestLocation())}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityHint={denied ? t('map.loc.settingsHint') : undefined}>
        <Text style={styles.btnText}>{denied ? t('common.openSettings') : (action ?? t('map.loc.useMine'))}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6, flexWrap: 'wrap' },
  text: { fontSize: 14, color: c.text, flexShrink: 1 },
  btn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  btnText: { fontSize: 14, fontFamily: FONT.bold, color: c.primary, textDecorationLine: 'underline' },
}));
