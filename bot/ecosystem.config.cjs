// PM2: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "drenix-assistant",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1, // must stay 1: Telegram polling allows a single consumer
      exec_mode: "fork",
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
      out_file: "./data/logs/out.log",
      error_file: "./data/logs/error.log",
      time: true,
    },
  ],
};
