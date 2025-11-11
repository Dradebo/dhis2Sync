#!/bin/bash
EC2_IP=$(grep "EC2 Public IP:" deployment-info.txt | cut -d: -f2 | xargs)
KEY_PATH=$(grep "SSH Key:" deployment-info.txt | cut -d: -f2 | xargs)

echo "🔄 Updating application..."

TEMP_DIR=$(mktemp -d)
rsync -av --exclude='.git' --exclude='.venv' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='.DS_Store' --exclude='node_modules' \
    ./ $TEMP_DIR/ 2>/dev/null

scp -i "$KEY_PATH" -r $TEMP_DIR/* ubuntu@${EC2_IP}:~/app/

ssh -i "$KEY_PATH" ubuntu@${EC2_IP} 'bash -s' << 'SSH_EOF'
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
