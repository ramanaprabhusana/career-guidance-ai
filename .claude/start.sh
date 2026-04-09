#!/bin/bash
export PATH=/opt/homebrew/bin:$PATH
cd "$(dirname "$0")/.."
exec npx tsx src/server.ts
