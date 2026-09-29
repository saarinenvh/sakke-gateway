#!/bin/sh
# Copies the local development values in .env.example to .env, for running the
# gateway outside Docker (npm run dev). Run it once per checkout or worktree.
# An existing .env is kept unless --force is given.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
example="$repo_root/.env.example"
target="$repo_root/.env"

if [ -e "$target" ] && [ "${1:-}" != "--force" ]; then
  echo "$target already exists - rerun with --force to replace it" >&2
  exit 1
fi

cp "$example" "$target"
echo "Wrote $target from .env.example"
