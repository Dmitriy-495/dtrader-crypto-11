#!/usr/bin/env node

/**
 * DTrader Crypto 11.0.1
 * Gate.io WebSocket Client
 * Ping-pong with Gate.io exchange
 */

import { WebSocket } from "ws";
import * as dotenv from "dotenv";

dotenv.config();

// ==================== GATE.IO WEBSOCKET CLIENT ====================

class GateIoWebSocketClient {
  private ws: WebSocket | null = null;
  private baseURL: string = "wss://ws.gate.io/v4/";
  private isConnected: boolean = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastPingTime: number = 0;
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

  constructor() {
    this.connectionPromise = this.connect();
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("🔌 Connecting to Gate.io WebSocket...");

      this.ws = new WebSocket(this.baseURL);

      const connectionTimeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      this.ws.on("open", async () => {
        clearTimeout(connectionTimeout);
        console.log("✅ Connected to Gate.io WebSocket");
        this.isConnected = true;

        try {
          // Ждем немного перед первым ping
          await this.delay(3000);

          // Запускаем ping каждые 15 секунд
          this.startPingInterval();

          resolve();
        } catch (error) {
          reject(error);
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
        this.isConnected = false;
        this.stopPingInterval();
        this.rejectAllPendingRequests(
          new Error(`Connection closed: ${reason}`)
        );
      });

      this.ws.on("error", (error: Error) => {
        clearTimeout(connectionTimeout);
        console.error("❌ WebSocket error:", error);
        this.isConnected = false;
        reject(error);
      });
    });
  }

  private handleMessage(message: any): void {
    // Обрабатываем pong от Gate.io
    if (message.result === "pong" && message.id) {
      const pendingRequest = this.pendingRequests.get(message.id);
      if (pendingRequest) {
        const latency = Date.now() - pendingRequest.timestamp;
        console.log(`🏓 Received PONG from Gate.io, latency: ${latency}ms`);
        pendingRequest.resolve({ latency, timestamp: Date.now() });
        this.pendingRequests.delete(message.id);
      }
      return;
    }

    // Обрабатываем ответы с id
    if (message.id && this.pendingRequests.has(message.id)) {
      const pendingRequest = this.pendingRequests.get(message.id)!;

      if (message.error) {
        pendingRequest.reject(new Error(`API Error: ${message.error.message}`));
      } else {
        pendingRequest.resolve(message.result);
      }

      this.pendingRequests.delete(message.id);
      return;
    }

    // Логируем неизвестные сообщения
    if (message.method && message.method !== "server.ping") {
      console.log("📨 Received message:", JSON.stringify(message));
    }
  }

  private startPingInterval(): void {
    // Первый ping через 3 секунды после подключения
    setTimeout(() => {
      this.sendPing();
    }, 3000);

    // Затем каждые 15 секунд
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws) {
        this.sendPing();
      }
    }, 15000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private async sendPing(): Promise<{ latency: number; timestamp: number }> {
    if (!this.isConnected || !this.ws) {
      throw new Error("WebSocket not connected");
    }

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

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  public async close(): Promise<void> {
    console.log("🛑 Closing Gate.io WebSocket connection...");
    this.stopPingInterval();
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

  constructor() {
    this.gateIoClient = new GateIoWebSocketClient();
  }

  async start(): Promise<void> {
    try {
      console.log("🚀 Starting DTrader Crypto Bot...");

      // Ждем подключения к WebSocket
      await this.gateIoClient.waitForConnection();

      console.log("🎯 DTrader Crypto Bot is running");
      console.log("   - Mode: Gate.io WebSocket Ping-Pong");
      console.log("   - Ping interval: 15 seconds");
      console.log("   - URL: wss://ws.gate.io/v4/");

      this.isRunning = true;

      // Запускаем мониторинг статуса
      this.startStatusMonitoring();
    } catch (error) {
      console.error("❌ Failed to start bot:", error);
      throw error;
    }
  }

  private async startStatusMonitoring(): Promise<void> {
    while (this.isRunning) {
      try {
        const status = this.gateIoClient.getConnectionStatus();
        console.log(
          `📊 Connection status: ${status ? "✅ Connected" : "❌ Disconnected"}`
        );

        await this.delay(30000);
      } catch (error) {
        console.error("❌ Error in status monitoring:", error);
        await this.delay(5000);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    console.log("\n🛑 Shutting down...");
    this.isRunning = false;

    try {
      await this.gateIoClient.close();
      console.log("✅ Bot shut down successfully");
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      throw error;
    }
  }
}

// ==================== ЗАПУСК ПРИЛОЖЕНИЯ ====================

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

// ==================== ЗАПУСК ПРИЛОЖЕНИЯ ====================

const app = new Application();

// Graceful shutdown handlers
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

// Запуск приложения
app.run().catch(async (error) => {
  console.error("💥 Application crash:", error);
  await app.gracefulShutdown("startupError");
});
