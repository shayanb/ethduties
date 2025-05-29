# ETH Duties Tracker

A web application for tracking Ethereum validator duties with real-time notifications via browser push and Telegram.

## Features

- **Real-time Duty Tracking**: Monitor proposer, attester, and sync committee duties
- **Multiple Notification Channels**: Browser push notifications and Telegram alerts
- **Session Caching**: All data cached in sessionStorage for quick access
- **Auto-refresh**: Optional automatic duty updates every 30 seconds
- **CORS Proxy**: Built-in Node.js server to handle beacon node API calls
- **Visual Urgency Indicators**: Color-coded duties based on time remaining
- **Docker Support**: Easy deployment with Docker and Portainer

## Quick Start with Docker

### Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/shayanb/ethduties.git
cd ethduties

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start with docker-compose
docker-compose up -d
```

### Using Portainer

1. **Deploy Stack**: In Portainer, go to Stacks → Add Stack
2. **Name**: Enter `ethduties`
3. **Repository**: Use `docker-compose.prod.yml` from this repo
4. **Environment Variables**: Add the following:
   ```
   PORT=3000
   SERVER_URL=https://your-domain.com
   DOMAIN=your-domain.com
   TELEGRAM_BOT_TOKEN=your_bot_token (optional)
   VAPID_PUBLIC_KEY=your_vapid_public_key (optional)
   VAPID_PRIVATE_KEY=your_vapid_private_key (optional)
   ```
5. **Deploy**: Click "Deploy the stack"

### Building Docker Image

```bash
# Build locally
docker build -t ethduties:latest .

# Run container
docker run -d \
  --name ethduties \
  -p 3000:3000 \
  --env-file .env \
  ethduties:latest
```

## Setup (Non-Docker)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

#### Required Configuration:

- **PORT**: Server port (default: 3000)

#### Optional Configuration:

For Telegram notifications:
- **TELEGRAM_BOT_TOKEN**: Create a bot via [@BotFather](https://t.me/botfather)

For browser push notifications:
- **VAPID_PUBLIC_KEY** & **VAPID_PRIVATE_KEY**: Generate with:
  ```bash
  npx web-push generate-vapid-keys
  ```

### 3. Start the Server

```bash
npm start
```

Or for development:
```bash
npm run dev
```

### 4. Access the Application

Open http://localhost:3000 in your browser.

## Usage

1. **Configure Beacon Node**: 
   - Use local beacon node (default: http://localhost:5052)
   - Or check "Use Public Beacon Node" for a pre-configured public endpoint

2. **Add Validators**:
   - Enter validator public key (0x...) or validator index
   - Paste comma-separated list of validators (e.g., `1234,5678,9012`)
   - Import from JSON file using the Import button (includes all settings)
   - Export all validators with labels and settings using the Export button

3. **Fetch Duties**:
   - Click "Fetch Duties" to retrieve upcoming duties
   - Enable auto-refresh for automatic updates

4. **Enable Notifications**:
   - **Browser**: Click "Enable Browser Notifications"
   - **Telegram**: Start chat with your bot, send `/start`, copy chat ID, and enable

## Notification Settings

- Choose which duty types to notify about
- Set notification threshold (5 min to 1 hour before duty)
- Notifications automatically trigger when duties approach

## Import/Export Format

### CSV Format
Simply paste a comma-separated list of validators:
```
1234,5678,9012,0x1234...5678
```

### JSON Format
```json
{
  "version": "1.1",
  "exportDate": "2024-01-01T00:00:00.000Z",
  "settings": {
    "beaconUrl": "http://localhost:5052",
    "notifications": {
      "proposer": true,
      "attester": true,
      "sync": true,
      "minutesBefore": 5
    },
    "telegram": {
      "enabled": true,
      "chatId": "123456789"
    },
    "browser": {
      "enabled": true
    },
    "autoRefresh": true
  },
  "validators": [
    {
      "index": 1234,
      "label": "My Validator 1",
      "pubkey": "0x..." // Added during export if available
    }
  ]
}
```

## Testing & Debugging

### Missed Attestation Testing

The application includes console commands for testing the missed attestation tracking system:

```javascript
// Add test missed attestations for a specific validator
app.testAddMissedAttestation('12345')

