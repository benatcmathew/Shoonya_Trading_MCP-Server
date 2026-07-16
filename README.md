# Shoonya MCP Server (Node.js)

A lightweight, standalone Model Context Protocol (MCP) server for algorithmic trading via the Shoonya Broker API.

This package is designed for **effortless distribution**. It runs natively over stdio, meaning it can be plugged directly into AI assistants like Claude Desktop, Cursor, or Gemini without requiring a Python environment.

## Features
- **Zero-Friction Install**: Run instantly via `npx`.
- **Smart Order Parsing**: Place orders using natural language command strings (e.g., `"NIFTY 24500 CE 30 L 110"`).
- **Auto Nearest Expiry**: Automatically resolves exact trading symbols for options.
- **Auto Master Data Caching**: In-memory caching of Shoonya's massive options CSV.
- **Auto Stop-Loss**: Dynamically calculates SL prices based on predefined index offsets.

## How to use with Claude Desktop
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "shoonya-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "github:benatcmathew/Shoonya_Trading_MCP-Server"
      ]
    }
  }
}
```

*(Note: Once published to the NPM registry, the args will simply be `["-y", "shoonya-mcp-server"]`)*

## Manual Setup
If you want to run or build from source:
1. `npm install`
2. `npm run build`
3. `npm start` (Runs the server over stdio)

## Available MCP Tools
- `login(user_id, password, totp_key, vendor_code, api_key, imei)`
- `place_order(buy_or_sell, command)`
- `place_manual_sl(command)`
- `place_auto_sl(order_id, index)`
- `modify_order(order_id, exchange, tradingsymbol, quantity, price_type, price)`
- `modify_sl(order_id, exchange, tradingsymbol, quantity, price_type, price, trigger_price)`
- `cancel_order(order_id)`
- `exit_order(order_id, product_type)`
- `get_order_book()`
- `check_margin()`
- `check_order_status(order_id)`
