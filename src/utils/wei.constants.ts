/**
 * Wei only ever travels as a whole-number string, so every seam that reads one shares this shape: two copies
 * of the guard drift apart the moment one of them learns something the other does not.
 */
export const WEI_STRING_PATTERN = /^\d+$/;