// Add test missed attestations for all tracked validators (2 per validator)
app.testMissedAttestations()

// Force an immediate check for missed attestations (bypasses timing restrictions)
app.forceCheckMissedAttestations()

// View current missed attestation data and statistics
app.debugMissedAttestations()

// Clear all missed attestation data
app.clearMissedAttestations()
```

### Console Testing Workflow

1. **Open browser console** (F12 → Console tab)
2. **Add some validators** through the UI first
3. **Run test commands** to simulate missed attestations:
   ```javascript
   // Clear any existing data
   app.clearMissedAttestations()
   
   // Add test data for all validators
   app.testMissedAttestations()
   
   // Check the current state
   app.debugMissedAttestations()
   ```
4. **Verify UI updates** - orange warning indicators should appear next to validators
5. **Test clearing** with "Clear Cache" button or `app.clearMissedAttestations()`

### Real Attestation Monitoring

In production, missed attestations are detected by:
- Checking previous epoch attestation duties every 30 seconds
- Comparing with actual beacon chain attestation inclusion data
- Only flagging genuine misses (not random testing data)

**Note**: The current implementation assumes all attestations are included unless there's evidence otherwise. For real missed attestation detection in production, the system would need to:

1. Query `/eth/v1/beacon/blocks/{slot}/attestations` for each slot
2. Parse the attestation data to extract participating validator indices
3. Cross-reference with expected attestation duties to identify missing validators
4. Account for network delays and late attestation inclusion

This would require significant additional API calls to the beacon node and more complex data processing.

## Technical Details

- Frontend uses vanilla JavaScript with sessionStorage for caching
- Backend Node.js server provides CORS proxy for beacon node APIs
- Supports all major Ethereum consensus clients
- Inspired by [eth-duties](https://github.com/TobiWo/eth-duties)

## API Endpoints

The server provides these endpoints:

- `/api/beacon/*` - Proxy for beacon node API calls
- `/api/sync-duties` - Fetch sync committee duties
- `/api/notifications/subscribe` - Subscribe to push notifications
- `/api/telegram/subscribe` - Subscribe to Telegram notifications
- `/api/notify` - Send notifications
- `/api/vapid-public-key` - Get VAPID public key for push
- `/health` - Health check endpoint for monitoring

## Docker Deployment

### Environment Variables

All configuration is done through environment variables:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3000 |
| `NODE_ENV` | Environment (production/development) | No | production |
| `SERVER_URL` | Public URL of your instance | Yes | - |
| `DOMAIN` | Domain for reverse proxy | No | - |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | No | - |
| `VAPID_PUBLIC_KEY` | Web push public key | No | - |
| `VAPID_PRIVATE_KEY` | Web push private key | No | - |

### Docker Compose Files

- `docker-compose.yml` - For local development/testing
- `docker-compose.prod.yml` - For production deployment

### Portainer Deployment

1. **Create Network** (if using external network):
   ```bash
   docker network create ethduties-network
   ```

2. **Deploy via Portainer UI**:
   - Navigate to Stacks → Add Stack
   - Use Web editor or Git repository
   - Add environment variables in Portainer
   - Deploy the stack

3. **Using Portainer CLI**:
   ```bash
   docker run -d \
     -p 9000:9000 \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v portainer_data:/data \
     portainer/portainer-ce
   ```

### Reverse Proxy Setup (Traefik)

The docker-compose files include Traefik labels for automatic SSL:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.ethduties.rule=Host(`your-domain.com`)"
  - "traefik.http.routers.ethduties.tls=true"
  - "traefik.http.routers.ethduties.tls.certresolver=letsencrypt"
```

### Health Monitoring

The container includes a health check that monitors:
- HTTP response on `/health`
- Service uptime
- Telegram bot status

### Auto-updates

Enable automatic updates with Watchtower:

```bash
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --label-enable
```

### Backup and Restore

Since all data is stored in sessionStorage on the client side, no server-side backup is needed. User settings and validators are preserved in the browser.