#!/usr/bin/env node

/**
 * DTrader Crypto Bot Deployment Script
 * Minimal version with cleanup
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🚀 Starting DTrader Crypto Bot Deployment...");

try {
  // Шаг 1: Остановка PM2 процесса
  console.log("🛑 Stopping PM2 process...");
  try {
    execSync("pm2 stop dtrader-crypto-11", { stdio: "inherit" });
  } catch (e) {}
  try {
    execSync("pm2 delete dtrader-crypto-11", { stdio: "inherit" });
  } catch (e) {}

  // Шаг 2: Очистка зависимостей
  console.log("🧹 Cleaning dependencies...");
  const filesToRemove = ["node_modules", "package-lock.json", "dist"];

  filesToRemove.forEach((file) => {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      if (fs.lstatSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      console.log(`✅ Removed: ${file}`);
    }
  });

  // Шаг 3: Установка зависимостей
  console.log("📦 Installing dependencies...");
  execSync("npm install", { stdio: "inherit" });

  // Шаг 4: Сборка проекта
  console.log("🔨 Building project...");
  execSync("npm run build", { stdio: "inherit" });

  // Шаг 5: Запуск через PM2
  console.log("🎯 Starting with PM2...");
  execSync("pm2 start ecosystem.config.cjs", { stdio: "inherit" });
  execSync("pm2 save", { stdio: "inherit" });

  console.log("✅ Deployment completed successfully!");
  console.log("📊 Check status: npm run pm2:status");
  console.log("📋 Check logs: npm run pm2:logs");
} catch (error) {
  console.error("💥 Deployment failed:", error.message);
  process.exit(1);
}
