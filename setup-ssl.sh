#!/bin/bash

KEY_PATH="/Users/sean/.ssh/dhis2sync-key.pem"
EC2_IP="13.60.48.211"

echo "🔒 Setting up SSL/HTTPS with Let's Encrypt"
echo ""

read -p "Enter your domain name (e.g., dhis2sync.yourdomain.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Domain name required"
    exit 1
fi

echo ""
echo "📝 Before continuing:"
echo "   1. Make sure your domain '$DOMAIN' points to $EC2_IP"
echo "   2. DNS should be propagated (test with: dig $DOMAIN)"
echo ""
read -p "Press Enter when DNS is ready..."

echo ""
echo "Installing Certbot and setting up SSL..."

ssh -i "$KEY_PATH" ubuntu@${EC2_IP} "bash -s" << EOF
set -e

# Install Certbot
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect

# Test auto-renewal
sudo certbot renew --dry-run

echo "✓ SSL certificate installed!"
echo "✓ Auto-renewal configured"

# Show certificate info
sudo certbot certificates
EOF

echo ""
echo "🎉 SSL Setup Complete!"
echo ""
echo "Your app is now available at:"
echo "  https://$DOMAIN"
echo ""
echo "Certificate will auto-renew every 90 days."
