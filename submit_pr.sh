#!/usr/bin/env bash
# =============================================================================
# submit_pr.sh  –  Mac / Linux
#
# Resolves issues #592 #593 #594 #595 in one branch.
#
# Usage:
#   1. Copy this script into the ROOT of your local SplitNaira clone.
#   2. Copy the entire "frontend/" folder output next to this script
#      (or keep the folder structure from the delivery zip).
#   3. Run:  bash submit_pr.sh
# =============================================================================

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
BRANCH="feat/ui-issues-592-593-594-595"
SOURCE_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"   # files sitting next to script
COMMIT_MSG='feat(ui): resolve issues #592 #593 #594 #595

#592 – split-app.tsx god component decomposed into SplitAppContext + 5 modal files
#593 – polished WalletButton component with avatar, dropdown, mobile chip
#594 – DashboardView empty state + consistent skeleton loading
#595 – DashboardLayout wired as canonical app shell via AppShellContext'
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "  SplitNaira – PR branch setup"
echo "========================================"
echo ""

# 0. Sanity
if [ ! -f "package.json" ]; then
  echo "ERROR: Run this script from the ROOT of the SplitNaira repo."
  exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: Cannot find the 'frontend/' output folder next to this script."
  echo "       Expected: $SOURCE_DIR"
  exit 1
fi

# 1. Up-to-date main
echo "[1/7] Pulling latest main…"
git checkout main
git pull origin main

# 2. Create / reset branch
echo "[2/7] Creating branch: $BRANCH"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "      Already exists – resetting to main."
  git checkout "$BRANCH"
  git reset --hard main
else
  git checkout -b "$BRANCH"
fi

# 3. Helper: copy a file, creating parent dirs as needed
copy_file() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "      ✓ $dest"
}

echo "[3/7] Copying new/modified source files…"

# ── Issue #595: AppShellContext (new)
copy_file \
  "$SOURCE_DIR/src/context/AppShellContext.tsx" \
  "frontend/src/context/AppShellContext.tsx"

# ── Issue #592: SplitAppContext (new)
copy_file \
  "$SOURCE_DIR/src/context/SplitAppContext.tsx" \
  "frontend/src/context/SplitAppContext.tsx"

# ── Issue #593: WalletButton (new)
copy_file \
  "$SOURCE_DIR/src/components/WalletButton.tsx" \
  "frontend/src/components/WalletButton.tsx"

# ── Issue #594: EmptyState (new)
copy_file \
  "$SOURCE_DIR/src/components/EmptyState.tsx" \
  "frontend/src/components/EmptyState.tsx"

# ── Issue #594: DashboardView (modified)
copy_file \
  "$SOURCE_DIR/src/components/dashboard/DashboardView.tsx" \
  "frontend/src/components/dashboard/DashboardView.tsx"

# ── Issue #592: modal extractions (new)
for modal in DistributeConfirmModal LockConfirmModal DepositModal PauseConfirmModal MetadataEditModal; do
  copy_file \
    "$SOURCE_DIR/src/components/modals/${modal}.tsx" \
    "frontend/src/components/modals/${modal}.tsx"
done

# ── Issue #592 #593 #595: split-app.tsx (modified)
copy_file \
  "$SOURCE_DIR/src/components/split-app.tsx" \
  "frontend/src/components/split-app.tsx"

# ── Issue #595: DashboardLayout (modified)
copy_file \
  "$SOURCE_DIR/src/components/DashboardLayout.tsx" \
  "frontend/src/components/DashboardLayout.tsx"

# ── Issue #595: locale page (modified)
copy_file \
  "$SOURCE_DIR/src/app/[locale]/page.tsx" \
  "frontend/src/app/[locale]/page.tsx"

# 4. (Optional) quick type-check — comment out if no local toolchain
echo "[4/7] Running type-check (skipping – uncomment if needed)…"
# cd frontend && npx tsc --noEmit && cd ..

# 5. Stage
echo "[5/7] Staging all changes…"
git add \
  "frontend/src/context/AppShellContext.tsx" \
  "frontend/src/context/SplitAppContext.tsx" \
  "frontend/src/components/WalletButton.tsx" \
  "frontend/src/components/EmptyState.tsx" \
  "frontend/src/components/dashboard/DashboardView.tsx" \
  "frontend/src/components/modals/DistributeConfirmModal.tsx" \
  "frontend/src/components/modals/LockConfirmModal.tsx" \
  "frontend/src/components/modals/DepositModal.tsx" \
  "frontend/src/components/modals/PauseConfirmModal.tsx" \
  "frontend/src/components/modals/MetadataEditModal.tsx" \
  "frontend/src/components/split-app.tsx" \
  "frontend/src/components/DashboardLayout.tsx" \
  "frontend/src/app/[locale]/page.tsx"

# 6. Commit
echo "[6/7] Committing…"
git commit -m "$COMMIT_MSG"

# 7. Push
echo "[7/7] Pushing to origin…"
git push -u origin "$BRANCH"

echo ""
echo "========================================"
echo "  Done! Open your PR at:"
echo "  https://github.com/Godsmiracle001/SplitNaira/compare/$BRANCH"
echo ""
echo "  PR title:"
echo "  feat(ui): resolve issues #592 #593 #594 #595"
echo "========================================"
echo ""
