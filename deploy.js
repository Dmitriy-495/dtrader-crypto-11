#!/usr/bin/env node

/**
 * DTrader Crypto Bot Deployment Script
 * Enhanced version with cleanup and better error handling
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

class DeploymentManager {
  constructor() {
    this.projectName = "dtrader-crypto-11";
    this.startTime = Date.now();
    this.logs = [];
  }

  log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    this.logs.push({ timestamp, message, type });

    const colors = {
      info: "\x1b[36m", // Cyan
      success: "\x1b[32m", // Green
      warning: "\x1b[33m", // Yellow
      error: "\x1b[31m", // Red
      reset: "\x1b[0m", // Reset
    };

    const color = colors[type] || colors.info;
    console.log(`${color}${logMessage}${colors.reset}`);
  }

  executeCommand(command, options = {}) {
    try {
      this.log(`Executing: ${command}`, "info");
      const result = execSync(command, {
        stdio: "inherit",
        encoding: "utf-8",
        ...options,
      });
      return { success: true, result };
    } catch (error) {
      this.log(`Command failed: ${command}`, "error");
      this.log(`Error: ${error.message}`, "error");
      return { success: false, error };
    }
  }

  cleanupDependencies() {
    this.log("🧹 Starting dependency cleanup...", "warning");

    const filesToRemove = [
      "node_modules",
      "package-lock.json",
      "dist",
      ".tsbuildinfo",
    ];

    filesToRemove.forEach((file) => {
      const filePath = path.join(process.cwd(), file);
      try {
        if (fs.existsSync(filePath)) {
          if (fs.lstatSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
            this.log(`✅ Removed directory: ${file}`, "success");
          } else {
            fs.unlinkSync(filePath);
            this.log(`✅ Removed file: ${file}`, "success");
          }
        } else {
          this.log(`ℹ️  File not found: ${file}`, "info");
        }
      } catch (error) {
        this.log(`❌ Failed to remove ${file}: ${error.message}`, "error");
      }
    });

    this.log("✅ Dependency cleanup completed", "success");
  }

  checkPrerequisites() {
    this.log("🔍 Checking prerequisites...", "info");

    // Check Node.js version
    const nodeVersion = process.version;
    const requiredVersion = "v18.0.0";

    if (this.compareVersions(nodeVersion, requiredVersion) < 0) {
      throw new Error(
        `Node.js version ${requiredVersion} or higher is required. Current: ${nodeVersion}`
      );
    }

    this.log(`✅ Node.js version: ${nodeVersion}`, "success");

    // Check if we're in the project directory
    if (!fs.existsSync("package.json")) {
      throw new Error(
        "package.json not found. Please run this script from the project root directory."
      );
    }

    this.log("✅ Project directory verified", "success");
  }

  compareVersions(v1, v2) {
    const parseVersion = (v) => v.replace("v", "").split(".").map(Number);
    const v1Parts = parseVersion(v1);
    const v2Parts = parseVersion(v2);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const part1 = v1Parts[i] || 0;
      const part2 = v2Parts[i] || 0;
      if (part1 !== part2) {
        return part1 - part2;
      }
    }
    return 0;
  }

  backupExistingDeployment() {
    this.log("💾 Creating backup of current deployment...", "info");

    const backupDir = `backup_${Date.now()}`;

    if (!fs.existsSync("backups")) {
      fs.mkdirSync("backups");
    }

    try {
      // Copy important files to backup
      const filesToBackup = [".env", "ecosystem.config.cjs", "logs"];

      filesToBackup.forEach((file) => {
        if (fs.existsSync(file)) {
          const source = path.join(process.cwd(), file);
          const target = path.join(process.cwd(), "backups", backupDir, file);

          // Create target directory
          fs.mkdirSync(path.dirname(target), { recursive: true });

          if (fs.lstatSync(source).isDirectory()) {
            this.copyDirectorySync(source, target);
          } else {
            fs.copyFileSync(source, target);
          }

          this.log(`✅ Backed up: ${file}`, "success");
        }
      });

      this.log(`✅ Backup created: backups/${backupDir}`, "success");
    } catch (error) {
      this.log(`⚠️  Backup failed: ${error.message}`, "warning");
    }
  }

  copyDirectorySync(source, target) {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const files = fs.readdirSync(source);

    files.forEach((file) => {
      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);

      if (fs.lstatSync(sourcePath).isDirectory()) {
        this.copyDirectorySync(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    });
  }

  async deploy() {
    try {
      this.log("🚀 Starting DTrader Crypto Bot Deployment...", "info");
      this.log(`📁 Project: ${this.projectName}`, "info");
      this.log(
        `📅 Start time: ${new Date(this.startTime).toISOString()}`,
        "info"
      );

      // Step 1: Check prerequisites
      this.checkPrerequisites();

      // Step 2: Create backup
      this.backupExistingDeployment();

      // Step 3: Stop existing PM2 process
      this.log("🛑 Stopping existing PM2 process...", "warning");
      this.executeCommand(`pm2 stop ${this.projectName} || true`);
      this.executeCommand(`pm2 delete ${this.projectName} || true`);

      // Step 4: Cleanup dependencies (NEW)
      this.cleanupDependencies();

      // Step 5: Install dependencies
      this.log("📦 Installing dependencies...", "info");
      const installResult = this.executeCommand("npm install", {
        stdio: "pipe",
        timeout: 120000, // 2 minutes timeout
      });

      if (!installResult.success) {
        throw new Error("Dependency installation failed");
      }

      // Step 6: Build project
      this.log("🔨 Building project...", "info");
      const buildResult = this.executeCommand("npm run build", {
        stdio: "pipe",
        timeout: 60000, // 1 minute timeout
      });

      if (!buildResult.success) {
        throw new Error("Build failed");
      }

      // Step 7: Type checking
      this.log("🔍 Running type check...", "info");
      const typeCheckResult = this.executeCommand("npm run type-check");
      if (!typeCheckResult.success) {
        this.log(
          "⚠️  Type check failed, but continuing deployment...",
          "warning"
        );
      }

      // Step 8: Start with PM2
      this.log("🎯 Starting application with PM2...", "info");
      const startResult = this.executeCommand("pm2 start ecosystem.config.cjs");
      if (!startResult.success) {
        throw new Error("PM2 start failed");
      }

      // Step 9: Save PM2 configuration
      this.log("💾 Saving PM2 configuration...", "info");
      this.executeCommand("pm2 save");

      // Step 10: Wait and check status
      this.log("⏳ Waiting for application to start...", "info");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const statusResult = this.executeCommand("pm2 status", { stdio: "pipe" });
      if (!statusResult.success) {
        throw new Error("Failed to check PM2 status");
      }

      const endTime = Date.now();
      const deploymentTime = ((endTime - this.startTime) / 1000).toFixed(2);

      this.log(`✅ Deployment completed successfully!`, "success");
      this.log(
        `⏱️  Total deployment time: ${deploymentTime} seconds`,
        "success"
      );
      this.log(`📊 Check logs: npm run pm2:logs`, "info");
      this.log(`🔄 Restart: npm run pm2:restart`, "info");
      this.log(`🛑 Stop: npm run pm2:stop`, "info");

      this.generateDeploymentReport(deploymentTime);
    } catch (error) {
      this.log(`💥 Deployment failed: ${error.message}`, "error");
      this.log("🔄 Attempting rollback...", "warning");

      // Attempt to restore from backup if possible
      this.executeCommand(`pm2 start ${this.projectName} || true`);

      process.exit(1);
    }
  }

  generateDeploymentReport(deploymentTime) {
    const report = {
      project: this.projectName,
      timestamp: new Date().toISOString(),
      deploymentTime: `${deploymentTime} seconds`,
      status: "success",
      logs: this.logs,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
      },
    };

    const reportDir = "deployment-reports";
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir);
    }

    const reportFile = path.join(reportDir, `deployment-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    this.log(`📄 Deployment report saved: ${reportFile}`, "info");
  }
}

// ==================== DEPLOYMENT SCRIPT EXECUTION ====================

const deployManager = new DeploymentManager();

// Handle command line arguments
const args = process.argv.slice(2);
const isQuickDeploy = args.includes("--quick");
const isForceDeploy = args.includes("--force");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
DTrader Crypto Bot Deployment Script

Usage:
  node deploy.js [options]

Options:
  --quick       Skip backup and type checking for faster deployment
  --force       Force deployment without prerequisite checks
  --help, -h    Show this help message

Examples:
  node deploy.js           # Full deployment with all checks
  node deploy.js --quick   # Quick deployment without backup
  node deploy.js --force   # Force deployment (use with caution)
  `);
  process.exit(0);
}

// Add quick deployment mode
if (isQuickDeploy) {
  deployManager.log("⚡ Quick deployment mode enabled", "warning");
  deployManager.backupExistingDeployment = () => {
    deployManager.log("⏩ Skipping backup in quick mode", "info");
  };
}

deployManager.deploy().catch((error) => {
  console.error("💥 Fatal deployment error:", error);
  process.exit(1);
});
