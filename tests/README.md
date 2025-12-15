# API Test Scripts

This directory contains bash test scripts for the FTSOv2 Provider API endpoints, based on the examples from the main README.

## Test Scripts

- **`test-feed-values-with-round.sh`**: Tests the `/feed-values/<votingRound>` endpoint (FTSOv2 Scaling clients)
- **`test-feed-values-latest.sh`**: Tests the `/feed-values/` endpoint (FTSOv2 Fast Updates clients)
- **`test-all.sh`**: Runs all test scripts in sequence

## Usage

### Run Individual Tests

```bash
# Test feed values with voting round ID
./tests/test-feed-values-with-round.sh [votingRoundId]

# Test latest feed values
./tests/test-feed-values-latest.sh
```

### Run All Tests

```bash
./tests/test-all.sh
```

### Custom Base URL

You can override the default base URL (`http://localhost:3101`) by setting the `BASE_URL` environment variable:

```bash
BASE_URL=http://localhost:3102 ./tests/test-all.sh
```

## Requirements

- `curl` - for making HTTP requests
- `jq` (optional) - for pretty-printing JSON responses. If not available, raw JSON will be displayed.

## Example Output

```
Testing /feed-values/0 endpoint...
Base URL: http://localhost:3101

HTTP Status Code: 200

Response Body:
{
  "votingRoundId": 0,
  "data": [
    {
      "feed": {
        "category": 1,
        "name": "BTC/USD"
      },
      "value": 71287.34508311428
    }
  ]
}

✓ Test passed!
```

