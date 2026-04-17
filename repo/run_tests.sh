#!/bin/sh
# Orchestrates the full test run inside Docker, group by group.
#
# The jsdom-based groups (unit, integration, component, flow) run inside the
# `test` service defined in docker-compose.yml. The Playwright browser group
# runs inside `test-browser`, a separate image preloaded with Chromium and
# the system deps Playwright needs.
#
# Each group runs in its own container invocation so a failure surfaces
# immediately for that group and does not corrupt the next group's state.
# Docker itself isolates IndexedDB / filesystem state between groups.
set -eu

# Pick whichever docker-compose invocation is available on the host.
COMPOSE="docker compose"
if ! $COMPOSE version >/dev/null 2>&1; then
  COMPOSE="docker-compose"
fi

cleanup() {
  echo ">>> Cleaning up test containers..."
  $COMPOSE rm -fsv test test-browser >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ">>> Building test images..."
$COMPOSE build test test-browser

# The test service's entrypoint is `/bin/sh -c`, so we pass the command as
# a single string. --rm removes the container after each group.
run_jsdom_group() {
  label="$1"
  script="$2"
  echo ">>> $label"
  $COMPOSE run --rm --entrypoint sh test -c "npm run $script"
}

echo ">>> [1/5] Unit tests (pure logic, jsdom)"
run_jsdom_group "[1/5] Unit tests" test:unit

echo ">>> [2/5] Integration tests (service layer + fake-indexeddb)"
run_jsdom_group "[2/5] Integration tests" test:integration

echo ">>> [3/5] Component tests (direct Svelte render under jsdom)"
run_jsdom_group "[3/5] Component tests" test:component

echo ">>> [4/5] Flow tests (jsdom, multi-step user journeys)"
run_jsdom_group "[4/5] Flow tests" test:flow

echo ">>> [5/5] Browser tests (Playwright + Chromium)"
$COMPOSE run --rm --entrypoint bash test-browser -c \
  "npm run preview & sleep 3 && npx playwright test"

echo ">>> All test groups passed."
