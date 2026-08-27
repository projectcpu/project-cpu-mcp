import { PayboxClient } from '@paybox-sh/sdk';

import type { PayboxSdkClient, PayboxSdkClientFactory } from './types.js';

export const defaultPayboxSdkClientFactory: PayboxSdkClientFactory = {
    create: (options) => new PayboxClient(options) as PayboxSdkClient,
};
