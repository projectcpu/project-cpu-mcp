import { io, type Socket } from 'socket.io-client';

import { CELL_UPDATE_EVENT, MAP_SOCKET_NAMESPACE, MAP_SOCKET_PATH } from './constants.js';
import { parseCell } from './map.utils.js';
import type { CreateMapSocketInput, ISocketClient, SocketLifecycleHandlers } from './types.js';
import type { ILogger } from '../logger/types.js';

function buildSocketUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${MAP_SOCKET_NAMESPACE}`;
}

export class MapSocketClient implements ISocketClient {
    private readonly baseUrl: string;
    private readonly logger: ILogger;
    private socket: Socket | null = null;

    constructor(input: CreateMapSocketInput) {
        this.baseUrl = input.baseUrl;
        this.logger = input.logger;
    }

    connect(handlers: SocketLifecycleHandlers): void {
        const socket = io(buildSocketUrl(this.baseUrl), {
            path: MAP_SOCKET_PATH,
            transports: ['websocket'],
            reconnection: true,
        });
        this.socket = socket;

        socket.on('connect', () => handlers.onConnect());
        socket.on('disconnect', (reason: string) => handlers.onDisconnect(reason));
        socket.on('connect_error', (error: Error) => handlers.onError(error));
        socket.on(CELL_UPDATE_EVENT, (raw: unknown) => {
            const cell = parseCell(raw);
            if (cell === null) {
                this.logger.warn('dropped invalid cell update payload');
                return;
            }
            handlers.onCellUpdate(cell);
        });
    }

    isConnected(): boolean {
        return this.socket?.connected ?? false;
    }

    reconnect(): void {
        // socket.io won't auto-reconnect after a server-initiated disconnect (it unsubscribes the
        // socket from the manager). A single connect() re-subscribes the socket and re-arms socket.io's
        // own backoff loop, which then owns the retries; connect() is a no-op if already connected.
        this.socket?.connect();
    }

    disconnect(): void {
        if (this.socket !== null) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

export function createMapSocket(input: CreateMapSocketInput): ISocketClient {
    return new MapSocketClient(input);
}
