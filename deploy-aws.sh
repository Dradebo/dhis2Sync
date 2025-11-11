#!/bin/bash
set -e

echo "🚀 DHIS2Sync AWS Deployment Script"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Installing...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install awscli
    else
        echo "Please install AWS CLI: https://aws.amazon.com/cli/"
        exit 1
    fi
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${YELLOW}⚠️  AWS credentials not configured${NC}"
    echo "Run: aws configure"
    echo "You'll need:"
    echo "  - AWS Access Key ID"
    echo "  - AWS Secret Access Key"
    echo "  - Default region (e.g., us-east-1)"
    exit 1
fi

echo -e "${GREEN}✓ AWS credentials verified${NC}"

# Configuration
read -p "Enter a name for your deployment (e.g., 'dhis2sync'): " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-dhis2sync}

read -p "Enter AWS region [us-east-1]: " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

read -sp "Enter a secure database password: " DB_PASSWORD
echo ""

# Generate encryption key
echo -e "\n${YELLOW}🔑 Generating encryption key...${NC}"

# Use system Python or generate with openssl
if /usr/bin/python3 -c "from cryptography.fernet import Fernet" 2>/dev/null; then
    ENCRYPTION_KEY=$(/usr/bin/python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
else
    # Generate 32-byte base64 key using openssl (compatible with Fernet)
    ENCRYPTION_KEY=$(openssl rand -base64 32)
fi

echo -e "${GREEN}✓ Encryption key generated${NC}"

# Get default VPC
echo -e "\n${YELLOW}🔍 Finding default VPC...${NC}"
VPC_ID=$(aws ec2 describe-vpcs --region $AWS_REGION --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
echo -e "${GREEN}✓ VPC ID: $VPC_ID${NC}"

# Get your current IP
MY_IP=$(curl -s -4 ifconfig.me)
echo -e "${GREEN}✓ Your IP: $MY_IP${NC}"

# Create security groups
echo -e "\n${YELLOW}🛡️  Creating security groups...${NC}"

# RDS Security Group
RDS_SG_ID=$(aws ec2 create-security-group \
    --region $AWS_REGION \
    --group-name "${PROJECT_NAME}-rds-sg" \
    --description "Security group for ${PROJECT_NAME} RDS" \
    --vpc-id $VPC_ID \
    --query 'GroupId' \
    --output text 2>/dev/null || \
    aws ec2 describe-security-groups \
        --region $AWS_REGION \
        --filters "Name=group-name,Values=${PROJECT_NAME}-rds-sg" \
        --query "SecurityGroups[0].GroupId" \
        --output text)

echo -e "${GREEN}✓ RDS Security Group: $RDS_SG_ID${NC}"

# EC2 Security Group
EC2_SG_ID=$(aws ec2 create-security-group \
    --region $AWS_REGION \
    --group-name "${PROJECT_NAME}-ec2-sg" \
    --description "Security group for ${PROJECT_NAME} EC2" \
    --vpc-id $VPC_ID \
    --query 'GroupId' \
    --output text 2>/dev/null || \
    aws ec2 describe-security-groups \
        --region $AWS_REGION \
        --filters "Name=group-name,Values=${PROJECT_NAME}-ec2-sg" \
        --query "SecurityGroups[0].GroupId" \
        --output text)

echo -e "${GREEN}✓ EC2 Security Group: $EC2_SG_ID${NC}"

# Configure security group rules
echo -e "\n${YELLOW}🔒 Configuring firewall rules...${NC}"

# Allow SSH from your IP
aws ec2 authorize-security-group-ingress \
    --region $AWS_REGION \
    --group-id $EC2_SG_ID \
    --protocol tcp --port 22 \
    --cidr ${MY_IP}/32 2>/dev/null || true

# Allow HTTP from anywhere
aws ec2 authorize-security-group-ingress \
    --region $AWS_REGION \
    --group-id $EC2_SG_ID \
    --protocol tcp --port 80 \
    --cidr 0.0.0.0/0 2>/dev/null || true

# Allow HTTPS from anywhere
aws ec2 authorize-security-group-ingress \
    --region $AWS_REGION \
    --group-id $EC2_SG_ID \
    --protocol tcp --port 443 \
    --cidr 0.0.0.0/0 2>/dev/null || true

# Allow PostgreSQL from EC2 security group to RDS
aws ec2 authorize-security-group-ingress \
    --region $AWS_REGION \
    --group-id $RDS_SG_ID \
    --protocol tcp --port 5432 \
    --source-group $EC2_SG_ID 2>/dev/null || true

echo -e "${GREEN}✓ Security rules configured${NC}"

# Create SSH key pair
echo -e "\n${YELLOW}🔑 Creating SSH key pair...${NC}"
if [ ! -f ~/.ssh/${PROJECT_NAME}-key.pem ]; then
    aws ec2 create-key-pair \
        --region $AWS_REGION \
        --key-name ${PROJECT_NAME}-key \
        --query 'KeyMaterial' \
        --output text > ~/.ssh/${PROJECT_NAME}-key.pem
    chmod 400 ~/.ssh/${PROJECT_NAME}-key.pem
    echo -e "${GREEN}✓ SSH key created: ~/.ssh/${PROJECT_NAME}-key.pem${NC}"
else
    echo -e "${GREEN}✓ SSH key already exists${NC}"
fi

# Create RDS instance
echo -e "\n${YELLOW}🗄️  Creating RDS PostgreSQL database...${NC}"
echo "This will take 5-10 minutes..."

RDS_EXISTS=$(aws rds describe-db-instances \
    --region $AWS_REGION \
    --db-instance-identifier ${PROJECT_NAME}-db \
    --query "DBInstances[0].DBInstanceIdentifier" \
    --output text 2>/dev/null || echo "none")

if [ "$RDS_EXISTS" == "none" ]; then
    aws rds create-db-instance \
        --region $AWS_REGION \
        --db-instance-identifier ${PROJECT_NAME}-db \
        --db-instance-class db.t3.micro \
        --engine postgres \
        --engine-version 15.5 \
        --master-username dbadmin \
        --master-user-password "$DB_PASSWORD" \
        --allocated-storage 20 \
        --vpc-security-group-ids $RDS_SG_ID \
        --db-name ${PROJECT_NAME//-/} \
        --no-publicly-accessible \
        --backup-retention-period 7 \
        --no-multi-az \
        --no-storage-encrypted > /dev/null

    echo -e "${YELLOW}⏳ Waiting for RDS to become available...${NC}"
    aws rds wait db-instance-available \
        --region $AWS_REGION \
        --db-instance-identifier ${PROJECT_NAME}-db
else
    echo -e "${GREEN}✓ RDS instance already exists${NC}"
fi

# Get RDS endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
    --region $AWS_REGION \
    --db-instance-identifier ${PROJECT_NAME}-db \
    --query "DBInstances[0].Endpoint.Address" \
    --output text)

echo -e "${GREEN}✓ RDS Endpoint: $RDS_ENDPOINT${NC}"

# Get latest Ubuntu AMI
echo -e "\n${YELLOW}🔍 Finding Ubuntu AMI...${NC}"
AMI_ID=$(aws ec2 describe-images \
    --region $AWS_REGION \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)
echo -e "${GREEN}✓ AMI ID: $AMI_ID${NC}"

# Launch EC2 instance
echo -e "\n${YELLOW}🖥️  Launching EC2 instance...${NC}"

EC2_EXISTS=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --filters "Name=tag:Name,Values=${PROJECT_NAME}-server" "Name=instance-state-name,Values=running,pending,stopped" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text 2>/dev/null || echo "None")

if [ "$EC2_EXISTS" == "None" ]; then
    INSTANCE_ID=$(aws ec2 run-instances \
        --region $AWS_REGION \
        --image-id $AMI_ID \
        --instance-type t2.micro \
        --key-name ${PROJECT_NAME}-key \
        --security-group-ids $EC2_SG_ID \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PROJECT_NAME}-server}]" \
        --query 'Instances[0].InstanceId' \
        --output text)

    echo -e "${YELLOW}⏳ Waiting for instance to start...${NC}"
    aws ec2 wait instance-running --region $AWS_REGION --instance-ids $INSTANCE_ID
