// Ride Madison brand: "Capitol Spoke pin" (version A). The Capitol's radiating
// streets drawn as wheel spokes inside a map pin, navy / limestone / red / gold,
// with the "RideMadison" wordmark in Red Hat Display (heavy Ride, light Madison).

import { Text, View, type TextStyle } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { BRAND, FONT } from '@/lib/config';
import { useTheme } from '@/lib/theme';

const SPOKES =
  'M55 34 L63.5 34 M50 39 L50 47.5 M45 34 L36.5 34 M50 29 L50 20.5 M53.5 37.5 L59.5 43.5 M46.5 37.5 L40.5 43.5 M46.5 30.5 L40.5 24.5 M53.5 30.5 L59.5 24.5';

/** Mark shown after the wordmark text. Switch to '®' once the name is a registered trademark. */
export const BRAND_MARK_SYMBOL = '™';

/** The pin mark on its own (no background). `color` draws the wheel and pin. */
export function LogoMark({ size = 40, color = BRAND.limestone, hub = true }: {
  size?: number; color?: string; hub?: boolean;
}) {
  return <MarkSvg size={size} color={color} hub={hub} />;
}

function MarkSvg({ size, color, hub }: { size: number; color: string; hub: boolean }) {
  // Mark spans x 28–72, y 12–66 in the master artwork.
  return (
    <Svg width={size * (44 / 54)} height={size} viewBox="28 12 44 54" accessibilityRole="image" accessibilityLabel="Ride Madison">
      <Path d={SPOKES} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <G fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={50} cy={34} r={17} />
        <Path d="M38.7 46.7 L50 62 L61.3 46.7" />
      </G>
      <Rect x={46.5} y={30.5} width={7} height={7} fill={BRAND.red} transform="rotate(45 50 34)" />
      {hub && <Circle cx={50} cy={34} r={1.6} fill={BRAND.gold} />}
    </Svg>
  );
}

/** The app icon: navy rounded square with the mark. */
export function AppIcon({ size = 64, withText = false }: { size?: number; withText?: boolean }) {
  return <AppIconTile size={size} withText={withText} />;
}

function AppIconTile({ size, withText }: { size: number; withText: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.225, overflow: 'hidden', backgroundColor: BRAND.navy }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Rect width={100} height={100} fill={BRAND.navy} />
        <G transform={withText ? undefined : 'translate(0 14)'}>
          <Path d={SPOKES} stroke={BRAND.limestone} strokeWidth={2} strokeLinecap="round" />
          <G fill="none" stroke={BRAND.limestone} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={50} cy={34} r={17} />
            <Path d="M38.7 46.7 L50 62 L61.3 46.7" />
          </G>
          <Rect x={46.5} y={30.5} width={7} height={7} fill={BRAND.red} transform="rotate(45 50 34)" />
          <Circle cx={50} cy={34} r={1.6} fill={BRAND.gold} />
        </G>
      </Svg>
    </View>
  );
}

/** "RideMadison™" wordmark: heavy Ride, light Madison, small raised ™ at the upper right. Defaults to the theme text colour. */
export function Wordmark({ size = 28, color: colorProp, style, mark = true }: {
  size?: number; color?: string; style?: TextStyle; mark?: boolean;
}) {
  const { c } = useTheme();
  const color = colorProp ?? c.text;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'flex-start' }}
      accessible
      accessibilityRole="header"
      accessibilityLabel="Ride Madison">
      <Text style={[{ fontSize: size, color, letterSpacing: -size * 0.02, includeFontPadding: false }, style]}>
        <Text style={{ fontFamily: FONT.black }}>Ride</Text>
        <Text style={{ fontFamily: FONT.light }}>Madison</Text>
      </Text>
      {mark && (
        <Text
          style={{
            fontFamily: FONT.bold,
            fontSize: Math.max(8, size * 0.32),
            color,
            marginLeft: size * 0.04,
            marginTop: size * 0.08,
            includeFontPadding: false,
          }}>
          {BRAND_MARK_SYMBOL}
        </Text>
      )}
    </View>
  );
}

/** Horizontal logo: mark + wordmark on a navy plate (website / sponsor style). */
export function HorizontalLogo({ height = 44, onLight = false }: { height?: number; onLight?: boolean }) {
  const { c } = useTheme();
  // "onLight" means on the page background: navy in light mode, limestone/cream in dark mode.
  const fg = onLight ? c.text : '#FFFFFF';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: height * 0.28 }}>
      <LogoMark size={height} color={onLight && !c.dark ? BRAND.navy : BRAND.limestone} />
      <Wordmark size={height * 0.72} color={fg} />
    </View>
  );
}
