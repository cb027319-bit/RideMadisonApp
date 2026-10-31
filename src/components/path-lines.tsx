// Bike path network drawn under other map content, limited to what's on screen.

import { memo, useMemo } from 'react';
import { Polyline } from 'react-native-maps';

import { bboxIntersects, regionToBBox, type Region } from '@/lib/geo';
import { PATH_META } from '@/lib/labels';
import type { BikePath } from '@/lib/osm';

interface Props {
  paths: BikePath[];
  region: Region;
  /** Lighter lines when something else (a route) is the focus. */
  faded?: boolean;
  onPress?: (p: BikePath) => void;
  max?: number;
}

function PathLinesInner({ paths, region, faded, onPress, max = 1500 }: Props) {
  const lines = useMemo(
    () => paths.map((p) => ({ path: p, coords: p.coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) })),
    [paths],
  );
  const view = useMemo(() => regionToBBox(region, 0.3), [region]);
  const zoomedOut = region.latitudeDelta > 0.25;

  const visible = useMemo(() => {
    const out = [];
    for (const l of lines) {
      if (zoomedOut && l.path.kind === 'lane') continue;
      if (!bboxIntersects(l.path.bbox, view)) continue;
      out.push(l);
      if (out.length >= max) break;
    }
    return out;
  }, [lines, view, zoomedOut, max]);

  return (
    <>
      {visible.map(({ path, coords }) => (
        <Polyline
          key={path.id}
          coordinates={coords}
          strokeColor={faded ? `${PATH_META[path.kind].color}88` : PATH_META[path.kind].color}
          strokeWidth={faded ? 2 : path.kind === 'lane' ? 2.5 : 3.5}
          lineDashPattern={path.kind === 'path_unpaved' ? [6, 4] : undefined}
          tappable={!!onPress}
          onPress={onPress ? () => onPress(path) : undefined}
          zIndex={1}
        />
      ))}
    </>
  );
}

export const PathLines = memo(PathLinesInner);
