# Example FTSO feed value provider

Sample provider implementation that serves values for requested feed ids. By default, it provides latest values for supported feeds from exchanges using CCXT.

However, for testing it can be configured to return a fixed or random values by setting `VALUE_PROVIDER_IMPL` env variable to either `fixed` or `random` (left blank will default to CCXT).