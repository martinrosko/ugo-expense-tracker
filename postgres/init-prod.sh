#!/bin/sh
# Runs once on an empty data volume: Keycloak gets its own database and user instead of sharing the app's
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '$KEYCLOAK_DB_PASSWORD';
CREATE DATABASE keycloak OWNER keycloak;
SQL
