#!/bin/bash

# Test runner script for all API endpoint tests
# Runs all test scripts in sequence

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3101}"

echo "=========================================="
echo "FTSOv2 Provider API Test Suite"
echo "=========================================="
echo "Base URL: ${BASE_URL}"
echo ""

# Test 1: Feed values with voting round ID
echo "Test 1: /feed-values/<votingRound> endpoint"
echo "----------------------------------------"
"${SCRIPT_DIR}/test-feed-values-with-round.sh" 0
echo ""

# Test 2: Latest feed values without voting round ID
echo "Test 2: /feed-values/ endpoint"
echo "----------------------------------------"
"${SCRIPT_DIR}/test-feed-values-latest.sh"
echo ""

echo "=========================================="
echo "All tests completed successfully!"
echo "=========================================="

