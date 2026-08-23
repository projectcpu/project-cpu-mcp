import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ROUTE_GRAPH_FILE_EXTENSION, ROUTE_GRAPH_FILE_PREFIX } from './route.constants.js';
import type { RouteGraphArtifact } from './types.js';

/** Server-chosen and unique per invocation: no caller input reaches the name, so none can pick the target. */
function artifactName(): string {
    return `${ROUTE_GRAPH_FILE_PREFIX}${randomUUID()}${ROUTE_GRAPH_FILE_EXTENSION}`;
}

export async function writeRouteGraph(artifact: RouteGraphArtifact): Promise<string> {
    const target = path.join(os.tmpdir(), artifactName());
    await writeFile(target, JSON.stringify(artifact), { encoding: 'utf8', flag: 'wx' });
    return target;
}
