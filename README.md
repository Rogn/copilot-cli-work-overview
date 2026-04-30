# Copilot CLI Work Overview

**A read-only native dashboard for the current Copilot CLI session work queue.**

Work Overview reads the live session database directly and shows the queue tracked in `todos` and `todo_deps`, grouped into:

- **In progress**
- **Pending (ready)**
- **Blocked**
- **Done**

V1 is intentionally narrow:

- current live session only
- direct SQLite reads from `~/.copilot/session-state/{session-id}/session.db`
- read-only UI
- explicit surfacing of missing dependency targets and dependency cycles

## Prerequisites

| Requirement | Details |
| --- | --- |
| GitHub Copilot CLI | Installed and working |
| Experimental mode | Enable with `/experimental on` or `copilot --experimental` |
| Node.js | v20.11+ with `node` and `npm` on PATH |
| Platform | Windows (x64), macOS (arm64/x64), Linux (x64) |

## Install

**PowerShell**

```powershell
irm https://raw.githubusercontent.com/Rogn/copilot-cli-work-overview/master/install.ps1 | iex
```

**bash**

```bash
curl -fsSL https://raw.githubusercontent.com/Rogn/copilot-cli-work-overview/master/install.sh | bash
```

After install:

1. If Copilot CLI is already running, reload extensions.
2. Open the dashboard with `/work-overview` or `/overview`.

Manual install: copy `.github/extensions/work-overview` to `~/.copilot/extensions/work-overview`.

## Usage

Open the window:

```text
/work-overview
```

Natural-language tool access also works through:

- `work_overview_show`
- `work_overview_close`

## Notes

- The dashboard polls the live session database and shows visible last-updated information.
- If direct database access fails, the UI shows a clear error instead of falling back to a different source.
- `inbox_entries` is intentionally out of scope for V1.
