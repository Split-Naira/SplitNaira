@echo off
REM =============================================================================
REM  submit_pr.bat  -  Windows
REM
REM  Resolves issues #592 #593 #594 #595 in one branch.
REM
REM  Usage:
REM    1. Copy this file into the ROOT of your local SplitNaira clone.
REM    2. Copy the "frontend\" output folder next to this file.
REM    3. Double-click or run from a terminal: submit_pr.bat
REM =============================================================================

setlocal EnableDelayedExpansion

set BRANCH=feat/ui-issues-592-593-594-595
set SRC=frontend\src

echo.
echo ========================================
echo   SplitNaira -- PR branch setup
echo ========================================
echo.

REM 0. Sanity
if not exist "package.json" (
    echo ERROR: Run this from the ROOT of the SplitNaira repo.
    pause & exit /b 1
)
if not exist "%SRC%" (
    echo ERROR: Cannot find "%SRC%". Make sure the frontend\ output folder
    echo        is next to this script.
    pause & exit /b 1
)

REM 1. Pull latest main
echo [1/7] Pulling latest main...
git checkout main
if %errorlevel% neq 0 ( echo FAILED & pause & exit /b 1 )
git pull origin main
if %errorlevel% neq 0 ( echo FAILED & pause & exit /b 1 )

REM 2. Create / reset branch
echo [2/7] Creating branch: %BRANCH%
git show-ref --verify --quiet "refs/heads/%BRANCH%"
if %errorlevel% equ 0 (
    echo       Already exists -- resetting to main.
    git checkout "%BRANCH%"
    git reset --hard main
) else (
    git checkout -b "%BRANCH%"
)
if %errorlevel% neq 0 ( echo FAILED & pause & exit /b 1 )

REM 3. Copy files (xcopy creates dirs automatically)
echo [3/7] Copying source files...

REM ── #595 AppShellContext (new)
if not exist "frontend\src\context" mkdir "frontend\src\context"
copy /Y "%SRC%\context\AppShellContext.tsx"  "frontend\src\context\AppShellContext.tsx"

REM ── #592 SplitAppContext (new)
copy /Y "%SRC%\context\SplitAppContext.tsx"  "frontend\src\context\SplitAppContext.tsx"

REM ── #593 WalletButton (new)
copy /Y "%SRC%\components\WalletButton.tsx"  "frontend\src\components\WalletButton.tsx"

REM ── #594 EmptyState (new)
copy /Y "%SRC%\components\EmptyState.tsx"    "frontend\src\components\EmptyState.tsx"

REM ── #594 DashboardView (modified)
if not exist "frontend\src\components\dashboard" mkdir "frontend\src\components\dashboard"
copy /Y "%SRC%\components\dashboard\DashboardView.tsx" "frontend\src\components\dashboard\DashboardView.tsx"

REM ── #592 Modal files (new)
if not exist "frontend\src\components\modals" mkdir "frontend\src\components\modals"
copy /Y "%SRC%\components\modals\DistributeConfirmModal.tsx" "frontend\src\components\modals\DistributeConfirmModal.tsx"
copy /Y "%SRC%\components\modals\LockConfirmModal.tsx"       "frontend\src\components\modals\LockConfirmModal.tsx"
copy /Y "%SRC%\components\modals\DepositModal.tsx"           "frontend\src\components\modals\DepositModal.tsx"
copy /Y "%SRC%\components\modals\PauseConfirmModal.tsx"      "frontend\src\components\modals\PauseConfirmModal.tsx"
copy /Y "%SRC%\components\modals\MetadataEditModal.tsx"      "frontend\src\components\modals\MetadataEditModal.tsx"

REM ── #592 #593 #595 split-app.tsx (modified)
copy /Y "%SRC%\components\split-app.tsx"       "frontend\src\components\split-app.tsx"

REM ── #595 DashboardLayout (modified)
copy /Y "%SRC%\components\DashboardLayout.tsx" "frontend\src\components\DashboardLayout.tsx"

REM ── #595 locale page (modified)
REM  Note: square brackets in paths need quoting on Windows
if not exist "frontend\src\app\[locale]" mkdir "frontend\src\app\[locale]"
copy /Y "%SRC%\app\[locale]\page.tsx" "frontend\src\app\[locale]\page.tsx"

echo       All files copied.

REM 4. Stage
echo [5/7] Staging changes...
git add "frontend/src/context/AppShellContext.tsx"
git add "frontend/src/context/SplitAppContext.tsx"
git add "frontend/src/components/WalletButton.tsx"
git add "frontend/src/components/EmptyState.tsx"
git add "frontend/src/components/dashboard/DashboardView.tsx"
git add "frontend/src/components/modals/DistributeConfirmModal.tsx"
git add "frontend/src/components/modals/LockConfirmModal.tsx"
git add "frontend/src/components/modals/DepositModal.tsx"
git add "frontend/src/components/modals/PauseConfirmModal.tsx"
git add "frontend/src/components/modals/MetadataEditModal.tsx"
git add "frontend/src/components/split-app.tsx"
git add "frontend/src/components/DashboardLayout.tsx"
git add "frontend/src/app/[locale]/page.tsx"

REM 5. Commit
echo [6/7] Committing...
git commit -m "feat(ui): resolve issues #592 #593 #594 #595" ^
  -m "#592 - split-app.tsx god component decomposed: SplitAppContext + 5 modal files" ^
  -m "#593 - polished WalletButton with avatar, dropdown, mobile chip" ^
  -m "#594 - DashboardView empty state + consistent skeleton loading" ^
  -m "#595 - DashboardLayout wired as canonical app shell via AppShellContext"
if %errorlevel% neq 0 ( echo COMMIT FAILED & pause & exit /b 1 )

REM 6. Push
echo [7/7] Pushing to origin...
git push -u origin "%BRANCH%"
if %errorlevel% neq 0 ( echo PUSH FAILED & pause & exit /b 1 )

echo.
echo ========================================
echo   Done! Open your PR at:
echo   https://github.com/Godsmiracle001/SplitNaira/compare/%BRANCH%
echo.
echo   PR title:
echo   feat(ui): resolve issues #592 #593 #594 #595
echo ========================================
echo.
pause
