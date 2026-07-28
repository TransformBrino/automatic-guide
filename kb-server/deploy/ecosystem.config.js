// kb-server PM2 进程守护配置
// 启动：pm2 start ecosystem.config.js
// 保存：pm2 save
// 开机自启：pm2 startup

module.exports = {
  apps: [{
    name: 'kb-server',
    script: 'server.js',
    cwd: 'C:\\Users\\wangt\\Documents\\trae_projects\\Transform_Ai\\kb-server',
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
