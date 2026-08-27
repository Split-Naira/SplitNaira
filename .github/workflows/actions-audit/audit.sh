#!/usr/bin/env bash

set -euo pipefail

WORKFLOW_DIR="${1:-.github/workflows}"

if [[ ! -d "$WORKFLOW_DIR" ]]; then
  echo "::error::Workflow directory not found: $WORKFLOW_DIR"
  exit 1
fi

workflow_count=0
finding_count=0

echo "GitHub Actions permissions audit"
echo "================================"
echo

while IFS= read -r -d '' workflow; do
  workflow_count=$((workflow_count + 1))

  echo "Workflow: $workflow"

  if ! grep -Eq '^[[:space:]]*permissions:[[:space:]]*$' "$workflow"; then
    echo "::warning file=$workflow::Workflow does not explicitly declare permissions."
    finding_count=$((finding_count + 1))
  fi

  while IFS= read -r line; do
    permission="$(sed -E 's/^[[:space:]]*([a-z-]+):[[:space:]]+write.*$/\1/' <<< "$line")"

    if [[ "$permission" != "$line" ]]; then
      echo "::warning file=$workflow::Write permission detected: $permission"
      finding_count=$((finding_count + 1))
    fi
  done < <(
    grep -E '^[[:space:]]+[a-z-]+:[[:space:]]+write([[:space:]]|$)' "$workflow" || true
  )

  echo

done < <(
  find "$WORKFLOW_DIR" \
    -type f \
    \( -name "*.yml" -o -name "*.yaml" \) \
    -print0
)

if [[ "$workflow_count" -eq 0 ]]; then
  echo "::error::No GitHub Actions workflow files found."
  exit 1
fi

echo "Audit complete."
echo "Workflows inspected: $workflow_count"
echo "Findings: $finding_count"

# Findings are informational in the initial implementation.
exit 0