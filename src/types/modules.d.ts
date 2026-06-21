declare module 'sql.js' {
  export default function initSqlJs(): Promise<SqlJsStatic>;
  export interface SqlJsStatic {
    Database: typeof Database;
  }
  export class Database {
    constructor(data?: Uint8Array | ArrayBuffer);
    run(sql: string, params?: (string | number | null)[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    getRowsModified(): number;
    close(): void;
  }
  export interface Statement {
    bind(params?: (string | number | null)[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
    run(params?: (string | number | null)[]): void;
  }
}

declare module 'user-agents' {
  export default class UserAgent {
    constructor();
    toString(): string;
  }
}

