import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { MockExchangeEngine } from "../lib/exchange/engine";

const server = new McpServer({
  name: "market-snapshot-server",
  version: "1.0.0",
});

const engine = new MockExchangeEngine();

server.tool(
  "get_market_snapshot",
  "Get current deterministic market prices for BTC, ETH, and SOL",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          BTC: engine.getPrice("BTC"),
          ETH: engine.getPrice("ETH"),
          SOL: engine.getPrice("SOL"),
        }),
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});