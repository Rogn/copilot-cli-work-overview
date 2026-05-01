import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencyInstallRequired, getDependencyManifestSignature } from "../copilot-webview.js";

function createTempFixture(name) {
    const dir = join(tmpdir(), `work-overview-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

test("dependency install is required when node_modules is missing", () => {
    const dir = createTempFixture("missing-node-modules");
    try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
        assert.equal(dependencyInstallRequired(dir), true);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("dependency install is not required when stamp matches manifests", () => {
    const dir = createTempFixture("matching-stamp");
    try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
        writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ name: "x", lockfileVersion: 3 }));
        mkdirSync(join(dir, "node_modules"));
        writeFileSync(
            join(dir, ".copilot-extension-install.json"),
            JSON.stringify({ signature: getDependencyManifestSignature(dir) }),
        );

        assert.equal(dependencyInstallRequired(dir), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("dependency install is required when stamp no longer matches manifests", async () => {
    const dir = createTempFixture("stale-stamp");
    try {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
        mkdirSync(join(dir, "node_modules"));
        writeFileSync(
            join(dir, ".copilot-extension-install.json"),
            JSON.stringify({ signature: "old-signature" }),
        );

        assert.equal(dependencyInstallRequired(dir), true);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
