#!/usr/bin/env bash
# Packages the plugin as build/zotero-quiet-popup-<version>.xpi
set -euo pipefail
cd "$(dirname "$0")"

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="build/zotero-quiet-popup-$version.xpi"

mkdir -p build
rm -f "$out"
zip -q -X "$out" manifest.json bootstrap.js prefs.js quiet-popup.js preferences.xhtml preferences.js icon.svg
echo "$out"
