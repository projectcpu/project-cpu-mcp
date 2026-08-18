import {
    FULFILMENT_BACKOFF_CEILING_MS,
    FULFILMENT_BACKOFF_MS,
    FULFILMENT_SWEEP_INTERVAL_MS,
    MS_PER_SECOND,
} from '../randomness/constants.js';

// Public world-map read. `?since=<version>` returns only cells changed after that version (a delta),
// so we can re-sync cheaply instead of re-fetching the whole map.
export const MAP_HTTP_PATH = '/api/v1/map';

// Namespace and engine path are distinct socket.io concepts: the namespace is appended to the base
// URL (`<base>/map`), the path is the engine mount. Conflating them is a classic connection bug.
// The engine is mounted under `/api` so the WebSocket upgrade rides the same edge route as the HTTP
// API instead of a separate top-level path; this must match the server's gateway path exactly.
export const MAP_SOCKET_NAMESPACE = '/map';
export const MAP_SOCKET_PATH = '/api/socket.io';

export const CELL_UPDATE_EVENT = 'cell_update';

// socket.io disconnect reason for a server-initiated namespace disconnect. In this case the client
// does NOT auto-reconnect (it detaches the socket from its manager), so we must reconnect manually.
// Must match the string emitted by socket.io-client.
export const SERVER_INITIATED_DISCONNECT_REASON = 'io server disconnect';

export const DEFAULT_POLL_INTERVAL_MS = 30_000;
export const DEFAULT_RECONNECT_GRACE_MS = 5_000;
export const STARTUP_FETCH_RETRY_MS = 10_000;

// Input bound for the `around` scope (caps the query, not the response).
export const DEFAULT_AROUND_RADIUS = 2;
export const MAX_AROUND_RADIUS = 10;

// A capped warehouse at or above this fill percentage is flagged as "about to stall" by get_attention.
export const WAREHOUSE_NEAR_FULL_PCT = 90;

export const REVEAL_STUCK_AFTER_MISSED_SWEEPS = 2;

export const REVEAL_STUCK_AFTER_SECONDS =
    (FULFILMENT_SWEEP_INTERVAL_MS / MS_PER_SECOND) * REVEAL_STUCK_AFTER_MISSED_SWEEPS;

export const REVEAL_RETRY_FLOOR_SECONDS = FULFILMENT_BACKOFF_MS / MS_PER_SECOND;

export const REVEAL_RETRY_CEILING_SECONDS = FULFILMENT_BACKOFF_CEILING_MS / MS_PER_SECOND;
