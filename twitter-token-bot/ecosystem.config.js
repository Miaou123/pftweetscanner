module.exports = {
  apps: [
    {
      name: 'twitter-token-bot',
      script: 'src/app.js',
      cwd: '/home/deployer/pftweetscanner/twitter-token-bot',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        BOT_MODE: 'both'
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      env_file: '.env'
    }
  ]
};
