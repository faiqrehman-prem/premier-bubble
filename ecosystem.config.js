module.exports = {
  apps: [
    {
      name: "bubble",
      script: "dist/server-cli.js",
      args: "--cost",
      cwd: "/var/www/myapp",
      env: {
        NODE_ENV: "production",
        CONFIG_DIR: "/var/www/myapp/config",
        TOOL_CONFIG_DIR: "/var/www/myapp"
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M"
    }
  ]
};
