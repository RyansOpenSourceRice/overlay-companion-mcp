#!/bin/sh
set -eu
BASE_URL="${GUAC_BASE_URL}"
ADMIN_USER="${GUAC_ADMIN_USER:-guacadmin}"
ADMIN_PASS="${GUAC_ADMIN_PASS:-guacadmin}"
CONN_NAME="${GUAC_CONN_NAME:-fedora-vm}"
RDP_HOST="${GUAC_RDP_HOST:-vm.example.local}"
RDP_PORT="${GUAC_RDP_PORT:-3389}"
RDP_USER="${GUAC_RDP_USERNAME:-}"
RDP_PASS="${GUAC_RDP_PASSWORD:-}"
RDP_DOMAIN="${GUAC_RDP_DOMAIN:-}"
RDP_SECURITY="${GUAC_RDP_SECURITY:-any}"
RDP_IGNORE_CERT="${GUAC_RDP_IGNORE_CERT:-true}"
RDP_WIDTH="${GUAC_RDP_WIDTH:-1920}"
RDP_HEIGHT="${GUAC_RDP_HEIGHT:-1080}"

# Wait for Guacamole to be ready
printf 'Waiting for Guacamole at %s' "$BASE_URL"
for i in $(seq 1 60); do
  if curl -fsS "$BASE_URL/api/session" >/dev/null 2>&1; then echo ' up'; break; fi
  printf '.'; sleep 2
  if [ "$i" -eq 60 ]; then echo ' timeout'; exit 1; fi
done

# Login and obtain auth token
LOGIN_JSON=$(curl -fsS --data "username=$ADMIN_USER&password=$ADMIN_PASS" "$BASE_URL/api/tokens")
TOKEN=$(echo "$LOGIN_JSON" | sed -n 's/.*"authToken"\s*:\s*"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then echo 'Failed to obtain Guacamole auth token'; exit 1; fi

# Helper: find existing connection ID by name
get_conn_id() {
  curl -fsS "$BASE_URL/api/session/data/postgresql/connections?token=$TOKEN" \
  | sed -n "s/.*\"name\":\"$CONN_NAME\",\"identifier\":\"\([^"]*\)\".*/\1/p"
}

CONN_ID=$(get_conn_id || true)
if [ -n "$CONN_ID" ]; then
  echo "Updating existing Guacamole connection $CONN_NAME ($CONN_ID)"
  METHOD=PUT; URL="$BASE_URL/api/session/data/postgresql/connections/$CONN_ID?token=$TOKEN"
else
  echo "Creating new Guacamole connection $CONN_NAME"
  METHOD=POST; URL="$BASE_URL/api/session/data/postgresql/connections?token=$TOKEN"
fi

# Build connection payload
IGNORE_CERT_JSON=$( [ "$RDP_IGNORE_CERT" = "true" ] && echo 'true' || echo 'false' )
read -r -d '' JSON << EOF || true
{
  "parentIdentifier": "ROOT",
  "name": "$CONN_NAME",
  "protocol": "rdp",
  "parameters": {
    "hostname": "$RDP_HOST",
    "port": "$RDP_PORT",
    "username": "$RDP_USER",
    "password": "$RDP_PASS",
    "domain": "$RDP_DOMAIN",
    "security": "$RDP_SECURITY",
    "ignore-cert": $IGNORE_CERT_JSON,
    "enable-wallpaper": "false",
    "resize-method": "display-update",
    "initial-program": "",
    "width": "$RDP_WIDTH",
    "height": "$RDP_HEIGHT"
  },
  "attributes": {
    "max-connections": "20",
    "max-connections-per-user": "20"
  }
}
EOF

curl -fsS -X "$METHOD" -H 'Content-Type: application/json' \
  --data "$JSON" "$URL" >/dev/null

# Log out
curl -fsS -X DELETE "$BASE_URL/api/tokens/$TOKEN" >/dev/null || true

echo "Guacamole connection provisioned: $CONN_NAME -> $RDP_HOST:$RDP_PORT"
