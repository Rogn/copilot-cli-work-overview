import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

declare global {
    const copilot: {
        getSnapshot: () => Promise<string>;
        getRevision: () => Promise<string>;
    };
}

type EffectiveStatus = "in_progress" | "pending_ready" | "blocked" | "done";
type IssueType = "missing_dependency" | "cycle";

interface ItemIssue {
    type: IssueType;
    message: string;
    relatedIds: string[];
}

interface WorkItem {
    id: string;
    title: string;
    description: string;
    rawStatus: "pending" | "in_progress" | "done" | "blocked";
    effectiveStatus: EffectiveStatus;
    createdAt: string | null;
    updatedAt: string | null;
    dependencyIds: string[];
    dependentIds: string[];
    resolvedDependencyIds: string[];
    unmetDependencyIds: string[];
    missingDependencyIds: string[];
    blockedReasons: string[];
    issues: ItemIssue[];
}

interface Group {
    key: EffectiveStatus;
    label: string;
    collapsedByDefault: boolean;
    itemIds: string[];
    count: number;
}

interface GlobalIssue {
    type: IssueType;
    message: string;
    relatedIds: string[];
    todoId?: string;
}

interface Summary {
    totalCount: number;
    inProgressCount: number;
    pendingReadyCount: number;
    blockedCount: number;
    doneCount: number;
    issueCount: number;
}

interface SessionMeta {
    label: string;
    cwdName: string;
    cwdPath: string;
    branch: string | null;
    pid: number;
    startedAt: string;
    sessionId: string | null;
    workspacePath: string | null;
    dbPath: string;
}

interface SourceInfo {
    mode: "direct-sqlite";
    dbPath: string;
    modifiedAt: string;
    sizeBytes: number;
    availableTables: string[];
    missingTables: string[];
}

interface Snapshot {
    version: string;
    revision: string;
    sessionMeta: SessionMeta;
    source: SourceInfo;
    items: WorkItem[];
    itemsById: Record<string, WorkItem>;
    groups: Group[];
    summary: Summary;
    globalIssues: GlobalIssue[];
}

const COLLAPSE_KEY = "work-overview:collapsed-groups";

export function renderFatal(message: string, detail?: unknown) {
    const root = document.getElementById("root");
    if (!root) {
        return;
    }

    const detailText =
        detail instanceof Error ? (detail.stack || detail.message) :
        typeof detail === "string" ? detail :
        detail != null ? JSON.stringify(detail, null, 2) :
        "";

    root.innerHTML = `
      <div class="fatal-screen">
        <div class="fatal-box">
          <div class="fatal-title">Work Overview failed</div>
          <div class="fatal-text">${escapeHtml(message)}</div>
          ${detailText ? `<pre class="fatal-pre">${escapeHtml(detailText)}</pre>` : ""}
        </div>
      </div>
    `;
}

