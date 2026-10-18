#!/bin/sh
# Stub for docker-credential-osxkeychain.
# launchd runner has no macOS keychain session; return empty creds so Docker falls back to anonymous.
echo "[]"
exit 0
