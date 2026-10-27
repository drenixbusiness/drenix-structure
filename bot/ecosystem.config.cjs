// PM2: pm2 start ecosystem.config.cjs && pm2 save && pm2 startup   (24/7: restarts on crash and after reboot)
module.exports = {
  apps: [
    {
      name: "drenix-assistant",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1, // must stay 1: Telegram polling allows a single consumer
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 1000, // keep retrying through long internet/Telegram outages
      exp_backoff_restart_delay: 2000, // 2s, 4s, 8s … up to ~15s between attempts; resets once it runs stably
      kill_timeout: 10000, // time for a clean shutdown (scheduler, DB) on restart/deploy
      max_memory_restart: "500M", // PDF/Word rendering needs some headroom
      env: { NODE_ENV: "production" },
      out_file: "./data/logs/out.log",
      error_file: "./data/logs/error.log",
      time: true,
    },
  ],
};
