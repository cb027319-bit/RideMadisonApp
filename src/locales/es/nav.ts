// Spanish (US Latin American, informal "tú") strings: nav. Same keys as en/nav.ts.
import type { Dict } from '../types';
import type { nav as en } from '../en/nav';

export const nav: Dict<typeof en> = {
  'nav.serviceTitle': 'Ride Madison te está guiando',
  'nav.serviceBody': 'Las indicaciones paso a paso están activadas.',
  'nav.keepOpen': 'Mantén Ride Madison abierta para oír las indicaciones.',
  'nav.dock': 'Estación BCycle más cercana: {name}, {dist} · {count} lugares libres',
  'nav.dock_one': 'Estación BCycle más cercana: {name}, {dist} · {count} lugar libre',
  'nav.dockHere': 'Estación BCycle aquí: {name} · {count} lugares libres',
  'nav.dockHere_one': 'Estación BCycle aquí: {name} · {count} lugar libre',
  'nav.dockGo': 'Ir en bici',
  'nav.dockGoA11y': 'Planear una ruta a la estación BCycle {name}',
};
