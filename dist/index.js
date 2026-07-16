#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ShoonyaClient } from "./ShoonyaClient.js";
import { vaultExists, loadCredentials, deleteVault, interactiveSetup } from "./SecureVault.js";
// ──────────────────────────────────────────────────────────
// CLI Mode: Handle --setup, --edit, --delete before MCP
// ──────────────────────────────────────────────────────────
const cliArg = process.argv[2];
if (cliArg === '--setup' || cliArg === '--edit') {
    interactiveSetup().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
else if (cliArg === '--delete') {
    if (deleteVault()) {
        console.log('🗑️  Vault securely wiped and deleted.');
    }
    else {
        console.log('No vault found.');
    }
    process.exit(0);
}
else if (cliArg === '--status') {
    if (vaultExists()) {
        console.log('✅ Credential vault exists at ~/.shoonya-mcp/vault.enc');
    }
    else {
        console.log('❌ No credential vault found. Run: npx shoonya-mcp-server --setup');
    }
    process.exit(0);
}
else {
    // ──────────────────────────────────────────────────────────
    // MCP Server Mode (default)
    // ──────────────────────────────────────────────────────────
    startMCPServer();
}
function startMCPServer() {
    const client = new ShoonyaClient();
    const server = new Server({
        name: "shoonya-mcp",
        version: "1.0.0",
    }, {
        capabilities: {
            tools: {},
        },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: "login",
                    description: "Securely login to Shoonya using encrypted credentials from the local vault. The AI never sees passwords. Requires the master_password to decrypt the vault.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            master_password: { type: "string", description: "Master password to decrypt the credential vault" },
                        },
                        required: ["master_password"],
                    },
                },
                {
                    name: "place_order",
                    description: "Place a standard order (Market/Limit) using a command string like 'NIFTY 24500 CE 30 L 110'",
                    inputSchema: {
                        type: "object",
                        properties: {
                            buy_or_sell: { type: "string", description: "'B' or 'S'" },
                            command: { type: "string", description: "Smart order string" },
                        },
                        required: ["buy_or_sell", "command"],
                    },
                },
                {
                    name: "place_manual_sl",
                    description: "Place a manual Stop Loss order using a string command like 'NIFTY 24500 CE 30 SL 100'",
                    inputSchema: {
                        type: "object",
                        properties: {
                            command: { type: "string", description: "Smart order string" },
                        },
                        required: ["command"],
                    },
                },
                {
                    name: "place_auto_sl",
                    description: "Automatically fetch avg buy price of a filled order and place an auto SL-LMT order based on index specific offset.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            order_id: { type: "string" },
                            index: { type: "string" },
                        },
                        required: ["order_id", "index"],
                    },
                },
                {
                    name: "modify_order",
                    description: "Modify an existing open order.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            order_id: { type: "string" },
                            exchange: { type: "string" },
                            tradingsymbol: { type: "string" },
                            quantity: { type: "number" },
                            price_type: { type: "string" },
                            price: { type: "number" },
                        },
                        required: ["order_id", "exchange", "tradingsymbol"],
                    },
                },
                {
                    name: "modify_sl",
                    description: "Modify an existing Stop Loss order.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            order_id: { type: "string" },
                            exchange: { type: "string" },
                            tradingsymbol: { type: "string" },
                            quantity: { type: "number" },
                            price_type: { type: "string" },
                            price: { type: "number" },
                            trigger_price: { type: "number" },
                        },
                        required: ["order_id", "exchange", "tradingsymbol"],
                    },
                },
                {
                    name: "cancel_order",
                    description: "Cancel any open order (including SL).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            order_id: { type: "string" },
                        },
                        required: ["order_id"],
                    },
                },
                {
                    name: "exit_order",
                    description: "Exit an open position by placing an opposite market order.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            order_id: { type: "string" },
                            product_type: { type: "string" },
                        },
                        required: ["order_id", "product_type"],
                    },
                },
                {
                    name: "get_order_book",
                    description: "Fetch the user's order book.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                },
                {
                    name: "check_margin",
                    description: "Fetch the available margin (cash + payin + payout - marginused).",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                },
                {
                    name: "check_order_status",
                    description: "Fetch the status of a specific order from the order book.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            order_id: { type: "string" },
                        },
                        required: ["order_id"],
                    },
                },
            ],
        };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            let result;
            switch (name) {
                case "login": {
                    const masterPwd = args.master_password;
                    if (!vaultExists()) {
                        result = { status: "error", message: "No credential vault found. Run 'npx shoonya-mcp-server --setup' in your terminal first to securely store your credentials." };
                        break;
                    }
                    try {
                        const creds = loadCredentials(masterPwd);
                        result = await client.loginFromVault(creds);
                    }
                    catch (e) {
                        result = { status: "error", message: e.message };
                    }
                    break;
                }
                case "place_order":
                    result = await client.placeOrder(args.buy_or_sell, args.command);
                    break;
                case "place_manual_sl":
                    result = await client.placeManualSl(args.command);
                    break;
                case "place_auto_sl":
                    result = await client.placeAutoSl(args.order_id, args.index);
                    break;
                case "modify_order":
                    result = await client.modifyOrder(args.order_id, args.exchange, args.tradingsymbol, args.quantity, args.price_type, args.price);
                    break;
                case "modify_sl":
                    result = await client.modifyOrder(args.order_id, args.exchange, args.tradingsymbol, args.quantity, args.price_type, args.price, args.trigger_price);
                    break;
                case "cancel_order":
                    result = await client.cancelOrder(args.order_id);
                    break;
                case "exit_order":
                    result = await client.exitOrder(args.order_id, args.product_type);
                    break;
                case "get_order_book":
                    result = await client.getOrderBook();
                    break;
                case "check_margin":
                    result = await client.getMargin();
                    break;
                case "check_order_status":
                    result = await client.getOrderStatus(args.order_id);
                    break;
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    });
    async function main() {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Shoonya MCP Server running on stdio (Secure Vault Mode)");
    }
    main().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
