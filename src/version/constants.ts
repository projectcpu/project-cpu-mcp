export const PACKAGE_VERSION_TTL_MS = 2 * 60 * 60 * 1000;

export const BACKEND_VERSION_TTL_MS = 60 * 1000;

export const BACKEND_VERSION_PATH = '/api/version';

export const BACKEND_VERSION_TIMEOUT_MS = 5_000;

export const BACKEND_RESET_NOTICE = [
    'Note: the game API is running a new build, so this server reloaded its game config and world map from it.',
    'Rules, contract addresses and cell state may all have moved.',
    'Anything computed before this reset — routes, quotes, costs, plans — may be stale; re-check it before spending.',
    'This notice is shown once.',
].join(' ');

export const REGISTRY_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/project-cpu-mcp/dist-tags';

export const REGISTRY_FETCH_TIMEOUT_MS = 5_000;

export const LATEST_PLACEHOLDER = '{latest}';
export const CURRENT_PLACEHOLDER = '{current}';

export const BLOCKED_ERROR_TEMPLATE = [
    `Version ${LATEST_PLACEHOLDER} of this MCP server has been published; this process runs ${CURRENT_PLACEHOLDER}.`,
    'The change is breaking, so results produced by this build can no longer be trusted.',
    'Ask the user to restart the MCP server now — the next start pulls the new version in through the package manager.',
    'Until that restart every tool of this server refuses to answer, so do not retry and do not plan around it.',
].join(' ');

export const UPDATE_NOTICE_TEMPLATE = [
    `Note: version ${LATEST_PLACEHOLDER} of this MCP server has been published; this process runs ${CURRENT_PLACEHOLDER}.`,
    'The change is backwards compatible — keep working as usual.',
    'Mention it once to the user so they can restart the server when convenient to pick it up.',
].join(' ');
