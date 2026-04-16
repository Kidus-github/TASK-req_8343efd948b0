#!/bin/sh
set -eu

echo ">>> Installing dependencies (npm ci)..."
npm ci

echo ">>> Running unit tests..."
npm run test:unit

echo ">>> Running integration tests..."
npm run test:integration

echo ">>> Running component tests (Svelte render tests under jsdom)..."
npm run test:component

echo ">>> Running flow tests (jsdom, service-level user flows)..."
npm run test:flow

echo ">>> All tests passed."
