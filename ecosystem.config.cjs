module.exports = {
  apps: [
    {
      name: "dtrader-crypto-11",
      script: "./dist/dtrader-crypto.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
      },
      error_file: "./logs/error.log",
      out_file: "./logs/output.log",
      log_file: "./logs/combined.log",
      time: true,
      listen_timeout: 10000,
      kill_timeout: 5000,

      // ✅ PM2 hooks for build management
      post_update: "npm install && npm run build",
      pre_start: "npm run build",
    },
  ],
};
