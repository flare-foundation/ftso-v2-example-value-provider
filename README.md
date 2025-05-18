# FTSOv2 Feed Value Provider by AnimaTow

This is an enhanced implementation of an FTSOv2 feed value provider by **AnimaTow**, offering flexible configuration for real-world or test-based data provisioning.

It supports:
- Smart aggregation from real exchanges via [CCXT](https://ccxt.readthedocs.io/)
- Optional outlier filtering and volume-based weighting
- Fixed or random values for testing purposes

## 🔧 Configuration

The provider behavior can be customized via environment variables:

### Required

| Variable               | Description                                               |
|------------------------|-----------------------------------------------------------|
| `VALUE_PROVIDER_IMPL`  | Set to `ccxt` (default), `ftsoccxt`, `fixed`, or `random` |
| `VALUE_PROVIDER_CLIENT_PORT` | Port to run the API server (default: `3101`)              |

### SmartCCXT Specific

| Variable                      | Description                                                                 |
|-------------------------------|-----------------------------------------------------------------------------|
| `MEDIAN_DECAY`                | Decay factor used in weighted median calculation (default: `0.00005`)      |
| `TRADES_HISTORY_SIZE`         | Max number of trades to cache per symbol (default: `1000`)                 |

## 🚀 Starting the Provider (Docker)

```bash
docker run --rm -it --publish "0.0.0.0:3101:3101" \
  -e VALUE_PROVIDER_IMPL=ccxt \
  ghcr.io/animatow/ftso-v2-value-provider:latest
```

The service will be available on:  
📚 API Docs: [http://localhost:3101/api-doc](http://localhost:3101/api-doc)

---

## 📡 Obtaining Feed Values

The provider exposes two API endpoints:

### `POST /feed-values/<votingRound>`

Retrieve values for a specific voting round (used in FTSOv2 Scaling phase).

### `POST /feed-values/`

Retrieve the latest available feed values (used in Fast Updates).

#### Example Request:

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

#### Example Response:

```json
{
  "votingRoundId": 0,
  "data": [
    { "feed": { "category": 1, "name": "BTC/USD" }, "value": 71287.34 }
  ]
}
```

---

## 🧠 About SmartCCXTFeed

When `VALUE_PROVIDER_IMPL=smartccxt`, the provider intelligently:

- Aggregates prices from multiple exchanges (configurable via `feeds.json`)
- Applies **outlier filtering** using median logic
- Weights price data based on **freshness** and **volume**
- Converts USDT-pairs into USD using a live `USDT/USD` feed

---

## 🔍 Feeds Configuration

Feeds and source exchanges are defined in `feeds.json`. Example:

```json
{
  "feed": { "category": 1, "name": "BTC/USD" },
  "sources": [
    { "exchange": "binance", "symbol": "BTC/USDT" },
    { "exchange": "coinbase", "symbol": "BTC/USD" }
  ]
}
```

---

## ✅ Status
add ftsoccxt class, 
add ping for Websockets.
add VotEposten Indexer History Data FTSO
add fallback-prices.json for Restart Map is Clean
add PRICE_TTL_MS to env History time für MAP datas

This fork is actively maintained by [AnimaTow](https://github.com/AnimaTow) and extends the Flare Foundation’s original version with smart aggregation logic for FTSOv2.

---
