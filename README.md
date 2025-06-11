# ETH Duties Tracker

Ethereum validators need timely awareness of their upcoming duties to ensure optimal performance and avoid penalties. While existing tools like beaconcha.in provide basic duty information, they lack advanced notifications and privacy-focused design. [ETHDuties](https://ethduti.es/) Tracker addresses these gaps by providing a self-hosted solution that delivers early warnings for critical duties while keeping your validator data private and local, with real-time notifications via browser push and Telegram.

- [ETH Duties Tracker](#eth-duties-tracker)
  - [Key Features](#key-features)
  - [Usage](#usage)
  - [Notification Settings](#notification-settings)
  - [Import/Export Format](#importexport-format)
    - [CSV Format](#csv-format)
    - [JSON Format](#json-format)
  - [Quick Start with Docker](#quick-start-with-docker)
    - [Using Docker Compose](#using-docker-compose)
    - [Using Portainer](#using-portainer)
    - [Building Docker Image](#building-docker-image)
  - [Setup (Non-Docker)](#setup-non-docker)
    - [1. Install Dependencies](#1-install-dependencies)
    - [2. Configure Environment](#2-configure-environment)
      - [Required Configuration:](#required-configuration)
      - [Optional Configuration:](#optional-configuration)
    - [3. Start the Server](#3-start-the-server)
    - [4. Access the Application](#4-access-the-application)
  - [Testing \& Debugging](#testing--debugging)
    - [Missed Attestation Testing](#missed-attestation-testing)
    - [Console Testing Workflow](#console-testing-workflow)
    - [Real Attestation Monitoring](#real-attestation-monitoring)
  - [Technical Details](#technical-details)
  - [API Endpoints](#api-endpoints)
  - [Docker Deployment](#docker-deployment)
    - [Environment Variables](#environment-variables)
    - [Docker Compose Files](#docker-compose-files)
    - [Portainer Deployment](#portainer-deployment)
    - [Reverse Proxy Setup (Traefik)](#reverse-proxy-setup-traefik)
    - [Health Monitoring](#health-monitoring)
    - [Auto-updates](#auto-updates)
    - [Backup and Restore](#backup-and-restore)
  - [Support the Project](#support-the-project)
    - [🌟 Other Ways to Support](#-other-ways-to-support)
  - [License](#license)



## Key Features

- **Early Sync Committee Alerts**: Receive notifications up to ~27 hours (256 epochs) before your validator becomes part of the sync committee - crucial for planning and preparation
- **Advanced Block Proposal Notifications**: Get notified up to 6 minutes in advance when your validator will propose a block (This will increase with [EIP-7917](https://eips.ethereum.org/EIPS/eip-7917))
- **Enhanced Privacy**: Your validator sets are not clustered or linked together in any centralized service - all data stays local in your browser
- **Multiple Notification Channels**: Desktop browser notifications and Telegram alerts with customizable timing
- **Docker Support**: Easy self-hosted deployment with Docker and Portainer for complete control
- **Dashboard Mode**: Full-screen real-time monitoring view perfect for NOC displays and dedicated monitoring setups
- **Real-time Duty Tracking**: Monitor proposer, attester, and sync committee duties with automatic updates


## Usage

Go to [https://ethduti.es/](https://ethduti.es/) or your local instance ((http://localhost:3000)[http://localhost:3000]) to start using the ETH Duties Tracker.


1. **Configure Beacon Node**: 
   - Use local beacon node (defaults to a public RPC node)
   - Or select a public beacon node from the dropdown in Settings (note: public nodes may have rate limits)

2. **Add Validators**:
   - Enter validator public key (0x...) or validator index
   - Paste comma-separated list of validators (e.g., `1234,5678,9012`)
   - Import from JSON file using the Import button (includes all settings)
   - Export all validators with labels and settings using the Export button
   - Customize validator labels by clicking on any validator's public key

3. **Fetch Duties**:
   - Click "Fetch Duties" to retrieve upcoming duties
   - Enable auto-refresh for automatic updates

4. **Enable Notifications**:
   - **Desktop**: Click "Enable Desktop Notifications" for browser-based notifications
   - **Telegram**: Start chat with [@EthDuties_bot](https://t.me/EthDuties_bot), send `/start` to get your chat ID, enter it in Settings, and click "Enable Telegram Notifications"

5. **Dashboard Mode**:
   - Click "Dashboard Mode" at the bottom of the page for a full-screen monitoring view
   - Perfect for displaying on dedicated monitors or TV screens

## Notification Settings

- Choose which duty types to notify about (proposer duties, attester duties, sync committee duties)
- Set notification threshold (5 minutes to 1 hour before duty)
- Configure separate settings for desktop and Telegram notifications
- Desktop notifications can include sound and persistent display options
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

- Frontend uses vanilla JavaScript with localStorage for caching
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

Since all data is stored in localStorage on the client side, no server-side backup is needed. User settings and validators are preserved in the browser. Use the Export/Import functionality to backup your validator configuration.

## Support the Project

ETH Duties Tracker is completely free and open-source. If you find it useful for tracking your validator duties, consider supporting its development and maintenance:

- **Ethereum & EVM Chains:** `0x5214e7601682dEE3397666b8bBaeDBD682d19186`
- Support the project through [Buy Me a Coffee](https://buymeacoffee.com/pangana)

### 🌟 Other Ways to Support

- ⭐ **Star this repository** on GitHub
- 🐛 **Report issues** and suggest improvements
- 🔄 **Share** with fellow validators
- 🤝 **Contribute** code or documentation

Your support helps keep this tool free, ad-free, and continuously improved for the Ethereum validator community!

---

## License

This project is open-source under the [AGPL-3.0 license](./LICENSE.md) for non-commercial use.

For commercial use or licensing inquiries, please contact [info@pangana.com](mailto:info@pangana.com).