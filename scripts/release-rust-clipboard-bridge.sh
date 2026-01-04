#!/usr/bin/env bash
set -euo pipefail

# Release script for Rust clipboard-bridge
# - Builds release binary
# - Computes sha256
# - Creates a Git tag and GitHub release via API (requires GITHUB_TOKEN)
# - Uploads asset and writes a lockfile with pinned commit and SHA

REPO_SLUG=${REPO_SLUG:-"RyansOpenSourceRice/overlay-companion-mcp"}
CRATE_DIR="rust-clipboard-bridge"
BINARY_NAME="clipboard-bridge"
ASSETS_DIR="release/artifacts"
LOCKFILE="release/clipboard-bridge.lock.json"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain (cargo) not found. Please install Rust or run via CI runner with Rust installed." >&2
  exit 1
fi

pushd "$CRATE_DIR" >/dev/null
cargo build --release
popd >/dev/null

mkdir -p "$ASSETS_DIR"
ASSET_PATH="$ASSETS_DIR/${BINARY_NAME}-linux-x86_64"
cp "${CRATE_DIR}/target/release/${BINARY_NAME}" "$ASSET_PATH"

SHA256=$(sha256sum "$ASSET_PATH" | awk '{print $1}')
COMMIT_SHA=$(git rev-parse HEAD)
VERSION_TAG="clipboard-bridge-v$(date -u +%Y%m%d)-${COMMIT_SHA:0:7}"

cat > "$LOCKFILE" <<EOF
{
  "name": "clipboard-bridge",
  "tag": "${VERSION_TAG}",
  "commit": "${COMMIT_SHA}",
  "sha256": "${SHA256}",
  "asset": "${ASSET_PATH}"
}
EOF

echo "Built asset: $ASSET_PATH"
echo "SHA256: $SHA256"
echo "Lockfile written: $LOCKFILE"

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "Creating GitHub release ${VERSION_TAG}..."
  API_URL="https://api.github.com/repos/${REPO_SLUG}/releases"
  RELEASE_JSON=$(jq -n --arg tag "$VERSION_TAG" --arg name "$VERSION_TAG" '{tag_name:$tag,name:$name,prerelease:true,generate_release_notes:true}')
  RESPONSE=$(curl -sS -H "Authorization: token ${GITHUB_TOKEN}" -H "Content-Type: application/json" -d "$RELEASE_JSON" "$API_URL")
  UPLOAD_URL=$(echo "$RESPONSE" | jq -r '.upload_url' | sed 's/{?name,label}//')
  if [[ "$UPLOAD_URL" == "null" || -z "$UPLOAD_URL" ]]; then
    echo "Failed to create release: $RESPONSE" >&2
    exit 1
  fi
  echo "Uploading asset..."
  curl -sS -H "Authorization: token ${GITHUB_TOKEN}" -H "Content-Type: application/octet-stream" --data-binary @"$ASSET_PATH" "${UPLOAD_URL}?name=$(basename "$ASSET_PATH")" >/dev/null
  echo "Release created and asset uploaded."
else
  echo "GITHUB_TOKEN not set; skipping GitHub release creation."
fi
