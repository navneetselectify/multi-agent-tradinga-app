import { db } from "@/lib/db/client";

export interface OrderResult {
  orderId: number;
  status: "EXECUTED" | "CANCELLED";
  reason?: string;
}

export class OrderService {
  /**
   * Executes a trade order atomically in a transaction block.
   * Updates portfolio cash, holdings, and inserts the order record.
   */
  public static async executeTrade(
    symbol: string,
    side: "BUY" | "SELL",
    quantity: number,
    price: number
  ): Promise<OrderResult> {
    const uppercaseSymbol = symbol.toUpperCase();
    const timestamp = new Date().toISOString();

    const tx = await db.transaction("write");

    try {
      if (side === "BUY") {
        // 1. Fetch current cash balance
        const cashRes = await tx.execute("SELECT cash FROM portfolio_state WHERE id = 1");
        const currentCash = cashRes.rows[0]?.cash as number;

        if (currentCash === undefined) {
          throw new Error("Portfolio cash balance is not seeded.");
        }

        const requiredCash = price * quantity;

        // 2. Insufficient funds validation
        if (currentCash < requiredCash) {
          const insertRes = await tx.execute({
            sql: `INSERT INTO orders 
                  (symbol, side, quantity, price, status, cancel_reason, created_at, updated_at) 
                  VALUES (?, 'BUY', ?, ?, 'CANCELLED', 'Insufficient funds', ?, ?)`,
            args: [uppercaseSymbol, quantity, price, timestamp, timestamp],
          });
          
          await tx.commit();
          return {
            orderId: Number(insertRes.lastInsertRowid),
            status: "CANCELLED",
            reason: "Insufficient funds",
          };
        }

        // 3. Execution path: update cash
        const newCash = currentCash - requiredCash;
        await tx.execute({
          sql: "UPDATE portfolio_state SET cash = ?, updated_at = ? WHERE id = 1",
          args: [newCash, timestamp],
        });

        // 4. Execution path: update holdings
        const holdingRes = await tx.execute({
          sql: "SELECT quantity FROM portfolio_holdings WHERE symbol = ?",
          args: [uppercaseSymbol],
        });
        
        const currentQty = holdingRes.rows[0]?.quantity as number || 0;
        const newQty = currentQty + quantity;

        if (currentQty > 0) {
          await tx.execute({
            sql: "UPDATE portfolio_holdings SET quantity = ?, updated_at = ? WHERE symbol = ?",
            args: [newQty, timestamp, uppercaseSymbol],
          });
        } else {
          await tx.execute({
            sql: "INSERT INTO portfolio_holdings (symbol, quantity, updated_at) VALUES (?, ?, ?)",
            args: [uppercaseSymbol, quantity, timestamp],
          });
        }

        // 5. Execution path: record executed order
        const insertRes = await tx.execute({
          sql: `INSERT INTO orders 
                (symbol, side, quantity, price, status, created_at, updated_at) 
                VALUES (?, 'BUY', ?, ?, 'EXECUTED', ?, ?)`,
          args: [uppercaseSymbol, quantity, price, timestamp, timestamp],
        });

        await tx.commit();
        return {
          orderId: Number(insertRes.lastInsertRowid),
          status: "EXECUTED",
        };

      } else {
        // side === 'SELL'
        // 1. Fetch current holdings quantity
        const holdingRes = await tx.execute({
          sql: "SELECT quantity FROM portfolio_holdings WHERE symbol = ?",
          args: [uppercaseSymbol],
        });
        const currentQty = holdingRes.rows[0]?.quantity as number || 0;

        // 2. Insufficient holdings validation
        if (currentQty < quantity) {
          const insertRes = await tx.execute({
            sql: `INSERT INTO orders 
                  (symbol, side, quantity, price, status, cancel_reason, created_at, updated_at) 
                  VALUES (?, 'SELL', ?, ?, 'CANCELLED', 'Insufficient holdings', ?, ?)`,
            args: [uppercaseSymbol, quantity, price, timestamp, timestamp],
          });

          await tx.commit();
          return {
            orderId: Number(insertRes.lastInsertRowid),
            status: "CANCELLED",
            reason: "Insufficient holdings",
          };
        }

        // 3. Execution path: update holdings
        const newQty = currentQty - quantity;
        if (newQty === 0) {
          await tx.execute({
            sql: "DELETE FROM portfolio_holdings WHERE symbol = ?",
            args: [uppercaseSymbol],
          });
        } else {
          await tx.execute({
            sql: "UPDATE portfolio_holdings SET quantity = ?, updated_at = ? WHERE symbol = ?",
            args: [newQty, timestamp, uppercaseSymbol],
          });
        }

        // 4. Execution path: update cash
        const saleCredit = price * quantity;
        const cashRes = await tx.execute("SELECT cash FROM portfolio_state WHERE id = 1");
        const currentCash = cashRes.rows[0]?.cash as number;
        const newCash = currentCash + saleCredit;

        await tx.execute({
          sql: "UPDATE portfolio_state SET cash = ?, updated_at = ? WHERE id = 1",
          args: [newCash, timestamp],
        });

        // 5. Execution path: record executed order
        const insertRes = await tx.execute({
          sql: `INSERT INTO orders 
                (symbol, side, quantity, price, status, created_at, updated_at) 
                VALUES (?, 'SELL', ?, ?, 'EXECUTED', ?, ?)`,
          args: [uppercaseSymbol, quantity, price, timestamp, timestamp],
        });

        await tx.commit();
        return {
          orderId: Number(insertRes.lastInsertRowid),
          status: "EXECUTED",
        };
      }
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }

  /**
   * Batch records generated ticker prices to the market_history table.
   */
  public static async recordTickPrices(prices: Record<string, number>): Promise<void> {
    const timestamp = new Date().toISOString();
    const batch = Object.entries(prices).map(([symbol, price]) => ({
      sql: "INSERT INTO market_history (symbol, price, timestamp) VALUES (?, ?, ?)",
      args: [symbol, price, timestamp],
    }));
    await db.batch(batch, "write");
  }
}
