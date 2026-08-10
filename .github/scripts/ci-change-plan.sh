#!/usr/bin/env bash

set -euo pipefail

output_file="${GITHUB_OUTPUT:?GITHUB_OUTPUT must point to the GitHub Actions output file}"
base_sha="${BASE_SHA:-}"
head_sha="${HEAD_SHA:-HEAD}"
full_validation="${FULL_VALIDATION:-false}"
changed_files_file="${CHANGED_FILES_FILE:-}"

api=false
billing=false
messaging=false
mcp=false
dashboard=false
flutter=false
flutterflow=false
flutterflow_messaging=false
ios=false
android=false
javascript=false
react_native=false
mark_all() {
  api=true
  billing=true
  messaging=true
  mcp=true
  dashboard=true
  flutter=true
  flutterflow=true
  flutterflow_messaging=true
  ios=true
  android=true
  javascript=true
  react_native=true
}

mark_root_node_workspaces() {
  api=true
  billing=true
  messaging=true
  mcp=true
  dashboard=true
}

mark_cloudflare_services() {
  api=true
  billing=true
  messaging=true
  mcp=true
  dashboard=true
}

plan_path() {
  local path="$1"

  case "$path" in
    .github/workflows/ci.yml|.github/scripts/ci-change-plan.sh)
      mark_all
      return
      ;;
    package.json|package-lock.json|pnpm-lock.yaml|.npmrc)
      mark_root_node_workspaces
      return
      ;;
    deploy/targets/*|deploy/generated/*|scripts/cloudflare-*.mjs)
      mark_cloudflare_services
      return
      ;;
    workers/api/*)
      api=true
      # Billing currently imports its financial implementation and contracts
      # from the API source tree, so API changes must validate both Workers.
      billing=true
      return
      ;;
    workers/billing/*)
      billing=true
      return
      ;;
    workers/messaging/*)
      messaging=true
      return
      ;;
    workers/mcp/*|apps/mcp/*)
      mcp=true
      return
      ;;
    apps/dashboard/*)
      dashboard=true
      return
      ;;
    sdks/flutter/ios/*)
      flutter=true
      flutterflow=true
      return
      ;;
    sdks/flutter/android/*)
      flutter=true
      flutterflow=true
      return
      ;;
    sdks/flutter/*)
      flutter=true
      # FlutterFlow consumes the Flutter package through a path dependency.
      flutterflow=true
      return
      ;;
    sdks/flutterflow/*)
      flutterflow=true
      return
      ;;
    sdks/flutterflow_messaging/*)
      flutterflow_messaging=true
      return
      ;;
    sdks/ios/*|Package.swift)
      ios=true
      return
      ;;
    sdks/android/*)
      android=true
      return
      ;;
    sdks/javascript/*)
      javascript=true
      return
      ;;
    sdks/react-native/*)
      react_native=true
      return
      ;;
    docs/*|README.md|LICENSE|.gitignore|.gitleaks.toml|.github/dependabot.yml|*.md)
      # Security and product-copy checks still run in the planning job.
      return
      ;;
    *)
      # New or unclassified paths fail safe by running the complete matrix.
      mark_all
      ;;
  esac
}

if [[ "$full_validation" == "true" ]]; then
  mark_all
elif [[ -n "$changed_files_file" ]]; then
  while IFS= read -r path; do
    [[ -n "$path" ]] && plan_path "$path"
  done < "$changed_files_file"
elif [[ -z "$base_sha" || "$base_sha" =~ ^0+$ ]] || ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  # New branches and incomplete histories are validated conservatively.
  mark_all
else
  while IFS= read -r path; do
    [[ -n "$path" ]] && plan_path "$path"
  done < <(git diff --name-only "$base_sha" "$head_sha")
fi

if [[ "$api" == "true" || "$billing" == "true" || "$messaging" == "true" || "$mcp" == "true" ]]; then
  workers=true
else
  workers=false
fi

if [[ "$flutter" == "true" || "$flutterflow" == "true" || "$flutterflow_messaging" == "true" ]]; then
  flutter_packages=true
else
  flutter_packages=false
fi

if [[ "$javascript" == "true" || "$react_native" == "true" ]]; then
  node_sdks=true
else
  node_sdks=false
fi

if [[ "$ios" == "true" || "$android" == "true" ]]; then
  native_sdks=true
else
  native_sdks=false
fi

for name in \
  api billing messaging mcp workers dashboard \
  flutter flutterflow flutterflow_messaging flutter_packages \
  ios android javascript react_native node_sdks native_sdks; do
  printf '%s=%s\n' "$name" "${!name}" >> "$output_file"
done
