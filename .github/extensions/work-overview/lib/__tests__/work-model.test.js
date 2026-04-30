import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkOverview } from "../work-model.js";

test("derives pending ready and blocked states from dependencies", () => {
    const overview = buildWorkOverview({
        todos: [
            { id: "ready", title: "Ready", status: "pending", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
            { id: "dep-done", title: "Done dependency", status: "done", createdAt: "2026-01-01T09:00:00Z", updatedAt: "2026-01-01T11:00:00Z" },
            { id: "waits", title: "Waits", status: "pending", createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-01T12:00:00Z" },
            { id: "active", title: "Active", status: "in_progress", createdAt: "2026-01-01T13:00:00Z", updatedAt: "2026-01-01T14:00:00Z" },
            { id: "manual-block", title: "Manual block", status: "blocked", createdAt: "2026-01-01T15:00:00Z", updatedAt: "2026-01-01T15:00:00Z" },
        ],
        deps: [
            { todoId: "ready", dependsOn: "dep-done" },
            { todoId: "waits", dependsOn: "ready" },
        ],
    });

    assert.equal(overview.itemsById.ready.effectiveStatus, "pending_ready");
    assert.equal(overview.itemsById.waits.effectiveStatus, "blocked");
    assert.equal(overview.itemsById.active.effectiveStatus, "in_progress");
    assert.equal(overview.itemsById["manual-block"].effectiveStatus, "blocked");
    assert.equal(overview.summary.pendingReadyCount, 1);
    assert.equal(overview.summary.blockedCount, 2);
});

test("surfaces missing dependency targets as integrity issues", () => {
    const overview = buildWorkOverview({
        todos: [
            { id: "broken", title: "Broken", status: "pending", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
        ],
        deps: [
            { todoId: "broken", dependsOn: "ghost" },
        ],
    });

    assert.equal(overview.itemsById.broken.effectiveStatus, "blocked");
    assert.deepEqual(overview.itemsById.broken.missingDependencyIds, ["ghost"]);
    assert.equal(overview.globalIssues[0].type, "missing_dependency");
});

test("detects dependency cycles and marks every member", () => {
    const overview = buildWorkOverview({
        todos: [
            { id: "a", title: "A", status: "pending", createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
            { id: "b", title: "B", status: "pending", createdAt: "2026-01-01T11:00:00Z", updatedAt: "2026-01-01T11:00:00Z" },
        ],
        deps: [
            { todoId: "a", dependsOn: "b" },
            { todoId: "b", dependsOn: "a" },
        ],
    });

    assert.equal(overview.itemsById.a.effectiveStatus, "blocked");
    assert.equal(overview.itemsById.b.effectiveStatus, "blocked");
    assert.ok(overview.itemsById.a.issues.some((issue) => issue.type === "cycle"));
    assert.ok(overview.itemsById.b.issues.some((issue) => issue.type === "cycle"));
    assert.ok(overview.globalIssues.some((issue) => issue.type === "cycle"));
});
