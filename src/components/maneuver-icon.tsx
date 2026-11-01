import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import type { ManeuverType } from '@/lib/navigation';
import { useTheme } from '@/lib/theme';

/** Turn arrow: an up arrow rotated to the turn's direction. */
const ROTATION: Record<ManeuverType, number> = {
  'slight-left': -45,
  left: -90,
  'sharp-left': -135,
  'slight-right': 45,
  right: 90,
  'sharp-right': 135,
  uturn: 180,
  arrive: 0,
};

export function ManeuverIcon({ type, size, color }: { type: ManeuverType; size: number; color: string }) {
  if (type === 'arrive') return <Ionicons name="flag" size={size} color={color} />;
  if (type === 'uturn') return <Ionicons name="return-down-back" size={size} color={color} />;
  return (
    <View style={{ transform: [{ rotate: `${ROTATION[type]}deg` }] }}>
      <Ionicons name="arrow-up" size={size} color={color} />
    </View>
  );
}

/** The rider's bike marker: white disc, bike glyph, colored ring and soft halo. */
export function BikeMarker({ color, size = 44 }: { color: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size + 18, height: size + 18, borderRadius: (size + 18) / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${color}33`,
      }}>
      <View
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: c.dark ? c.surface : '#FFFFFF', borderWidth: 3, borderColor: color,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: c.shadow, shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 6,
        }}>
        <Ionicons name="bicycle" size={size * 0.58} color={color} />
      </View>
    </View>
  );
}
