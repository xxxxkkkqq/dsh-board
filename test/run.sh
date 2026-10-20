#!/usr/bin/env bash
# Run the dsh-board tests.
#
# Host-half tests need nothing but Node. The client tests render the real
# bundle through react-test-renderer, which the Harness does not ship, so this
# script installs it into a scratch directory once and runs the suite there
# with the package's own files copied in.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
scratch="${TMPDIR:-/tmp}/dsh-board-test"

mkdir -p "$scratch"
if [ ! -d "$scratch/node_modules/react-test-renderer" ]; then
  ( cd "$scratch" && npm init -y >/dev/null 2>&1 && npm i --silent react@18 react-dom@18 react-test-renderer@18 >/dev/null 2>&1 )
fi

node -e "const fs=require('fs');const p='$scratch/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.type!=='module'){j.type='module';fs.writeFileSync(p,JSON.stringify(j,null,2))}"

cp "$root/index.js" "$root/client.js" "$scratch/"
cp "$here"/*.mjs "$scratch/"
# the tests reference ../index.js and ../client.js; in the scratch copy the two
# files sit beside them
sed -i "s|'../index.js'|'./index.js'|; s|'../client.js'|'./client.js'|" "$scratch"/*.mjs

node "$scratch/all.mjs"
