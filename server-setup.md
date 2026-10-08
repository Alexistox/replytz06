na# 🖥️ Server Setup Guide - Bank Transaction UserBot

## 📋 **System Requirements**

### **Minimum:**
- **CPU:** 1 core, 1 GHz
- **RAM:** 512 MB
- **Storage:** 1 GB free space
- **Network:** Stable internet connection
- **OS:** Linux/Windows/macOS

### **Recommended:**
- **CPU:** 2+ cores
- **RAM:** 1+ GB  
- **Storage:** 2+ GB free space
- **OS:** Ubuntu 20.04+ LTS

## 🛠️ **Installation Steps**

### **Step 1: Install Node.js**

#### **Ubuntu/Debian:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x
```

#### **CentOS/RHEL/Fedora:**
```bash
# Install Node.js
sudo dnf install -y nodejs npm

# Or using NodeSource repo
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs
```

#### **Windows Server:**
```powershell
# Download and install from nodejs.org
# Or use chocolatey
choco install nodejs
```

### **Step 2: Install Git**
```bash
# Ubuntu/Debian
sudo apt install git -y

# CentOS/RHEL
sudo dnf install git -y

# Verify
git --version
```

### **Step 3: Clone & Setup Bot**
```bash
# Clone repository
git clone https://github.com/Alexistox/reply01.git
cd reply01

# Install dependencies
npm install

# Copy config template
cp config.example.js config.js

# Edit config (see configuration section below)
nano config.js
```

### **Step 4: Configure Bot**
Edit `config.js`:
```javascript
module.exports = {
  apiId: 'YOUR_API_ID',        // From my.telegram.org/apps
  apiHash: 'YOUR_API_HASH',    // From my.telegram.org/apps  
  phoneNumber: '+1234567890',  // Your Telegram phone number
  // ... other settings
};
```

### **Step 5: Test Bot**
```bash
# Run tests
npm test
npm run test-duplicate

# First time login
npm start
# Enter verification code when prompted
# Ctrl+C to stop after successful login
```

## 🔄 **Production Deployment**

### **Option 1: PM2 (Recommended)**
```bash
# Install PM2 globally
sudo npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'bank-transaction-bot',
    script: 'index.js',
    cwd: '/path/to/reply01',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Start bot with PM2
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### **Option 2: Systemd Service (Linux)**
```bash
# Create service file
sudo tee /etc/systemd/system/bank-bot.service > /dev/null << EOF
[Unit]
Description=Bank Transaction UserBot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/reply01
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable bank-bot
sudo systemctl start bank-bot

# Check status
sudo systemctl status bank-bot
```

## 🔧 **Server Configuration**

### **Firewall Settings**
```bash
# Ubuntu UFW
sudo ufw allow ssh
sudo ufw allow out 443  # HTTPS for Telegram API
sudo ufw enable

# CentOS Firewalld
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

### **Time Synchronization**
```bash
# Install and configure NTP
sudo apt install ntp -y
sudo systemctl enable ntp
sudo systemctl start ntp

# Check time sync
timedatectl status
```

### **Log Rotation**
```bash
# Create logrotate config
sudo tee /etc/logrotate.d/bank-bot << EOF
/home/ubuntu/reply01/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 ubuntu ubuntu
    postrotate
        pm2 reload bank-transaction-bot
    endscript
}
EOF
```

## 📊 **Monitoring**

### **Basic Monitoring Script**
```bash
#!/bin/bash
# monitor.sh
BOT_STATUS=$(pm2 list | grep bank-transaction-bot | grep online)

if [ -z "$BOT_STATUS" ]; then
    echo "$(date): Bot is down, restarting..." >> /var/log/bot-monitor.log
    pm2 restart bank-transaction-bot
fi
```

```bash
# Add to crontab (check every 5 minutes)
crontab -e
# Add line: */5 * * * * /path/to/monitor.sh
```

### **Resource Usage**
```bash
# Check bot resource usage
pm2 monit

# Check system resources
htop
free -h
df -h
```

## 🔒 **Security Best Practices**

### **1. User Permissions**
```bash
# Create dedicated user
sudo adduser botuser
sudo usermod -aG sudo botuser

# Run bot as non-root user
sudo -u botuser pm2 start ecosystem.config.js
```

### **2. File Permissions**
```bash
# Secure config file
chmod 600 config.js
chown botuser:botuser config.js

# Secure entire directory
chmod -R 755 /path/to/reply01
chown -R botuser:botuser /path/to/reply01
```

### **3. Environment Variables** (Optional)
```bash
# Create .env file
cat > .env << EOF
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
PHONE_NUMBER=your_phone
EOF

chmod 600 .env
```

## 🚨 **Troubleshooting**

### **Common Issues:**

1. **Permission Denied:**
```bash
sudo chown -R $USER:$USER /path/to/reply01
chmod +x run.bat stop.bat push.bat
```

2. **Port Issues:**
```bash
# Check if any service blocking
sudo netstat -tulnp | grep :443
```

3. **Memory Issues:**
```bash
# Monitor memory usage
free -h
pm2 monit

# Restart if needed
pm2 restart bank-transaction-bot
```

4. **Session Issues:**
```bash
# Delete old session and re-login
rm -f *.session*
npm start  # Re-enter phone verification
```

## ✅ **Verification**

After setup, verify bot is working:
```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs bank-transaction-bot

# Test bot commands
# Send /help to bot in Telegram
```

## 📞 **Support**

- Check logs: `pm2 logs bank-transaction-bot`
- Monitor: `pm2 monit`  
- Restart: `pm2 restart bank-transaction-bot`
- Stop: `pm2 stop bank-transaction-bot`

---
🎯 **Goal:** Production-ready deployment with monitoring and auto-restart capabilities! 