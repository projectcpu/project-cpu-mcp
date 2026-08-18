import { expectTypeOf, it } from 'vitest';

import { ModeOperation, type PrepareModeSwitchInput } from '../mode-switch.types.js';

it('couples each operation to its on-chain target and map mode types', () => {
    type Mining = Extract<PrepareModeSwitchInput<null>, { operation: ModeOperation.Mining }>;
    type Craft = Extract<PrepareModeSwitchInput<null>, { operation: ModeOperation.Craft }>;

    expectTypeOf<Mining['target']>().toEqualTypeOf<number>();
    expectTypeOf<Mining['mapMode']>().toEqualTypeOf<number | null>();
    expectTypeOf<Craft['target']>().toEqualTypeOf<bigint>();
    expectTypeOf<Craft['mapMode']>().toEqualTypeOf<bigint | null>();
});
