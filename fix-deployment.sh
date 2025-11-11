#!/bin/bash
set -e

KEY_PATH="/Users/sean/.ssh/dhis2sync-key.pem"
EC2_IP="13.60.48.211"
RDS_ENDPOINT="dhis2sync-db.cpakquawkwqx.eu-north-1.rds.amazonaws.com"
DB_PASSWORD="cl!t0R15"
ENCRYPTION_KEY="vwICGnuWigH38Igx+d93X5P0c3XNwrk1dtyGQk7mflM="

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔧 Fixing and completing deployment..."
echo ""

# Test SSH connection
echo "Testing SSH connection..."
if ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ubuntu@${EC2_IP} 'exit' 2>/dev/null; then
    echo -e "${GREEN}✓ SSH connection works!${NC}"
else
    echo "❌ Cannot connect to server. Make sure:"
    echo "   1. EC2 instance is running"
    echo "   2. Security group allows SSH from your IP"
    exit 1
fi

# Setup server (in case it didn't complete)
echo ""
echo "📦 Installing software on server..."

ssh -i "$KEY_PATH" ubuntu@${EC2_IP} 'bash -s' << 'SETUP_EOF'
set -e

# Update system
sudo apt-get update -qq

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker ubuntu
fi

# Install Nginx if not present
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    sudo apt-get install -y nginx
fi

# Install other tools
sudo apt-get install -y git postgresql-client

echo "✓ Server setup complete"
SETUP_EOF

echo -e "${GREEN}✓ Server configured${NC}"

# Deploy application
echo ""
echo "🚀 Deploying application..."

# Create deployment package
TEMP_DIR=$(mktemp -d)
rsync -av --exclude='.git' --exclude='.venv' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.DS_Store' --exclude='node_modules' \
    ./ $TEMP_DIR/ 2>/dev/null

# Create .env file
cat > $TEMP_DIR/.env << ENV_EOF
DATABASE_URL=postgresql+psycopg2://dbadmin:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/dhis2sync
ENCRYPTION_KEY=${ENCRYPTION_KEY}
ENVIRONMENT=production
LOG_LEVEL=info
HOST=0.0.0.0
PORT=8000
ENV_EOF

# Copy to server
echo "Copying files to server..."
ssh -i "$KEY_PATH" ubuntu@${EC2_IP} 'mkdir -p ~/app'
scp -i "$KEY_PATH" -r $TEMP_DIR/* ubuntu@${EC2_IP}:~/app/

# Make sure .env is copied (it might be in .gitignore)
echo "Copying .env file..."
scp -i "$KEY_PATH" $TEMP_DIR/.env ubuntu@${EC2_IP}:~/app/.env

# Build and run Docker container
echo "Building and starting Docker container..."
ssh -i "$KEY_PATH" ubuntu@${EC2_IP} 'bash -s' << 'DEPLOY_EOF'
cd ~/app

# Verify .env exists
if [ ! -f .env ]; then
    echo "ERROR: .env file not found!"
    exit 1
fi
echo "✓ .env file present"

# Stop and remove existing container if it exists
docker stop dhis2sync 2>/dev/null || true
docker rm dhis2sync 2>/dev/null || true

# Build Docker image
docker build -t dhis2sync:latest .

# Run container
docker run -d \
    --name dhis2sync \
    --env-file .env \
    -p 8000:8000 \
    --restart unless-stopped \
    dhis2sync:latest

# Wait for container
sleep 5

# Check status
docker ps | grep dhis2sync
echo ""
echo "Container logs:"
docker logs dhis2sync
DEPLOY_EOF

echo -e "${GREEN}✓ Application deployed${NC}"

# Configure Nginx
echo ""
echo "🌐 Configuring Nginx..."

ssh -i "$KEY_PATH" ubuntu@${EC2_IP} 'bash -s' << 'NGINX_EOF'
sudo tee /etc/nginx/sites-available/dhis2sync > /dev/null << 'CONF'
server {
    listen 80;
    server_name _;
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
CONF

sudo ln -sf /etc/nginx/sites-available/dhis2sync /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
NGINX_EOF

echo -e "${GREEN}✓ Nginx configured${NC}"

# Clean up
rm -rf $TEMP_DIR

# Test deployment
echo ""
echo "🧪 Testing deployment..."
sleep 5

echo "Testing health endpoint..."
if curl -s http://${EC2_IP}/healthz | grep -q "ok"; then
    echo -e "${GREEN}✅ Health check passed!${NC}"
else
    echo -e "${YELLOW}⚠️  Health check failed${NC}"
    echo "Checking server logs..."
    ssh -i "$KEY_PATH" ubuntu@${EC2_IP} 'docker logs --tail 50 dhis2sync'
fi

echo ""
echo "Testing ready endpoint..."
curl -s http://${EC2_IP}/ready

echo ""
echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "Application URL: http://${EC2_IP}"
echo "Health check: http://${EC2_IP}/healthz"
echo "Ready check: http://${EC2_IP}/ready"
echo ""
echo "Access your app in browser: http://${EC2_IP}"
