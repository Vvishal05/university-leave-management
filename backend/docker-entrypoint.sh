#!/bin/sh
set -eu

mkdir -p /app/uploads
chown -R app:app /app/uploads
exec su-exec app "$@"
