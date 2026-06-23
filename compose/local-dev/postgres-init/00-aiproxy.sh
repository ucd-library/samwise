#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -c "CREATE DATABASE aiproxy;"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d aiproxy -f /sql/aiproxy-schema.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d aiproxy -f /sql/aiproxy-seed.sql

# Uncomment if using litellm (also uncomment litellm service in compose.yaml):
# psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -c "CREATE DATABASE litellm;"
