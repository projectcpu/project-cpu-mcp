import { type ISessionStorage, type SessionData } from '../session/types.js';

export class InMemoryStorage implements ISessionStorage {
    private data: SessionData | null = null;

    load(): SessionData | null {
        return this.data ? structuredClone(this.data) : null;
    }

    save(data: SessionData): void {
        this.data = structuredClone(data);
    }

    delete(): void {
        this.data = null;
    }

    exists(): boolean {
        return this.data !== null;
    }

    /** Test-only: seed storage with data */
    _seed(data: SessionData): void {
        this.data = structuredClone(data);
    }
}
