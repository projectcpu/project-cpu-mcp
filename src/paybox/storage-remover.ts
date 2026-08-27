import * as fs from 'node:fs';

import type { PayboxAuthRecordRemover } from './types.js';

export const nodePayboxAuthRecordRemover: PayboxAuthRecordRemover = {
    remove: (filePath) => fs.unlinkSync(filePath),
};