export function App() {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsedGroups);
    const lastRevisionRef = useRef<string | null>(null);
    const lastRawRef = useRef<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const revision = await copilot.getRevision();
            if (revision === lastRevisionRef.current) {
                setError(null);
                return;
            }

            const raw = await copilot.getSnapshot();
            if (raw === lastRawRef.current) {
                lastRevisionRef.current = revision;
                setError(null);
                return;
            }

            const parsed = JSON.parse(raw) as Snapshot;
            lastRevisionRef.current = revision;
            lastRawRef.current = raw;
            setSnapshot(parsed);
            setError(null);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        }
    }, []);

    useEffect(() => {
        void refresh();

        let inflight = false;
        const tick = async () => {
            if (document.visibilityState === "hidden" || inflight) {
                return;
            }

            inflight = true;
            try {
                await refresh();
            } finally {
                inflight = false;
            }
        };

        const onVisible = () => {
            if (document.visibilityState === "visible") {
                void tick();
            }
        };

        const intervalId = setInterval(() => {
            void tick();
        }, 3000);

        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);

        return () => {
            clearInterval(intervalId);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [refresh]);

    useEffect(() => {
        const label = snapshot?.sessionMeta?.label;
        document.title = label ? `Work Overview — ${label}` : "Work Overview";
    }, [snapshot?.sessionMeta?.label]);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        setCollapsed((previous) => {
            const next = { ...previous };
            for (const group of snapshot.groups) {
                if (!(group.key in next)) {
                    next[group.key] = !!group.collapsedByDefault;
                }
            }
            persistCollapsedGroups(next);
            return next;
        });
    }, [snapshot]);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        if (!selectedId || !snapshot.itemsById[selectedId]) {
            setSelectedId(getDefaultSelection(snapshot));
        }
    }, [snapshot, selectedId]);

    const selectedItem = snapshot && selectedId ? snapshot.itemsById[selectedId] ?? null : null;
    const missingTables = snapshot?.source.missingTables ?? [];
    const emptyState = useMemo(() => {
        if (!snapshot) {
            return null;
        }

        if (snapshot.summary.totalCount === 0 && missingTables.length > 0) {
            return {
                title: "Todo workflow not initialized",
                text: `The session database is readable, but the required tables are missing: ${missingTables.join(", ")}.`,
            };
        }

        if (snapshot.summary.totalCount === 0) {
            return {
                title: "No work items yet",
                text: "This session has todo tables, but they do not contain any work items yet.",
            };
        }

        return null;
    }, [missingTables, snapshot]);

    const toggleGroup = useCallback((groupKey: string) => {
        setCollapsed((previous) => {
            const next = { ...previous, [groupKey]: !previous[groupKey] };
            persistCollapsedGroups(next);
            return next;
        });
    }, []);

    return (
        <>
            <header className="page-header">
                <div>
                    <div className="eyebrow">Current session</div>
                    <h1>Work Overview</h1>
                    {snapshot?.sessionMeta && (
                        <div className="header-subtitle" title={snapshot.sessionMeta.cwdPath}>
                            {snapshot.sessionMeta.label}
                        </div>
                    )}
                </div>
                {snapshot && (
                    <div className="header-meta">
                        <MetaPill label="Source" value="Direct SQLite" />
                        <MetaPill label="Last updated" value={fmtTime(snapshot.source.modifiedAt)} />
                        <MetaPill label="Session" value={snapshot.sessionMeta.sessionId || "Unknown"} />
                    </div>
                )}
            </header>

            {error && <div className="error-bar">{error}</div>}

            {!error && !snapshot && (
                <main className="boot-screen">
                    <div className="boot-panel">
                        <div className="boot-panel-title">Loading work overview</div>
                        <div className="boot-panel-text">Reading the current session database...</div>
                    </div>
                </main>
            )}

            {snapshot && (
                <main className="shell">
                    <section className="summary-grid">
                        <SummaryCard label="In progress" value={snapshot.summary.inProgressCount} tone="in_progress" />
                        <SummaryCard label="Pending (ready)" value={snapshot.summary.pendingReadyCount} tone="pending_ready" />
                        <SummaryCard label="Blocked" value={snapshot.summary.blockedCount} tone="blocked" />
                        <SummaryCard label="Done" value={snapshot.summary.doneCount} tone="done" />
                    </section>

                    <section className="source-strip">
                        <span className="source-text" title={snapshot.source.dbPath}>
                            {snapshot.source.dbPath}
                        </span>
                        <span className="source-text">
                            Tables used: todos, todo_deps
                        </span>
                    </section>

                    {missingTables.length > 0 && snapshot.summary.totalCount > 0 && (
                        <section className="issue-panel">
                            <div className="issue-panel-title">Source table warning</div>
                            <div className="empty-state-text">
                                The dashboard is showing available work items, but these required tables are missing: {missingTables.join(", ")}.
                            </div>
                        </section>
                    )}

                    {snapshot.globalIssues.length > 0 && (
                        <section className="issue-panel">
                            <div className="issue-panel-title">Data integrity issues</div>
                            <ul className="issue-panel-list">
                                {snapshot.globalIssues.map((issue, index) => (
                                    <li key={`${issue.type}:${index}`} className="issue-panel-item">
                                        <span className="issue-badge issue-badge-warn">{issue.type.replaceAll("_", " ")}</span>
                                        <span>{issue.message}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {emptyState ? (
                        <section className="empty-state">
                            <div className="empty-state-title">{emptyState.title}</div>
                            <div className="empty-state-text">{emptyState.text}</div>
                        </section>
                    ) : (
                        <div className="workspace">
                            <aside className="list-pane">
                                {snapshot.groups.map((group) => (
                                    <section className="group" key={group.key}>
                                        <button
                                            type="button"
                                            className="group-header"
                                            onClick={() => toggleGroup(group.key)}
                                            aria-expanded={!collapsed[group.key]}
                                        >
                                            <span className="group-header-main">
                                                <span className="group-toggle">{collapsed[group.key] ? "+" : "-"}</span>
                                                <span>{group.label}</span>
                                            </span>
                                            <span className="group-count">{group.count}</span>
                                        </button>

                                        {!collapsed[group.key] && (
                                            <div className="group-items">
                                                {group.itemIds.length === 0 ? (
                                                    <div className="group-empty">Nothing here right now.</div>
                                                ) : (
                                                    group.itemIds.map((itemId) => (
                                                        <ItemRow
                                                            key={itemId}
                                                            item={snapshot.itemsById[itemId]}
                                                            selected={selectedId === itemId}
                                                            onSelect={setSelectedId}
                                                        />
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </section>
                                ))}
                            </aside>

                            <section className="detail-pane">
                                {!selectedItem && (
                                    <div className="detail-empty">Select a work item to inspect its dependency context.</div>
                                )}

                                {selectedItem && (
                                    <>
                                        <div className="detail-hero">
                                            <div>
                                                <div className="detail-eyebrow">{selectedItem.id}</div>
                                                <h2>{selectedItem.title}</h2>
                                            </div>
                                            <div className="detail-badges">
                                                <StatusBadge label={labelForEffectiveStatus(selectedItem.effectiveStatus)} tone={selectedItem.effectiveStatus} />
                                                <StatusBadge label={`Raw: ${labelForRawStatus(selectedItem.rawStatus)}`} tone="neutral" />
                                            </div>
                                        </div>

                                        <DetailSection title="Description">
                                            {selectedItem.description ? (
                                                <p className="detail-copy">{selectedItem.description}</p>
                                            ) : (
                                                <p className="detail-muted">No description recorded for this todo.</p>
                                            )}
                                        </DetailSection>

                                        <DetailSection title="Status context">
                                            <ul className="detail-list">
                                                <li>Created: {fmtDateTime(selectedItem.createdAt)}</li>
                                                <li>Updated: {fmtDateTime(selectedItem.updatedAt)}</li>
                                                <li>Dependencies: {selectedItem.dependencyIds.length}</li>
                                                <li>Dependents: {selectedItem.dependentIds.length}</li>
                                            </ul>
                                        </DetailSection>

                                        <DetailSection title="Blocked by">
                                            <RelatedItemList
                                                ids={selectedItem.unmetDependencyIds}
                                                snapshot={snapshot}
                                                emptyText="No unresolved dependencies."
                                                onSelect={setSelectedId}
                                            />
                                            {selectedItem.missingDependencyIds.length > 0 && (
                                                <ul className="detail-list detail-list-gap">
                                                    {selectedItem.missingDependencyIds.map((dependencyId) => (
                                                        <li key={dependencyId}>
                                                            Missing target: <code>{dependencyId}</code>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                            {selectedItem.blockedReasons.length > 0 && (
                                                <ul className="detail-list detail-list-gap">
                                                    {selectedItem.blockedReasons.map((reason) => (
                                                        <li key={reason}>{reason}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </DetailSection>

                                        <DetailSection title="Dependencies">
                                            <RelatedItemList
                                                ids={selectedItem.dependencyIds}
                                                snapshot={snapshot}
                                                emptyText="No dependencies."
                                                onSelect={setSelectedId}
                                            />
                                        </DetailSection>

                                        <DetailSection title="Dependents">
                                            <RelatedItemList
                                                ids={selectedItem.dependentIds}
                                                snapshot={snapshot}
                                                emptyText="No downstream dependents."
                                                onSelect={setSelectedId}
                                            />
                                        </DetailSection>

                                        <DetailSection title="Integrity issues">
                                            {selectedItem.issues.length === 0 ? (
                                                <p className="detail-muted">No integrity issues detected for this item.</p>
                                            ) : (
                                                <ul className="detail-list">
                                                    {selectedItem.issues.map((issue) => (
                                                        <li key={`${issue.type}:${issue.message}`}>
                                                            <span className="issue-badge issue-badge-warn">{issue.type.replaceAll("_", " ")}</span>
                                                            {issue.message}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </DetailSection>
                                    </>
                                )}
                            </section>
                        </div>
                    )}
                </main>
            )}
        </>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
    return (
        <div className={`summary-card summary-card-${tone}`}>
            <div className="summary-card-value">{value}</div>
            <div className="summary-card-label">{label}</div>
        </div>
    );
}

function MetaPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="meta-pill">
            <span className="meta-pill-label">{label}</span>
            <span className="meta-pill-value">{value}</span>
        </div>
    );
}

function ItemRow({
    item,
    selected,
    onSelect,
}: {
    item: WorkItem;
    selected: boolean;
    onSelect: (itemId: string) => void;
}) {
    return (
        <button
            type="button"
            className={`item-row ${selected ? "item-row-selected" : ""}`}
            onClick={() => onSelect(item.id)}
        >
            <div className="item-row-top">
                <span className="item-title">{item.title}</span>
                {item.issues.length > 0 && <span className="issue-dot" title="Integrity issue detected" />}
            </div>
            <div className="item-row-meta">
                <StatusBadge label={labelForEffectiveStatus(item.effectiveStatus)} tone={item.effectiveStatus} />
                <StatusBadge label={`Raw: ${labelForRawStatus(item.rawStatus)}`} tone="neutral" />
            </div>
            <div className="item-row-text">{secondaryLine(item)}</div>
        </button>
    );
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
    return <span className={`status-badge status-badge-${tone}`}>{label}</span>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="detail-section">
            <h3>{title}</h3>
            {children}
        </section>
    );
}

function RelatedItemList({
    ids,
    snapshot,
    emptyText,
    onSelect,
}: {
    ids: string[];
    snapshot: Snapshot;
    emptyText: string;
    onSelect: (itemId: string) => void;
}) {
    if (ids.length === 0) {
        return <p className="detail-muted">{emptyText}</p>;
    }

    return (
        <ul className="related-list">
            {ids.map((id) => {
                const item = snapshot.itemsById[id];
                if (!item) {
                    return (
                        <li key={id} className="related-missing">
                            <code>{id}</code>
                        </li>
                    );
                }

                return (
                    <li key={id}>
                        <button type="button" className="related-item" onClick={() => onSelect(id)}>
                            <span className="related-title">{item.title}</span>
                            <span className="related-meta">{labelForEffectiveStatus(item.effectiveStatus)}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

function getDefaultSelection(snapshot: Snapshot): string | null {
    for (const group of snapshot.groups) {
        if (group.itemIds.length > 0) {
            return group.itemIds[0];
        }
    }

    return null;
}

function secondaryLine(item: WorkItem): string {
    if (item.effectiveStatus === "in_progress") {
        return "Currently active.";
    }
    if (item.effectiveStatus === "pending_ready") {
        return item.dependencyIds.length > 0
            ? `All ${pluralize(item.dependencyIds.length, "dependency")} resolved.`
            : "Ready to start.";
    }
    if (item.effectiveStatus === "done") {
        return `Completed. Updated ${fmtTime(item.updatedAt)}.`;
    }
    if (item.missingDependencyIds.length > 0) {
        return `Missing ${pluralize(item.missingDependencyIds.length, "dependency target")}.`;
    }
    if (item.unmetDependencyIds.length > 0) {
        return `Waiting on ${pluralize(item.unmetDependencyIds.length, "dependency")}.`;
    }
    if (item.rawStatus === "blocked") {
        return "Marked blocked in the source data.";
    }
    return "Blocked by dependency state.";
}

function loadCollapsedGroups(): Record<string, boolean> {
    try {
        const raw = localStorage.getItem(COLLAPSE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed as Record<string, boolean> : {};
    } catch {
        return {};
    }
}

function persistCollapsedGroups(value: Record<string, boolean>) {
    try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(value));
    } catch {
        // Ignore storage failures.
    }
}

function labelForEffectiveStatus(status: EffectiveStatus): string {
    switch (status) {
        case "in_progress":
            return "In progress";
        case "pending_ready":
            return "Pending (ready)";
        case "blocked":
            return "Blocked";
        case "done":
            return "Done";
        default:
            return status;
    }
}

function labelForRawStatus(status: WorkItem["rawStatus"]): string {
    switch (status) {
        case "in_progress":
            return "In progress";
        case "done":
            return "Done";
        case "blocked":
            return "Blocked";
        case "pending":
        default:
            return "Pending";
    }
}

function fmtTime(iso?: string | null): string {
    if (!iso) {
        return "Unknown";
    }

    try {
        return new Date(iso).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return iso;
    }
}

function fmtDateTime(iso?: string | null): string {
    if (!iso) {
        return "Unknown";
    }

    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function pluralize(count: number, noun: string): string {
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
