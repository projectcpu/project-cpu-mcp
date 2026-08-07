import type { ApiFillView, FillView } from '../api/types.js';

export function toFillView(fill: ApiFillView): FillView {
    return { ...fill, soldOut: fill.remaining === '0' };
}
