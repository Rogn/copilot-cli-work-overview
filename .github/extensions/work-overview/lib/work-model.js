const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const GROUPS = [
    { key: "in_progress", label: "In progress", collapsedByDefault: false },
    { key: "pending_ready", label: "Pending (ready)", collapsedByDefault: false },
    { key: "blocked", label: "Blocked", collapsedByDefault: false },
    { key: "done", label: "Done", collapsedByDefault: true },
];

export function buildWorkOverview({ todos, deps }) {
    const normalizedTodos = todos.map(normalizeTodo);
    const todoMap = new Map(normalizedTodos.map((todo) => [todo.id, todo]));

    const dependencyIdsByTodo = new Map(normalizedTodos.map((todo) => [todo.id, []]));
    const dependentIdsByTodo = new Map(normalizedTodos.map((todo) => [todo.id, []]));

    for (const dep of deps.map(normalizeDep)) {
        if (!dependencyIdsByTodo.has(dep.todoId)) {
            continue;
        }

        dependencyIdsByTodo.get(dep.todoId).push(dep.dependsOn);
        if (dependentIdsByTodo.has(dep.dependsOn)) {
            dependentIdsByTodo.get(dep.dependsOn).push(dep.todoId);
        }
    }

    const cycleComponents = findCycleComponents(dependencyIdsByTodo, todoMap);
    const cycleIdsByTodo = new Map();
    for (const component of cycleComponents) {
        for (const todoId of component) {
            cycleIdsByTodo.set(todoId, component);
        }
    }

    const globalIssues = [];
    const items = normalizedTodos.map((todo) => {
        const dependencyIds = [...new Set(dependencyIdsByTodo.get(todo.id) ?? [])];
        const dependentIds = [...new Set(dependentIdsByTodo.get(todo.id) ?? [])].sort(collator.compare);
        const resolvedDependencyIds = [];
        const unmetDependencyIds = [];
        const missingDependencyIds = [];
        const issues = [];
        const blockedReasons = [];

        for (const dependencyId of dependencyIds) {
            const dependency = todoMap.get(dependencyId);

            if (!dependency) {
                missingDependencyIds.push(dependencyId);
                continue;
            }

            if (dependency.rawStatus === "done") {
                resolvedDependencyIds.push(dependencyId);
                continue;
            }

            unmetDependencyIds.push(dependencyId);
        }

        if (todo.rawStatus === "blocked") {
            blockedReasons.push("Marked as blocked in the source data.");
        }
        if (unmetDependencyIds.length > 0) {
            blockedReasons.push(`Waiting on ${pluralize(unmetDependencyIds.length, "dependency")}.`);
        }
        if (missingDependencyIds.length > 0) {
            const message = `Missing dependency target${missingDependencyIds.length === 1 ? "" : "s"}: ${missingDependencyIds.join(", ")}`;
            issues.push({
                type: "missing_dependency",
                message,
                relatedIds: missingDependencyIds,
            });
            blockedReasons.push(message);
            globalIssues.push({
                type: "missing_dependency",
                todoId: todo.id,
                message: `${todo.title} references missing dependency target${missingDependencyIds.length === 1 ? "" : "s"}: ${missingDependencyIds.join(", ")}`,
                relatedIds: [todo.id, ...missingDependencyIds],
            });
        }

        const cycleIds = cycleIdsByTodo.get(todo.id);
        if (cycleIds) {
            const cycleMessage = `Dependency cycle detected with ${cycleIds.join(", ")}`;
            issues.push({
                type: "cycle",
                message: cycleMessage,
                relatedIds: cycleIds,
            });
            blockedReasons.push("Dependency cycle detected.");
        }

        const effectiveStatus = deriveEffectiveStatus({
            rawStatus: todo.rawStatus,
            unmetDependencyIds,
            missingDependencyIds,
            hasCycle: !!cycleIds,
        });

        return {
            id: todo.id,
            title: todo.title,
            description: todo.description,
            rawStatus: todo.rawStatus,
            effectiveStatus,
            createdAt: todo.createdAt,
            updatedAt: todo.updatedAt,
            dependencyIds,
            dependentIds,
            resolvedDependencyIds,
            unmetDependencyIds,
            missingDependencyIds,
            blockedReasons,
            issues,
        };
    });

    for (const component of cycleComponents) {
        globalIssues.push({
            type: "cycle",
            message: `Dependency cycle detected involving ${component.join(", ")}`,
            relatedIds: component,
        });
    }

    const groups = GROUPS.map((group) => {
        const groupItems = items
            .filter((item) => item.effectiveStatus === group.key)
            .sort(getGroupComparator(group.key));

        return {
            key: group.key,
            label: group.label,
            collapsedByDefault: group.collapsedByDefault,
            itemIds: groupItems.map((item) => item.id),
            count: groupItems.length,
        };
    });

    return {
        items,
        itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
        groups,
        summary: {
            totalCount: items.length,
            inProgressCount: groups.find((group) => group.key === "in_progress").count,
            pendingReadyCount: groups.find((group) => group.key === "pending_ready").count,
            blockedCount: groups.find((group) => group.key === "blocked").count,
            doneCount: groups.find((group) => group.key === "done").count,
            issueCount: globalIssues.length,
        },
        globalIssues,
    };
}

