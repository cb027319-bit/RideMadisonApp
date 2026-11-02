// All strings, merged. Add a namespace by creating en/<ns>.ts and es/<ns>.ts and listing it here.
import { common as enCommon } from './en/common';
import { events as enEvents } from './en/events';
import { lib as enLib } from './en/lib';
import { map as enMap } from './en/map';
import { more as enMore } from './en/more';
import { route as enRoute } from './en/route';
import { common as esCommon } from './es/common';
import { events as esEvents } from './es/events';
import { lib as esLib } from './es/lib';
import { map as esMap } from './es/map';
import { more as esMore } from './es/more';
import { route as esRoute } from './es/route';

export const EN = { ...enCommon, ...enMap, ...enRoute, ...enMore, ...enLib, ...enEvents };
export type Key = keyof typeof EN;
export const ES: Record<Key, string> = { ...esCommon, ...esMap, ...esRoute, ...esMore, ...esLib, ...esEvents };
