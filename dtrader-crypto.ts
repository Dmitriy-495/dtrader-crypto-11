#!/usr/bin/env node

/**
 * DTrader Crypto 11.0.1
 * Gate.io WebSocket Client
 * Ping-pong and balance subscription with authentication
 * WITH AUTO-RECONNECT
 */

import { WebSocket } from "ws";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

// ==================== GATE.IO WEBSOCKET CLIENT ====================

class GateIoWebSocketClient {
  private ws: WebSocket | null = null;
  private baseURL: string = "wss://api.gateio.ws/ws/v4/";
  private isConnected: boolean = false;
  private isAuthenticated: boolean = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private balanceInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectInterval: ReturnType<typeof setInterval> | null = null;
  private requestId: number = 1;
  private pendingRequests: Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timestamp: number;
    }
  > = new Map();
  private connectionPromise: Promise<void> | null = null;
  private apiKey: string;
  private apiSecret: string;

  // Auto-reconnect properties
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private isReconnecting: boolean = false;
  private lastConnectionTime: number = 0;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.connectionPromise = this.connect();
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isReconnecting) {
        console.log(
          `🔄 [Attempt ${this.reconnectAttempts + 1}/${
            this.maxReconnectAttempts
          }] Reconnecting to Gate.io...`
        );
      } else {
        console.log("🔌 Connecting to Gate.io WebSocket...");
      }

      this.ws = new WebSocket(this.baseURL);

      const connectionTimeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        this.scheduleReconnect();
      }, 10000);

      this.ws.on("open", async () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.lastConnectionTime = Date.now();

        console.log("✅ Connected to Gate.io WebSocket");

        if (this.reconnectAttempts > 0) {
          console.log("🎉 Reconnection successful!");
        }

        try {
          await this.delay(3000);
          this.startPingInterval();
          this.startBalanceInterval();
          resolve();
        } catch (error) {
          reject(error);
          this.scheduleReconnect();
        }
      });

      this.ws.on("message", (data: { toString: () => string }) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error("❌ Error parsing WebSocket message:", error);
        }
      });

      this.ws.on("close", (code: number, reason: string) => {
        clearTimeout(connectionTimeout);
        console.log(
          `🔌 Disconnected from Gate.io WebSocket. Code: ${code}, Reason: ${reason}`
        );
        this.handleDisconnection();
      });

      this.ws.on("error", (error: Error) => {
        clearTimeout(connectionTimeout);
        console.error("❌ WebSocket error:", error);
        this.handleDisconnection();
        reject(error);
      });
    });
  }

  private handleDisconnection(): void {
    this.isConnected = false;
    this.isAuthenticated = false;
    this.stopIntervals();
    this.rejectAllPendingRequests(new Error("Connection lost"));

    if (!this.isReconnecting) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (
      this.isReconnecting ||
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(
      `⏰ Scheduled reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectInterval = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error(
          `❌ Reconnection attempt ${this.reconnectAttempts} failed:`,
          error
        );
        this.scheduleReconnect();
      }
    }, delay);
  }

  private handleMessage(message: any): void {
    console.log("📨 RAW MESSAGE:", JSON.stringify(message));

    // ✅ Обрабатываем PONG от Gate.io (ответ на наш PING)
    if (
      message.id &&
      this.pendingRequests.has(message.id) &&
      message.result === "pong"
    ) {
      const pendingRequest = this.pendingRequests.get(message.id);
      if (pendingRequest) {
        const latency = Date.now() - pendingRequest.timestamp;
        console.log(`🏓 Received PONG from Gate.io, latency: ${latency}ms`);
        pendingRequest.resolve({ latency, timestamp: Date.now() });
        this.pendingRequests.delete(message.id);
      }
      return;
    }

    // Обрабатываем ответы с id (ошибки и другие ответы)
    if (message.id && this.pendingRequests.has(message.id)) {
      const pendingRequest = this.pendingRequests.get(message.id)!;

      if (message.error) {
        console.error("❌ Request error:", message.error);
        pendingRequest.reject(new Error(`API Error: ${message.error.message}`));
      } else {
        console.log("✅ Request successful");
        pendingRequest.resolve(message.result);
      }

      this.pendingRequests.delete(message.id);
      return;
    }

    // Обрабатываем обновления баланса (Spot Balance Channel)
    if (message.channel === "spot.balances" && message.event === "update") {
      console.log("💰 Balance update received");
      this.handleBalanceUpdate(message.result);
      return;
    }

    // Обрабатываем ответы на подписку баланса
    if (message.channel === "spot.balances" && message.event === "subscribe") {
      if (message.error) {
        console.error("❌ Balance subscription error:", message.error);
        this.isAuthenticated = false;

        if (message.error.code === 1) {
          console.error(
            "💥 Authentication error - check API keys. Stopping reconnection attempts."
          );
          this.stopReconnection();
        }
      } else {
        console.log("✅ Balance subscription successful");
        this.isAuthenticated = true;
      }
      return;
    }

    // ✅ Обрабатываем PING от сервера (редкий случай)
    if (message.method === "server.ping" && message.id) {
      console.log("🏓 Received PING from server, sending PONG...");
      this.sendPong(message.id);
      return;
    }
  }

  private handleBalanceUpdate(balanceData: any): void {
    try {
      console.log("💰 Raw balance data:", JSON.stringify(balanceData));

      if (Array.isArray(balanceData)) {
        const usdtBalance = balanceData.find(
          (item: any) => item.currency === "USDT"
        );

        if (usdtBalance) {
          const available = parseFloat(usdtBalance.available || "0");
          const locked = parseFloat(usdtBalance.locked || "0");
          const total = available + locked;

          console.log(
            `💰 USDT Balance: ${available.toFixed(
              6
            )} available, ${locked.toFixed(6)} locked, ${total.toFixed(
              6
            )} total`
          );

          if (usdtBalance.change_type) {
            console.log(`   Change type: ${usdtBalance.change_type}`);
          }
        } else {
          console.log("💰 USDT balance not found in response");
          const currencies = balanceData
            .map((item: any) => item.currency)
            .join(", ");
          console.log(`   Available currencies: ${currencies}`);
        }
      } else {
        console.log("💰 Unexpected balance data format:", typeof balanceData);
      }
    } catch (error) {
      console.error("❌ Error processing balance update:", error);
    }
  }

  private generateSignature(
    channel: string,
    event: string,
    timestamp: number
  ): string {
    const message = `channel=${channel}&event=${event}&time=${timestamp}`;
    return crypto
      .createHmac("sha512", this.apiSecret)
      .update(message)
      .digest("hex");
  }

  private async subscribeToBalances(): Promise<void> {
    if (!this.isConnected || !this.ws) {
      console.log("⏸️  WebSocket not connected, skipping balance subscription");
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.generateSignature(
      "spot.balances",
      "subscribe",
      timestamp
    );

    const balanceMessage = {
      time: timestamp,
      channel: "spot.balances",
      event: "subscribe",
      payload: [],
      auth: {
        method: "api_key",
        KEY: this.apiKey,
        SIGN: signature,
      },
    };

    try {
      this.ws.send(JSON.stringify(balanceMessage));
      console.log("📊 Subscribing to balance updates...");
    } catch (error) {
      console.error("❌ Error subscribing to balances:", error);
      throw error;
    }
  }

  private startPingInterval(): void {
    // Отправляем первый ping
    this.sendPing().catch(console.error);

    // Затем каждые 30 секунд
    this.pingInterval = setInterval(async () => {
      if (this.isConnected && this.ws) {
        try {
          await this.sendPing();
        } catch (error) {
          console.error("❌ Error in ping interval:", error);
        }
      }
    }, 30000);
  }

  private startBalanceInterval(): void {
    // Первая подписка на баланс через 5 секунд после подключения
    setTimeout(async () => {
      try {
        await this.subscribeToBalances();
      } catch (error) {
        console.error("❌ Failed initial balance subscription:", error);
      }
    }, 5000);

    // Обновляем подписку каждые 30 секунд
    this.balanceInterval = setInterval(async () => {
      if (this.isConnected && this.ws && this.isAuthenticated) {
        try {
          const timeSinceLastUpdate = Date.now() - this.lastConnectionTime;
          if (timeSinceLastUpdate > 120000) {
            console.log("🔄 Refreshing balance subscription...");
            await this.subscribeToBalances();
          }
        } catch (error) {
          console.error("❌ Error refreshing balance subscription:", error);
        }
      }
    }, 30000);
  }

  private stopIntervals(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.balanceInterval) {
      clearInterval(this.balanceInterval);
      this.balanceInterval = null;
    }
  }

  private stopReconnection(): void {
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = this.maxReconnectAttempts;
  }

  private async sendPing(): Promise<{ latency: number; timestamp: number }> {
    if (!this.isConnected || !this.ws) {
      throw new Error("WebSocket not connected");
    }

    // ✅ Правильный формат ping для Gate.io v4 API
    const pingMessage = {
      id: this.requestId,
      method: "server.ping",
      params: [],
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(this.requestId, {
        resolve,
        reject,
        timestamp: Date.now(),
      });

      try {
        this.ws!.send(JSON.stringify(pingMessage));
        console.log("📡 Sent PING to Gate.io, ID:", pingMessage.id);

        setTimeout(() => {
          if (this.pendingRequests.has(this.requestId)) {
            this.pendingRequests.delete(this.requestId);
            reject(new Error(`PONG timeout for ID: ${this.requestId}`));
          }
        }, 10000);

        this.requestId++;
      } catch (error) {
        this.pendingRequests.delete(this.requestId);
        reject(error);
      }
    });
  }

  // ✅ Метод для отправки PONG (если сервер инициирует ping)
  private sendPong(pingId: number): void {
    if (!this.isConnected || !this.ws) {
      console.log("⏸️ WebSocket not connected, cannot send PONG");
      return;
    }

    const pongMessage = {
      id: pingId,
      result: "pong",
    };

    try {
      this.ws.send(JSON.stringify(pongMessage));
      console.log(`📡 Sent PONG to server, ID: ${pingId}`);
    } catch (error) {
      console.error("❌ Error sending PONG:", error);
    }
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const [id, request] of this.pendingRequests) {
      request.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async waitForConnection(): Promise<void> {
    if (this.connectionPromise) {
      await this.connectionPromise;
    }
  }

  public getConnectionStatus(): {
    connected: boolean;
    authenticated: boolean;
    reconnecting: boolean;
  } {
    return {
      connected: this.isConnected,
      authenticated: this.isAuthenticated,
      reconnecting: this.isReconnecting,
    };
  }

  public getReconnectStatus(): {
    attempts: number;
    maxAttempts: number;
    reconnecting: boolean;
  } {
    return {
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      reconnecting: this.isReconnecting,
    };
  }

  public async close(): Promise<void> {
    console.log("🛑 Closing Gate.io WebSocket connection...");
    this.stopIntervals();
    this.stopReconnection();
    this.rejectAllPendingRequests(new Error("Connection closed by user"));

    if (this.ws) {
      return new Promise((resolve) => {
        this.ws!.on("close", () => resolve());
        this.ws!.close();
      });
    }
  }
}

// ==================== TRADING BOT ====================

class TradingBot {
  private gateIoClient: GateIoWebSocketClient;
  private isRunning: boolean = false;
  private statusInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // ✅ Правильный доступ к process.env
    const apiKey = process.env["GATEIO_API_KEY"];
    const apiSecret = process.env["GATEIO_API_SECRET"];

    if (!apiKey || !apiSecret) {
      throw new Error(
        "❌ Missing GATEIO_API_KEY or GATEIO_API_SECRET in environment variables"
      );
    }

    console.log("🔑 API Key found:", apiKey.substring(0, 8) + "...");
    this.gateIoClient = new GateIoWebSocketClient(apiKey, apiSecret);
  }

  async start(): Promise<void> {
    try {
      console.log("🚀 Starting DTrader Crypto Bot...");
      await this.gateIoClient.waitForConnection();

      console.log("🎯 DTrader Crypto Bot is running");
      console.log("   - Mode: Gate.io WebSocket with Balance Subscription");
      console.log("   - Ping interval: 30 seconds");
      console.log("   - Balance updates: 30 seconds");
      console.log("   - Auto-reconnect: Enabled (max 10 attempts)");
      console.log("   - URL: wss://api.gateio.ws/ws/v4/");

      this.isRunning = true;
      this.startStatusMonitoring();
    } catch (error) {
      console.error("❌ Failed to start bot:", error);
      throw error;
    }
  }

  private startStatusMonitoring(): void {
    this.statusInterval = setInterval(() => {
      if (!this.isRunning) {
        if (this.statusInterval) {
          clearInterval(this.statusInterval);
          this.statusInterval = null;
        }
        return;
      }

      try {
        const status = this.gateIoClient.getConnectionStatus();
        const reconnectStatus = this.gateIoClient.getReconnectStatus();

        console.log(
          `📊 Status: ${
            status.connected ? "✅ Connected" : "❌ Disconnected"
          }, Auth: ${
            status.authenticated ? "✅ Authenticated" : "❌ Not authenticated"
          }, Reconnecting: ${status.reconnecting ? "🔄 Yes" : "✅ No"}`
        );

        if (reconnectStatus.reconnecting) {
          console.log(
            `   🔄 Reconnect progress: ${reconnectStatus.attempts}/${reconnectStatus.maxAttempts}`
          );
        }
      } catch (error) {
        console.error("❌ Error in status monitoring:", error);
      }
    }, 30000);
  }

  async shutdown(): Promise<void> {
    console.log("\n🛑 Shutting down...");
    this.isRunning = false;

    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    try {
      await this.gateIoClient.close();
      console.log("✅ Bot shut down successfully");
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      throw error;
    }
  }
}

// ==================== APPLICATION ====================

class Application {
  private bot: TradingBot;

  constructor() {
    this.bot = new TradingBot();
  }

  async run(): Promise<void> {
    try {
      await this.bot.start();
    } catch (error) {
      console.error("💥 Application failed to start:", error);
      process.exit(1);
    }
  }

  async gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n📢 Received ${signal}, starting graceful shutdown...`);

    try {
      await this.bot.shutdown();
      process.exit(0);
    } catch (error) {
      console.error("💥 Error during graceful shutdown:", error);
      process.exit(1);
    }
  }
}

// ==================== APPLICATION STARTUP ====================

const app = new Application();

process.on("SIGINT", () => app.gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => app.gracefulShutdown("SIGTERM"));

process.on("uncaughtException", async (error) => {
  console.error("💥 Uncaught Exception:", error);
  await app.gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
  await app.gracefulShutdown("unhandledRejection");
});

app.run().catch(async (error) => {
  console.error("💥 Application crash:", error);
  await app.gracefulShutdown("startupError");
});
