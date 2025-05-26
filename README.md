# ETH Duties Tracker

A web application for tracking Ethereum validator duties with real-time notifications via browser push and Telegram.

## Features

- **Real-time Duty Tracking**: Monitor proposer, attester, and sync committee duties
- **Multiple Notification Channels**: Browser push notifications and Telegram alerts
- **Session Caching**: All data cached in sessionStorage for quick access
- **Auto-refresh**: Optional automatic duty updates every 30 seconds
- **CORS Proxy**: Built-in Node.js server to handle beacon node API calls
- **Visual Urgency Indicators**: Color-coded duties based on time remaining

## Setup

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
   - Tip: Use indices for better performance with many validators

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