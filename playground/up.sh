#!/usr/bin/env bash

docker compose \
 --env-file ./.env \
 -f compose.yml up -d
