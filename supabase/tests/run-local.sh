#!/usr/bin/env bash
# Runs the migrations, seed and API tests against a throwaway local Postgres 16.
# Stands in for the Supabase-provided roles (anon, authenticated) and auth.uid().
# Usage: supabase/tests/run-local.sh [--keep]   (--keep leaves the server running on :54329)
set -euo pipefail
cd "$(dirname "$0")/../.."
# Postgres refuses to run as root: re-run this script as the postgres system user.
if [[ $(id -u) -eq 0 ]] && id postgres >/dev/null 2>&1; then
  exec runuser -u postgres -- "$0" "$@"
fi
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=$(mktemp -d /tmp/cpos-pg.XXXXXX)
PORT=${PORT:-54329}
export PGHOST=$DATA PGPORT=$PORT PGUSER=postgres PGDATABASE=postgres

"$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" start >/dev/null
trap '[[ "${1:-}" == "--keep" ]] || { "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null; rm -rf "$DATA"; }' EXIT

psql -q -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema extensions;
create schema auth;
-- Same behaviour as Supabase: the signed-in user's JWT claims arrive in request.jwt.claims.
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
grant usage on schema public, extensions, auth to anon, authenticated;
SQL

for f in supabase/migrations/*.sql; do
  echo "migration: $f"
  psql -q -v ON_ERROR_STOP=1 -f "$f"
done
echo "seed"
time psql -q -v ON_ERROR_STOP=1 -f supabase/seed.sql
for t in supabase/tests/*.test.sql; do
  echo "tests: $t"
  psql -q -v ON_ERROR_STOP=1 -f "$t"
done
echo "ALL DATABASE TESTS PASSED"
if [[ "${1:-}" == "--keep" ]]; then echo "server left running: PGHOST=$DATA PGPORT=$PORT"; fi
