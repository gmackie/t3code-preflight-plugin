import type { Database } from "bun:sqlite";

export type ReleaseReviewState = {
  approved: boolean;
  executionRequested: boolean;
  releaseId?: string;
  updatedAt?: string;
};

export type ReleaseReviewStore = {
  get(platform: string): Promise<ReleaseReviewState>;
  save(platform: string, state: ReleaseReviewState): Promise<void>;
  clear(platform: string): Promise<void>;
};

// Release review approval, one row per platform, in a SQLite file that every
// plugin process opens: T3 runs one stdio copy per agent session plus one in
// its pool, so a panel's approval and an agent's execute can land in different
// processes. The server keeps no state in memory.
export function sqliteReviewStore(db: Database): ReleaseReviewStore {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS release_review (platform TEXT PRIMARY KEY, approved INTEGER NOT NULL, execution_requested INTEGER NOT NULL, release_id TEXT, updated_at TEXT NOT NULL)",
  );
  return {
    async get(platform) {
      const row = db
        .query<{ approved: number; executionRequested: number; releaseId: string | null; updatedAt: string }, [string]>(
          "SELECT approved, execution_requested AS executionRequested, release_id AS releaseId, updated_at AS updatedAt FROM release_review WHERE platform = ?",
        )
        .get(platform);
      if (!row) return { approved: false, executionRequested: false };
      return { approved: row.approved === 1, executionRequested: row.executionRequested === 1, ...(row.releaseId ? { releaseId: row.releaseId } : {}), updatedAt: row.updatedAt };
    },
    async save(platform, state) {
      db.query(
        "INSERT INTO release_review (platform, approved, execution_requested, release_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(platform) DO UPDATE SET approved=excluded.approved, execution_requested=excluded.execution_requested, release_id=excluded.release_id, updated_at=excluded.updated_at",
      ).run(platform, state.approved ? 1 : 0, state.executionRequested ? 1 : 0, state.releaseId ?? null, new Date().toISOString());
    },
    async clear(platform) {
      db.query("DELETE FROM release_review WHERE platform = ?").run(platform);
    },
  };
}

export function memoryReviewStore(): ReleaseReviewStore {
  const rows = new Map<string, ReleaseReviewState>();
  return {
    get: async (platform) => rows.get(platform) ?? { approved: false, executionRequested: false },
    save: async (platform, state) => void rows.set(platform, { ...state, updatedAt: new Date().toISOString() }),
    clear: async (platform) => void rows.delete(platform),
  };
}
