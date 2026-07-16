# Shoonya MCP Server (Node.js)

A lightweight, **bank-level secure** Model Context Protocol (MCP) server for algorithmic trading via the Shoonya Broker API.

This package is designed for **effortless and secure distribution**. It runs natively over stdio, meaning it can be plugged directly into AI assistants like Claude Desktop, Cursor, or Gemini without requiring a Python environment.

## 🔐 Security Architecture

Your trading credentials are protected using **military-grade encryption**. The AI assistant **never** sees, stores, or transmits your passwords.

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│                   YOUR LOCAL MACHINE                    │
│                                                         │
│  ┌──────────────┐    Master     ┌──────────────────┐    │
│  │  AI (Claude,  │   Password   │  Shoonya MCP     │    │
│  │  Cursor, etc) │ ──────────►  │  Server (Node.js)│    │
│  │               │              │                  │    │
│  │  Never sees   │              │  Decrypts vault  │    │
│  │  credentials  │              │  locally only    │    │
│  └──────────────┘              └────────┬─────────┘    │
│                                         │               │
│                                         ▼               │
│                              ┌──────────────────┐       │
│                              │  ~/.shoonya-mcp/  │       │
│                              │  vault.enc        │       │
│                              │                   │       │
│                              │  AES-256-GCM      │       │
│                              │  encrypted file   │       │
│                              └──────────────────┘       │
│                                         │               │
│                                         ▼               │
│                              ┌──────────────────┐       │
│                              │  Shoonya Broker   │       │
│                              │  API (HTTPS)      │       │
│                              └──────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### Encryption Details

| Feature | Specification |
|---|---|
| **Encryption Algorithm** | AES-256-GCM (used by banks, governments, military) |
| **Key Derivation** | PBKDF2 with SHA-256, 310,000 iterations (OWASP 2023) |
| **Salt** | 32 bytes, cryptographically random, unique per vault |
| **IV (Nonce)** | 16 bytes, cryptographically random, unique per save |
| **Authentication** | GCM auth tag prevents tampering |
| **File Permissions** | `0600` (owner read/write only, Unix systems) |
| **Vault Location** | `~/.shoonya-mcp/vault.enc` (never in your project) |
| **AI Exposure** | ❌ Credentials never sent to or seen by the AI |

### What the AI Can See vs Cannot See

| Data | AI Can See? |
|---|---|
| Master Password | ✅ Only to decrypt vault (not stored) |
| User ID | ❌ Never |
| Broker Password | ❌ Never |
| TOTP Secret Key | ❌ Never |
| API Key | ❌ Never |
| Vendor Code | ❌ Never |
| IMEI | ❌ Never |
| Order commands | ✅ (e.g., "NIFTY 24500 CE 30") |
| Order results | ✅ (order ID, margin, status) |

## Quick Start

### Step 1: Setup Credentials (One-Time)
Run the interactive setup wizard in your terminal:
```bash
npx github:benatcmathew/Shoonya_Trading_MCP-Server --setup
```

This will:
- Ask for your Shoonya broker credentials
- Ask you to set a master password
- Encrypt everything with AES-256-GCM and save to `~/.shoonya-mcp/vault.enc`

### Step 2: Connect to Claude Desktop
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

### Step 3: Start Trading!
In Claude Desktop, simply say:
> *"Login to Shoonya"* → The AI will ask for your master password only.
> *"Buy NIFTY 24500 CE 30"* → Places a market order.
> *"Place auto SL for order 12345 on NIFTY"* → Auto stop-loss.

## CLI Commands

| Command | Description |
|---|---|
| `npx shoonya-mcp-server --setup` | First-time credential setup (interactive wizard) |
| `npx shoonya-mcp-server --edit` | Edit/update stored credentials |
| `npx shoonya-mcp-server --delete` | Securely wipe and delete the vault |
| `npx shoonya-mcp-server --status` | Check if a vault exists |
| `npx shoonya-mcp-server` | Start the MCP server (default, used by Claude) |

## Available MCP Tools

| Tool | Parameters | Description |
|---|---|---|
| `login` | `master_password` | Decrypt vault & login to Shoonya |
| `place_order` | `buy_or_sell`, `command` | Smart order (e.g., `"NIFTY 24500 CE 30 L 110"`) |
| `place_manual_sl` | `command` | Manual SL (e.g., `"NIFTY 24500 CE 30 SL 100"`) |
| `place_auto_sl` | `order_id`, `index` | Auto SL from filled order |
| `modify_order` | `order_id`, `exchange`, `tradingsymbol`, ... | Modify open order |
| `modify_sl` | `order_id`, `exchange`, `tradingsymbol`, ... | Modify SL order |
| `cancel_order` | `order_id` | Cancel any order |
| `exit_order` | `order_id`, `product_type` | Exit position |
| `get_order_book` | — | Fetch order book |
| `check_margin` | — | Fetch available margin |
| `check_order_status` | `order_id` | Check specific order status |

## Manual Build from Source
```bash
git clone https://github.com/benatcmathew/Shoonya_Trading_MCP-Server.git
cd Shoonya_Trading_MCP-Server
npm install
npm run build
npm start
```

## License
ISC
