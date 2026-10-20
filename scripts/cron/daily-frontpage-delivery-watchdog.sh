#!/usr/bin/env bash
set -Eeuo pipefail
# Frontpage-only notification observer. Never starts a press or an agent.
# Rollout cutoff prevents a second daily message for the already-delivered Oct 20.
export DFE_DELIVERY_START_DATE=2026-10-21
exec /usr/bin/python3 /Users/nickgeorge-studio/Projects/hermes-frontpage-engine/scripts/delivery-watchdog-runner.py
