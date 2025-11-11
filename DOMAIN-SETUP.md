# Domain Setup & SSL Configuration Guide

Your DHIS2Sync app is deployed at: **http://13.60.48.211**

This guide shows you how to set up a custom domain with HTTPS.

---

## Option 1: Namecheap (Recommended - Cheap & Reliable)

**Cost:** $1-2/year (.xyz), $8-10/year (.com)

### Step 1: Purchase Domain
1. Go to [namecheap.com](https://namecheap.com)
2. Search for your desired domain (e.g., `dhis2sync.xyz`)
3. Add to cart and complete purchase
4. Enable "WhoisGuard" (free privacy protection)

### Step 2: Configure DNS
1. Go to **Dashboard** → **Domain List**
2. Click **Manage** next to your domain
3. Go to **Advanced DNS** tab
4. Delete any existing A Records
5. Add two **A Records**:
   - **Host**: `@` | **Value**: `13.60.48.211` | **TTL**: Automatic
   - **Host**: `www` | **Value**: `13.60.48.211` | **TTL**: Automatic
6. Click **Save All Changes**

### Step 3: Wait for DNS Propagation
```bash
# Test if DNS is ready (wait until it shows your EC2 IP)
dig yourdomain.xyz +short
# or
nslookup yourdomain.xyz
```

DNS usually propagates in 5-30 minutes.

### Step 4: Set Up SSL
```bash
cd /Users/sean/Documents/GitHub/dhis2Sync
./setup-ssl.sh
# Enter your domain when prompted (e.g., dhis2sync.xyz)
```

**Done!** Your app is now at: `https://yourdomain.xyz` 🎉

---

## Option 2: Porkbun (Developer-Friendly)

**Cost:** $3/year (.dev), $9/year (.com)

### Step 1: Purchase Domain
1. Go to [porkbun.com](https://porkbun.com)
2. Search and purchase your domain
3. WHOIS privacy is included free

### Step 2: Configure DNS
1. Go to **Account** → **Domain Management**
2. Click your domain
3. Scroll to **DNS Records**
4. Delete existing A records if any
5. Add two **A Records**:
   - **Host**: (leave blank for root) | **Answer**: `13.60.48.211`
   - **Host**: `www` | **Answer**: `13.60.48.211`
6. Click **Add** for each

### Step 3: Verify DNS
```bash
# Should return your EC2 IP
dig yourdomain.dev +short
```

Wait 5-30 minutes if it doesn't resolve yet.

### Step 4: Set Up SSL
```bash
./setup-ssl.sh
# Enter: yourdomain.dev
```

**Done!** Access at: `https://yourdomain.dev` 🎉

---

## Option 3: Cloudflare Registrar (At-Cost Pricing)

**Cost:** $9/year (.com) - no markup, true wholesale pricing

### Step 1: Create Cloudflare Account & Purchase Domain
1. Go to [cloudflare.com](https://cloudflare.com)
2. Sign up and verify email
3. Go to **Domain Registration** → **Register Domain**
4. Search and purchase domain (~$9/year for .com)

### Step 2: Configure DNS (Automatic!)
1. After purchase, go to **DNS** tab
2. Your domain is automatically using Cloudflare DNS
3. Add **A Record**:
   - **Name**: `@` | **IPv4 address**: `13.60.48.211` | **Proxy status**: DNS only (gray cloud)
4. Add **A Record**:
   - **Name**: `www` | **IPv4 address**: `13.60.48.211` | **Proxy status**: DNS only (gray cloud)

**Important:** Make sure proxy is **OFF** (gray cloud icon) initially for SSL setup.

### Step 3: Verify DNS
```bash
dig yourdomain.com +short
```

Cloudflare DNS propagates very fast (1-5 minutes).

### Step 4: Set Up SSL
```bash
./setup-ssl.sh
# Enter: yourdomain.com
```

### Step 5: (Optional) Enable Cloudflare Proxy
After SSL is working:
1. Go back to Cloudflare **DNS** tab
2. Click the gray cloud icons to turn them **orange** (proxied)
3. Benefits: Free DDoS protection, caching, additional SSL

**Done!** Your app is at: `https://yourdomain.com` 🎉

---

## Option 4: Using an Existing Domain (From Any Registrar)

Already own a domain from GoDaddy, Google Domains, Squarespace, Bluehost, etc.?

### Step 1: Access Your Domain's DNS Settings
This varies by registrar, but generally:
- **GoDaddy**: Domain Dashboard → DNS → Manage Zones
- **Google Domains/Squarespace**: My domains → Manage → DNS
- **Hover**: Domain → DNS
- **Bluehost**: Domains → DNS Zone Editor

### Step 2: Add DNS Records
Add these two **A Records** (delete conflicting ones):

| Type | Host/Name | Value/Points To | TTL |
|------|-----------|----------------|-----|
| A | @ | 13.60.48.211 | Automatic/3600 |
| A | www | 13.60.48.211 | Automatic/3600 |

**Common registrar terminology:**
- "Host" = "Name" = "Hostname" = "Record Name"
- "Value" = "Points To" = "IPv4 Address" = "Destination"
- "@" = root domain (yourdomain.com)
- "www" = www subdomain (www.yourdomain.com)

### Step 3: Verify DNS Propagation
```bash
# Check DNS
dig yourdomain.com +short

# Should return:
# 13.60.48.211
```

Wait 5-60 minutes depending on TTL and registrar.

### Step 4: Set Up SSL
```bash
./setup-ssl.sh
# Enter: yourdomain.com
```

**Done!** Access at: `https://yourdomain.com` 🎉

---

## Option 5: Free Subdomain with Cloudflare Pages

**Cost:** Free forever

If you don't want to pay for a domain, you can use a Cloudflare Pages subdomain.

### Limitations:
- You'll get `yourapp.pages.dev` (not your own domain)
- Requires setting up Cloudflare Pages proxy (more complex setup)
- Less professional appearance

### Better Free Alternative: Use the IP with Self-Signed SSL

For testing/personal use, just use:
```bash
./setup-self-signed-ssl.sh
```

This gives you `https://13.60.48.211` with encryption (browser will show warning).

---

## Using a Subdomain

Want to use `app.yourdomain.com` instead of `yourdomain.com`?

### DNS Configuration
Add an **A Record**:
- **Host**: `app` | **Value**: `13.60.48.211`

### SSL Setup
```bash
./setup-ssl.sh
# Enter: app.yourdomain.com
```

That's it! Works the same way.

---

## Troubleshooting

### DNS Not Resolving
```bash
# Check if DNS has propagated
dig yourdomain.com +short

# Check from different DNS servers
dig @8.8.8.8 yourdomain.com +short  # Google DNS
dig @1.1.1.1 yourdomain.com +short  # Cloudflare DNS
```

If it doesn't show `13.60.48.211`, wait longer or check your DNS settings.

### SSL Setup Fails
1. **Make sure DNS resolves first**: `dig yourdomain.com` must return your EC2 IP
2. **Check if port 80 is open**: EC2 Security Group must allow HTTP (port 80)
3. **Verify domain ownership**: Let's Encrypt needs to reach your domain via HTTP first

### "Connection Refused" After SSL Setup
1. Check if Nginx is running:
   ```bash
   ssh -i ~/.ssh/dhis2sync-key.pem ubuntu@13.60.48.211 'sudo systemctl status nginx'
   ```
2. Check Nginx logs:
   ```bash
   ssh -i ~/.ssh/dhis2sync-key.pem ubuntu@13.60.48.211 'sudo tail -50 /var/log/nginx/error.log'
   ```

### Certificate Renewal
Let's Encrypt certificates auto-renew. Check renewal status:
```bash
ssh -i ~/.ssh/dhis2sync-key.pem ubuntu@13.60.48.211 'sudo certbot renew --dry-run'
```

---

## Quick Reference

**Your Current Setup:**
- EC2 IP: `13.60.48.211`
- Current URL: `http://13.60.48.211`
- SSH Key: `~/.ssh/dhis2sync-key.pem`

**After Domain Setup:**
- Your URL: `https://yourdomain.com`
- SSL: Let's Encrypt (free, auto-renewing)
- Certificate renewal: Automatic every 90 days

**Useful Commands:**
```bash
# Set up SSL (after DNS is configured)
./setup-ssl.sh

# Update application code
./update-app.sh

# View deployment info
cat deployment-info.txt

# SSH to server
ssh -i ~/.ssh/dhis2sync-key.pem ubuntu@13.60.48.211

# View app logs
ssh -i ~/.ssh/dhis2sync-key.pem ubuntu@13.60.48.211 'docker logs -f dhis2sync'

# Restart app
ssh -i ~/.ssh/dhis2sync-key.pem ubuntu@13.60.48.211 'docker restart dhis2sync'
```

---

## Recommended Domain Registrars Comparison

| Registrar | Best For | .com Price | .xyz Price | Free Privacy | DNS Speed |
|-----------|----------|------------|------------|--------------|-----------|
| **Namecheap** | Budget-conscious | $8-10/yr | $1-2/yr | ✅ Yes | Fast |
| **Porkbun** | Developers | $9/yr | $3/yr | ✅ Yes | Fast |
| **Cloudflare** | Advanced users | $9/yr | N/A | ✅ Yes | Very Fast |
| Google Domains | Simplicity | $12/yr | N/A | ✅ Yes | Fast |
| GoDaddy | Marketing | $20/yr* | N/A | 💰 Paid | Medium |

*GoDaddy often has intro pricing but renews at much higher rates

**Our Pick:** Namecheap for best value, Cloudflare for best features.

---

## Security Note

Once you have SSL set up:
1. Your connection is encrypted (HTTPS)
2. Your credentials are protected
3. Your database password is safe in the `.env` file on the server
4. Your data in transit is secure

The only "heebie-jeebies" part (HTTP) will be gone! 🔒
