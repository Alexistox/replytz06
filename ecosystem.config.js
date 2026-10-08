module.exports = {
  apps: [{
    name: 'bank-transaction-bot',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production'
    },
    // Logging
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Advanced options
    kill_timeout: 5000,
    listen_timeout: 10000,
    
    // Cron restart (optional - restart daily at 3 AM)
    // cron_restart: '0 3 * * *',
    
    // Auto-restart when files change (disable in production)
    ignore_watch: [
      'node_modules',
      'logs',
      '*.session*',
      'bot.pid',
      'settings.json'
    ],
    
    // Instance variables
    instance_var: 'INSTANCE_ID',
    
    // Merge logs from all instances
    merge_logs: true,
    
    // Source map support
    source_map_support: false,
    
    // Node.js options
    node_args: ['--max-old-space-size=512', '--env-file=.env']
  }],

  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'https://github.com/Alexistox/reply01.git',
      path: '/home/ubuntu/reply01',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
}; 