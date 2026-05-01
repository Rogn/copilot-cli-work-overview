export const VERSION = "0.1.0";

import { joinSession } from "@github/copilot-sdk/extension";
import { basename, join } from "node:path";
import { execSync } from "node:child_process";
import { CopilotWebview } from "./lib/copilot-webview.js";
import { getSnapshotRevision, readSessionWorkSnapshot } from "./lib/session-db.js";

function deriveWorkspaceMeta() {
    const cwdPath = process.cwd();
    const cwdName = basename(cwdPath);
    let branch = null;

    try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: cwdPath,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim() || null;
    } catch {
        branch = null;
    }

    return {
        label: branch ? `${cwdName} @ ${branch}` : cwdName,
        cwdName,
        cwdPath,
        branch,
        pid: process.pid,
        startedAt: new Date().toISOString(),
    };
}

const workspaceMeta = deriveWorkspaceMeta();
let sessionMeta = {
    ...workspaceMeta,
    sessionId: null,
    workspacePath: null,
};

function refreshSessionMeta() {
    sessionMeta = {
        ...workspaceMeta,
        sessionId: session?.sessionId ?? null,
        workspacePath: session?.workspacePath ?? null,
    };
}

const webview = new CopilotWebview({
    extensionName: "work-overview",
    contentDir: join(import.meta.dirname, "content"),
    title: `Work Overview — ${workspaceMeta.label}`,
    width: 1440,
    height: 900,
    callbacks: {
        getRevision: () => getSnapshotRevision(sessionMeta.sessionId),
        getSnapshot: () => JSON.stringify(readSessionWorkSnapshot({
            version: VERSION,
            sessionMeta,
        })),
    },
});

const openWorkOverview = async () => {
    await webview.show();
};

const COMMANDS = [
    {
        name: "work-overview",
        description: "Open the work overview window.",
        handler: openWorkOverview,
    },
    {
        name: "overview",
        description: "Open the work overview window.",
        handler: openWorkOverview,
    },
];

const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));
const COMMAND_HANDLERS = new Map(COMMANDS.map((command) => [command.name, command.handler]));

function normalizeCmd(name) {
    if (typeof name !== "string") {
        return name;
    }

    const trimmed = name.trim();
    return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

let session;

session = await joinSession({
    hooks: {
        onSessionStart: refreshSessionMeta,
        onSessionEnd: async () => {
            webview.close();
            await session.log("work-overview: session ended, window closed").catch(() => {});
        },
    },
    tools: [
        ...webview.tools,
    ],
    commands: COMMANDS,
});

try {
    const cmdMap = session.commandHandlers;
    if (cmdMap instanceof Map) {
        const nativeGet = Map.prototype.get;
        cmdMap.get = function (key) {
            const normalized = normalizeCmd(key);
            if (COMMAND_NAMES.has(key) || COMMAND_NAMES.has(normalized)) {
                return COMMAND_HANDLERS.get(normalized);
            }
            return nativeGet.call(this, key);
        };
    }

    if (typeof session._dispatchEvent === "function") {
        const originalDispatchEvent = session._dispatchEvent.bind(session);

        session._dispatchEvent = function (event) {
            if (event?.type === "command.execute" && event?.data) {
                const { requestId, commandName, command, args } = event.data;
                const normalized = normalizeCmd(commandName);

                if (COMMAND_NAMES.has(commandName) || COMMAND_NAMES.has(normalized)) {
                    const handler = COMMAND_HANDLERS.get(normalized);
                    void (async () => {
                        try {
                            await handler({ sessionId: session.sessionId, command, commandName: normalized, args });
                            await session.rpc.commands.handlePendingCommand({ requestId });
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            try {
                                await session.rpc.commands.handlePendingCommand({ requestId, error: message });
                            } catch {
                                // Ignore secondary command-response failures.
                            }
                        }
                    })();

                    const typedHandlers = this.typedEventHandlers?.get?.(event.type);
                    if (typedHandlers) {
                        for (const typedHandler of typedHandlers) {
                            try { typedHandler(event); } catch {}
                        }
                    }
                    if (this.eventHandlers) {
                        for (const eventHandler of this.eventHandlers) {
                            try { eventHandler(event); } catch {}
                        }
                    }
                    return;
                }
            }

            return originalDispatchEvent(event);
        };
    }

    const proto = Object.getPrototypeOf(session);
    if (proto && typeof proto._executeCommandAndRespond === "function") {
        const originalProtoExec = proto._executeCommandAndRespond;
        proto._executeCommandAndRespond = async function (requestId, commandName, command, args) {
            const normalized = normalizeCmd(commandName);
            if (COMMAND_NAMES.has(commandName) || COMMAND_NAMES.has(normalized)) {
                this.commandHandlers?.set?.(commandName, COMMAND_HANDLERS.get(normalized));
                if (commandName !== normalized) {
                    this.commandHandlers?.set?.(normalized, COMMAND_HANDLERS.get(normalized));
                }
            }
            return originalProtoExec.call(this, requestId, commandName, command, args);
        };
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`work-overview slash-command patch failed: ${message}`);
}

refreshSessionMeta();