function normalizeTodo(todo) {
    return {
        id: String(todo.id),
        title: safeText(todo.title) || String(todo.id),
        description: safeText(todo.description),
        rawStatus: normalizeRawStatus(todo.status),
        createdAt: normalizeTimestamp(todo.createdAt),
        updatedAt: normalizeTimestamp(todo.updatedAt),
    };
}

function normalizeDep(dep) {
    return {
        todoId: String(dep.todoId),
        dependsOn: String(dep.dependsOn),
    };
}

function normalizeRawStatus(status) {
    switch (status) {
        case "done":
        case "in_progress":
        case "blocked":
            return status;
        default:
            return "pending";
    }
}

function normalizeTimestamp(value) {
    return typeof value === "string" && value.trim() ? value : null;
}

function deriveEffectiveStatus({ rawStatus, unmetDependencyIds, missingDependencyIds, hasCycle }) {
    if (rawStatus === "done") {
        return "done";
    }
    if (rawStatus === "in_progress") {
        return "in_progress";
    }
    if (rawStatus === "blocked") {
        return "blocked";
    }
    if (unmetDependencyIds.length > 0 || missingDependencyIds.length > 0 || hasCycle) {
        return "blocked";
    }
    return "pending_ready";
}

function findCycleComponents(dependencyIdsByTodo, todoMap) {
    let index = 0;
    const indices = new Map();
    const lowLinks = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    for (const todoId of todoMap.keys()) {
        if (!indices.has(todoId)) {
            strongConnect(todoId);
        }
    }

    return components;

    function strongConnect(todoId) {
        indices.set(todoId, index);
        lowLinks.set(todoId, index);
        index += 1;
        stack.push(todoId);
        onStack.add(todoId);

        for (const dependencyId of dependencyIdsByTodo.get(todoId) ?? []) {
            if (!todoMap.has(dependencyId)) {
                continue;
            }

            if (!indices.has(dependencyId)) {
                strongConnect(dependencyId);
                lowLinks.set(todoId, Math.min(lowLinks.get(todoId), lowLinks.get(dependencyId)));
            } else if (onStack.has(dependencyId)) {
                lowLinks.set(todoId, Math.min(lowLinks.get(todoId), indices.get(dependencyId)));
            }
        }

        if (lowLinks.get(todoId) !== indices.get(todoId)) {
            return;
        }

        const component = [];
        while (stack.length > 0) {
            const member = stack.pop();
            onStack.delete(member);
            component.push(member);
            if (member === todoId) {
                break;
            }
        }

        const hasSelfLoop = component.length === 1 && (dependencyIdsByTodo.get(component[0]) ?? []).includes(component[0]);
        if (component.length > 1 || hasSelfLoop) {
            components.push(component.sort(collator.compare));
        }
    }
}

function getGroupComparator(groupKey) {
    switch (groupKey) {
        case "in_progress":
            return compareUpdatedDesc;
        case "done":
            return compareUpdatedDesc;
        case "blocked":
            return compareBlocked;
        case "pending_ready":
        default:
            return compareCreatedAsc;
    }
}

function compareBlocked(left, right) {
    const severityDiff = blockedSeverity(right) - blockedSeverity(left);
    if (severityDiff !== 0) {
        return severityDiff;
    }

    return compareCreatedAsc(left, right);
}

function blockedSeverity(item) {
    return item.unmetDependencyIds.length
        + item.missingDependencyIds.length
        + item.issues.filter((issue) => issue.type === "cycle").length * 2
        + (item.rawStatus === "blocked" ? 1 : 0);
}

function compareCreatedAsc(left, right) {
    const diff = timestampMs(left.createdAt, left.updatedAt) - timestampMs(right.createdAt, right.updatedAt);
    if (diff !== 0) {
        return diff;
    }

    return compareTitles(left, right);
}

function compareUpdatedDesc(left, right) {
    const diff = timestampMs(right.updatedAt, right.createdAt) - timestampMs(left.updatedAt, left.createdAt);
    if (diff !== 0) {
        return diff;
    }

    return compareTitles(left, right);
}

function compareTitles(left, right) {
    const titleDiff = collator.compare(left.title, right.title);
    if (titleDiff !== 0) {
        return titleDiff;
    }

    return collator.compare(left.id, right.id);
}

function timestampMs(...values) {
    for (const value of values) {
        if (!value) {
            continue;
        }

        const ms = Date.parse(value);
        if (!Number.isNaN(ms)) {
            return ms;
        }
    }

    return 0;
}

function pluralize(count, noun) {
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function safeText(value) {
    return typeof value === "string" ? value.trim() : "";
}
