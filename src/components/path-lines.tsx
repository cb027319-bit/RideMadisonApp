// Bike path network drawn under other map content, limited to what's on screen.
// Off-street trails are drawn bold; on-street lanes thin, and hidden when zoomed out.

import { memo, useMemo } from 'react';
import { Polyline } from 'react-native-maps';

import { bboxIntersects, regionToBBox, type Region } from '@/lib/geo';
import { lineColor, PATH_META } from '@/lib/labels';
import type { BikePath } from '@/lib/osm';
import { useTheme } from '@/lib/theme';

interface Props {
  paths: BikePath[];
  region: Region;
  /** Lighter lines when something else (a route) is the focus. */
  faded?: boolean;
  showTrails?: boolean;
  showLanes?: boolean;
  max?: number;
}

const LANES_MAX_LAT_DELTA = 0.2;

function PathLinesInner({ paths, region, faded, showTrails = true, showLanes = true, max = 1500 }: Props) {
  const { c } = useTheme();
  const lines = useMemo(
    () => paths.map((p) => ({ path: p, coords: p.coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) })),
    [paths],
  );
  const view = useMemo(() => regionToBBox(region, 0.3), [region]);
  const lanesVisible = showLanes && region.latitudeDelta <= LANES_MAX_LAT_DELTA;

  const visible = useMemo(() => {
    type Line = (typeof lines)[number];
    const trails: Line[] = [];
    const lanes: Line[] = [];
    for (const l of lines) {
      const isLane = l.path.kind === 'lane';
      if (isLane ? !lanesVisible : !showTrails) continue;
      if (!bboxIntersects(l.path.bbox, view)) continue;
      (isLane ? lanes : trails).push(l);
    }
    // Trails get priority when we have to cap the count; lanes drawn first (underneath).
    const keptTrails = trails.slice(0, max);
    const keptLanes = lanes.slice(0, Math.max(0, max - keptTrails.length));
    return [...keptLanes, ...keptTrails];
  }, [lines, view, lanesVisible, showTrails, max]);

  return (
    <>
      {visible.map(({ path, coords }) => {
        const lane = path.kind === 'lane';
        const color = lineColor(PATH_META[path.kind].color, c.dark);
        return (
          <Polyline
            key={path.id}
            coordinates={coords}
            strokeColor={faded ? `${color}80` : lane ? `${color}cc` : color}
            strokeWidth={faded ? 2 : lane ? 2 : 4}
            lineDashPattern={path.kind === 'path_unpaved' ? [7, 4] : undefined}
            lineCap="round"
            zIndex={lane ? 1 : 2}
          />
        );
      })}
    </>
  );
}

export const PathLines = memo(PathLinesInner);
