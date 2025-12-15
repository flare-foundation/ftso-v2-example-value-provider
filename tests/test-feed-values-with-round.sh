#!/bin/bash

# Test script for /feed-values/<votingRound> endpoint
# This endpoint retrieves feed values for a specified voting round.
# Used by FTSOv2 Scaling clients.

set -e

BASE_URL="${BASE_URL:-http://localhost:3101}"
VOTING_ROUND_ID="${1:-0}"

echo "Testing /feed-values/${VOTING_ROUND_ID} endpoint..."
echo "Base URL: ${BASE_URL}"
echo ""

response=$(curl -s -w "\n%{http_code}" -X 'POST' \
  "${BASE_URL}/feed-values/${VOTING_ROUND_ID}" \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "feeds": [
    { "category": 1, "name" : "BTC/USD" }
  ]
}')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP Status Code: ${http_code}"
echo ""
echo "Response Body:"
echo "$body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
  echo ""
  echo "✓ Test passed!"
  exit 0
else
  echo ""
  echo "✗ Test failed with HTTP status ${http_code}"
  exit 1
fi

