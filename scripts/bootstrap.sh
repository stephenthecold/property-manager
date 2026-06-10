#!/bin/sh
# Dependency-free installer bootstrap for deploy hosts (mirrors `npm run
# bootstrap`, which needs Node and remains for dev machines). Creates .env from
# .env.example if missing and fills AUTH_SECRET / SETTINGS_ENC_KEY /
# SETUP_BOOTSTRAP_TOKEN when absent or empty — existing values are never
# touched, so it is safe to re-run. Requires only openssl.
set -eu

cd "$(dirname "$0")/.."

command -v openssl >/dev/null 2>&1 || {
  echo "error: openssl is required (apt install openssl)" >&2
  exit 1
}

if [ ! -f .env ]; then
  [ -f .env.example ] || { echo "error: no .env or .env.example here" >&2; exit 1; }
  cp .env.example .env
  echo "Created .env from .env.example"
fi

rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1" | tr -d '\n'; }

# Print the unquoted value of key $1 in .env (empty if missing/blank).
current_value() {
  sed -n "s/^[[:space:]]*$1=//p" .env | head -n 1 \
    | sed -e 's/^["'\'']//' -e 's/["'\'']*[[:space:]]*$//'
}

ensure_secret() {
  key="$1" gen="$2" bytes="$3"
  if [ -n "$(current_value "$key")" ]; then
    echo "  $key: already set"
    return 0
  fi
  val="$("$gen" "$bytes")"
  if grep -q "^[[:space:]]*${key}=" .env; then
    # Replace the empty placeholder in place — never append a duplicate key,
    # which dotenv/compose would mis-resolve.
    awk -v k="$key" -v v="$val" '
      !done && $0 ~ ("^[[:space:]]*" k "=") { print k "=\"" v "\""; done = 1; next }
      { print }
    ' .env > .env.bootstrap.tmp && mv .env.bootstrap.tmp .env
  else
    printf '%s="%s"\n' "$key" "$val" >> .env
  fi
  echo "  $key: generated"
}

echo "Ensuring secrets in .env:"
ensure_secret AUTH_SECRET           rand_b64 36
ensure_secret SETTINGS_ENC_KEY      rand_b64 32
ensure_secret SETUP_BOOTSTRAP_TOKEN rand_hex 24
chmod 600 .env

token="$(current_value SETUP_BOOTSTRAP_TOKEN)"
app_url="$(current_value APP_URL)"
[ -n "$app_url" ] || app_url="http://localhost:3000"

cat <<EOF

=== Bootstrap complete ===
Setup token: $token
Setup URL (configured APP_URL): $app_url/setup?token=$token
Setup URL (local Docker):       http://localhost:3000/setup?token=$token

Next steps (Docker Compose):
  1. edit .env: set POSTGRES_PASSWORD (and APP_URL for production)
  2. docker compose up -d            # builds on first run; or set APP_IMAGE in
                                     # .env and: docker compose pull app worker
  3. open the local setup URL above and create the first owner
  4. docker compose exec app npm run breakglass issue   # emergency login
     (run break-glass INSIDE the stack — the host can't reach the 'db' hostname)
EOF
