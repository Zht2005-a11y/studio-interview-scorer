module.exports = {
  apps: [{
    name: 'scorer',
    script: 'server.js',
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 18080
    }
  }]
};
