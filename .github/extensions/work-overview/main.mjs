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

refreshSessionMeta();