else
    INSTANCE_ID=$EC2_EXISTS
    echo -e "${GREEN}✓ EC2 instance already exists: $INSTANCE_ID${NC}"
fi

# Get EC2 public IP
EC2_IP=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

echo -e "${GREEN}✓ EC2 Instance: $INSTANCE_ID${NC}"
echo -e "${GREEN}✓ Public IP: $EC2_IP${NC}"

# Create server setup script
echo -e "\n${YELLOW}📝 Creating server setup script...${NC}"

cat > /tmp/server-setup.sh << 'SETUP_EOF'
#!/bin/bash
set -e

echo "🔧 Setting up server..."

# Update system
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu
rm get-docker.sh

# Install Nginx
sudo apt-get install -y nginx

# Install PostgreSQL client
sudo apt-get install -y postgresql-client

# Install git
sudo apt-get install -y git

echo "✓ Server setup complete"
SETUP_EOF

# Wait for SSH to be available
echo -e "\n${YELLOW}⏳ Waiting for SSH to be ready...${NC}"
sleep 30

# Copy and run setup script
echo -e "${YELLOW}📦 Installing software on server...${NC}"
scp -i ~/.ssh/${PROJECT_NAME}-key.pem -o StrictHostKeyChecking=no \
    /tmp/server-setup.sh ubuntu@${EC2_IP}:/tmp/
