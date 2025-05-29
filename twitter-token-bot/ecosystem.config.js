module.exports = {
  apps: [
    {
      name: 'twitter-token-bot',
      script: 'src/app.js',
      cwd: '/home/deployer/pftweetscanner/twitter-token-bot',
      
      // EXACTEMENT la même config que ton .env
      env: {
        NODE_ENV: 'development',      // Exactement comme ton .env
        LOG_LEVEL: 'info',            // Exactement comme ton .env
        BOT_MODE: 'both'              // Exactement comme ton .env
      },
      
      // DÉSACTIVER complètement les logs PM2
      out_file: '/dev/null',          // Pas de logs PM2
      error_file: '/dev/null',        // Pas de logs PM2  
      log_file: '/dev/null',          // Pas de logs PM2
      
      // Utiliser SEULEMENT winston (comme npm start)
      combine_logs: false,
      merge_logs: false,
      
      // Options PM2 minimales
      autorestart: true,
      max_memory_restart: '1G',
      min_uptime: '5s',
      
      // Charger ton .env
      env_file: '.env',
      
      // Pas d'options supplémentaires qui causent du debug
      exec_mode: 'fork',
      instances: 1
    }
  ]
};

