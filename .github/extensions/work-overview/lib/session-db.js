import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildWorkOverview } from "./work-model.js";

const REQUIRED_TABLES = ["todos", "todo_deps"];

export function getSessionDbPath(sessionId) {
    if (!sessionId || typeof sessionId !== "string") {
        throw new Error("No active Copilot session is attached to Work Overview yet.");
    }

    return join(homedir(), ".copilot", "session-state", sessionId, "session.db");
}

export function getSnapshotRevision(sessionId) {
    const { stat } = getDbStat(sessionId);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

export function readSessionWorkSnapshot({ version, sessionMeta }) {
    const sessionId = sessionMeta?.sessionId;
    const { dbPath, stat } = getDbStat(sessionId);
    let db = null;

    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });

        const availableTables = listTables(db);
        const todos = availableTables.includes("todos")
            ? db.prepare(`
                SELECT
                    id,
                    title,
                    description,
                    status,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM todos
                ORDER BY id
            `).all()
            : [];
        const deps = availableTables.includes("todo_deps")
            ? db.prepare(`
                SELECT
                    todo_id AS todoId,
                    depends_on AS dependsOn
                FROM todo_deps
                ORDER BY todo_id, depends_on
            `).all()
            : [];

        return {
            version,
            revision: getSnapshotRevision(sessionId),
            sessionMeta: {
                ...sessionMeta,
                dbPath,
            },
            source: {
                mode: "direct-sqlite",
                dbPath,
                modifiedAt: new Date(stat.mtimeMs).toISOString(),
                sizeBytes: stat.size,
                availableTables,
                missingTables: REQUIRED_TABLES.filter((tableName) => !availableTables.includes(tableName)),
            },
            ...buildWorkOverview({ todos, deps }),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to read work overview data from ${dbPath}: ${message}`);
    } finally {
        if (db) {
            db.close();
        }
    }
}

function getDbStat(sessionId) {
    const dbPath = getSessionDbPath(sessionId);

    try {
        return {
            dbPath,
            stat: statSync(dbPath),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to access session database at ${dbPath}: ${message}`);
    }
}

function listTables(db) {
    return db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all().map((row) => row.name);
}