ssh -i ~/.ssh/${PROJECT_NAME}-key.pem -o StrictHostKeyChecking=no \
    ubuntu@${EC2_IP} 'bash /tmp/server-setup.sh'

# Clone repository or copy files
echo -e "\n${YELLOW}📂 Deploying application...${NC}"

# Create deployment package
TEMP_DIR=$(mktemp -d)
rsync -av --exclude='.git' --exclude='.venv' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.DS_Store' \
    ./ $TEMP_DIR/

# Create .env file
cat > $TEMP_DIR/.env << ENV_EOF
DATABASE_URL=postgresql+psycopg2://dbadmin:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/${PROJECT_NAME//-/}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
ENVIRONMENT=production
LOG_LEVEL=info
HOST=0.0.0.0
PORT=8000
ENV_EOF

# Copy to server
scp -i ~/.ssh/${PROJECT_NAME}-key.pem -r $TEMP_DIR/* ubuntu@${EC2_IP}:~/app/

# Build and run Docker container
ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP} << 'DOCKER_EOF'
cd ~/app
docker build -t dhis2sync:latest .
docker run -d \
    --name dhis2sync \
    --env-file .env \
    -p 8000:8000 \
    --restart unless-stopped \
    dhis2sync:latest

# Wait for container to start
sleep 5
docker ps
DOCKER_EOF

# Configure Nginx
echo -e "\n${YELLOW}🌐 Configuring Nginx...${NC}"

ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP} << 'NGINX_EOF'
sudo tee /etc/nginx/sites-available/dhis2sync > /dev/null << 'NGINX_CONF'
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
NGINX_CONF

sudo ln -sf /etc/nginx/sites-available/dhis2sync /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
NGINX_EOF

# Clean up
rm -rf $TEMP_DIR

# Save configuration
echo -e "\n${YELLOW}💾 Saving deployment configuration...${NC}"

cat > deployment-info.txt << INFO_EOF
DHIS2Sync Deployment Information
================================

Deployment Name: ${PROJECT_NAME}
AWS Region: ${AWS_REGION}

EC2 Instance ID: ${INSTANCE_ID}
EC2 Public IP: ${EC2_IP}
SSH Key: ~/.ssh/${PROJECT_NAME}-key.pem

RDS Endpoint: ${RDS_ENDPOINT}
Database Name: ${PROJECT_NAME//-/}
Database User: dbadmin

Application URL: http://${EC2_IP}

Access Commands:
================
SSH to server:
  ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP}

View logs:
  ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP} 'docker logs -f dhis2sync'

Restart app:
  ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP} 'docker restart dhis2sync'

Update app:
  ./update-app.sh

Security Notes:
===============
- Database password is stored securely
- Encryption key generated: ${ENCRYPTION_KEY}
- SSH access restricted to your IP: ${MY_IP}

Free Tier Usage:
================
- EC2 t2.micro: 750 hours/month free
- RDS db.t3.micro: 750 hours/month free
- Within free tier limits for first 12 months

INFO_EOF

# Create update script
cat > update-app.sh << 'UPDATE_EOF'
#!/bin/bash
PROJECT_NAME=$(grep "Deployment Name:" deployment-info.txt | cut -d: -f2 | xargs)
EC2_IP=$(grep "EC2 Public IP:" deployment-info.txt | cut -d: -f2 | xargs)

echo "🔄 Updating application..."

# Create deployment package
TEMP_DIR=$(mktemp -d)
rsync -av --exclude='.git' --exclude='.venv' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.DS_Store' \
    ./ $TEMP_DIR/

# Copy to server
scp -i ~/.ssh/${PROJECT_NAME}-key.pem -r $TEMP_DIR/* ubuntu@${EC2_IP}:~/app/

# Rebuild and restart
ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP} << 'SSH_EOF'
cd ~/app
docker build -t dhis2sync:latest .
docker stop dhis2sync
docker rm dhis2sync
docker run -d \
    --name dhis2sync \
    --env-file .env \
    -p 8000:8000 \
    --restart unless-stopped \
    dhis2sync:latest
SSH_EOF

rm -rf $TEMP_DIR
echo "✅ Update complete!"
UPDATE_EOF

chmod +x update-app.sh

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo -e "Application URL: ${GREEN}http://${EC2_IP}${NC}"
echo -e "Health check: ${GREEN}http://${EC2_IP}/healthz${NC}"
echo ""
echo -e "Deployment details saved to: ${YELLOW}deployment-info.txt${NC}"
echo ""
echo "Quick commands:"
echo "  View logs:    ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP} 'docker logs -f dhis2sync'"
echo "  SSH to server: ssh -i ~/.ssh/${PROJECT_NAME}-key.pem ubuntu@${EC2_IP}"
echo "  Update app:    ./update-app.sh"
echo ""
echo -e "${YELLOW}⚠️  Save the deployment-info.txt file - it contains important credentials${NC}"
