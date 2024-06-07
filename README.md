# Example FTSOv2 feed value provider

Sample provider implementation that serves values for requested feed ids. By default, it provides latest values for supported feeds from exchanges using CCXT.

However, for testing it can be configured to return a fixed or random values by setting `VALUE_PROVIDER_IMPL` env variable to either `fixed` or `random` (left blank will default to CCXT).

Starting provider:
```
docker run --rm -it --publish "0.0.0.0:3101:3101" ghcr.io/flare-foundation/ftso-v2-example-value-provider
```

## Obtaining feed values

There are two API endpoints: `/feed-values/<votingRound>` and `/feed-values/`, to be used by FTSO Scaling data provider and Fast Updates client respectively. In this (basic) example implementation, however, both endpoints map to the same service logic and return the latest feed values.

## Sample usage

Feed values for voting round id:
```bash
curl -X 'POST' \
  'http://localhost:3101/feed-values/0' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "feeds": [
    { "category": 1, "name" : "BTC/USD" }
  ]
}'
```

Response:
```json
{
  "votingRoundId": 0,
  "data": [
    { "feed": { "category": 1, "name": "BTC/USD" }, "value": 71287.34508311428 }
  ]
}

```
---
Current values:
```bash
curl -X 'POST' \
  'http://localhost:3101/feed-values/' \ 
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "feeds": [
    { "category": 1, "name" : "BTC/USD" }
  ]
}'
```

Response:
```json
{
  "data": [
    { "feed": { "category": 1, "name": "BTC/USD" }, "value": 71285.74004472858 }
  ]
}

```