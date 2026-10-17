#!/usr/bin/env bash
set -euo pipefail
# Model --query-file -: consume the request before exiting, like Hermes.
# An immediate exit races the parent write and intermittently causes EPIPE.
while IFS= read -r line || [[ -n "$line" ]]; do :; done
printf '{"ok":true,"route":"hermes"}\n'
