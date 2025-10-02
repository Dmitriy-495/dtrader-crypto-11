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
      error_file: "./logs/error.log",
      out_file: "./logs/output.log",
      log_file: "./logs/combined.log",
      time: true,
    },
  ],
};
