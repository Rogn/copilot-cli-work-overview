#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-Rogn/copilot-cli-work-overview}"
REF="${REF:-master}"
SOURCE_DIR="${SOURCE_DIR:-}"
INSTALL_ROOT="${INSTALL_ROOT:-${HOME}/.copilot/extensions}"

tmp_dir="$(mktemp -d)"
archive_url="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
install_root="${INSTALL_ROOT}"
target_dir="${install_root}/work-overview"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

if [[ -n "${SOURCE_DIR}" ]]; then
  source_dir="${SOURCE_DIR}/.github/extensions/work-overview"
else
  echo "Downloading ${archive_url}"
  curl -fsSL "${archive_url}" | tar -xzf - -C "${tmp_dir}"
  repo_root="$(find "${tmp_dir}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  source_dir="${repo_root}/.github/extensions/work-overview"
fi

if [[ ! -d "${source_dir}" ]]; then
  echo "Extension folder missing: ${source_dir}" >&2
  exit 1
fi

mkdir -p "${install_root}"
mkdir -p "${target_dir}"
if ! find "${target_dir}" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null; then
  echo "" >&2
  echo "ERROR: Cannot update the existing install — files are locked." >&2
  echo "A running Copilot CLI session can keep runtime files loaded." >&2
  echo "This installer preserves node_modules during updates, but some files are still locked." >&2
  echo "" >&2
  echo "Fix: close Work Overview and reload or exit Copilot CLI, then re-run this script." >&2
  exit 1
fi

tar --exclude='node_modules' --exclude='*/node_modules' -cf - -C "${source_dir}" . | tar -xf - -C "${target_dir}"

echo "Installed Work Overview to ${target_dir}"
echo ""
echo "Next steps:"
echo "  1. Already in Copilot CLI?"
echo "     Reload extensions so dependency changes can be reconciled, then run /work-overview."
echo "  2. Starting fresh?"
echo "     Run: copilot --experimental"
echo "     Then: /work-overview"
