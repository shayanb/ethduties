# Deploying to Vercel

Vercel is better suited for this app as it supports both frontend and serverless functions.

## Option 1: Full Stack Deployment with Vercel

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Create vercel.json configuration:**
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "server.js",
         "use": "@vercel/node"
       },
       {
         "src": "!(server.js|api/**)",
         "use": "@vercel/static"
       }
     ],
     "routes": [
       {
         "src": "/api/(.*)",
         "dest": "/server.js"
       },
       {
         "src": "/(.*)",
         "dest": "/$1"
       }
     ]
   }
   ```

3. **Update package.json:**
   ```json
   {
     "engines": {
       "node": "18.x"
     }
   }
   ```

4. **Deploy:**
   ```bash
   vercel
   ```

## Option 2: Serverless Functions Approach (Recommended)

Convert server endpoints to Vercel serverless functions:

1. **Create api directory and move endpoints:**
   ```
   api/
   ├── beacon/[...path].js
   ├── sync-duties.js
   ├── notify.js
   ├── notifications/subscribe.js
   ├── telegram/subscribe.js
   └── vapid-public-key.js
   ```

2. **Example serverless function (api/beacon/[...path].js):**
   ```javascript
   const fetch = require('node-fetch');

   export default async function handler(req, res) {
     const { path } = req.query;
     const beaconUrl = req.body.beaconUrl || 'http://localhost:5052';
     const apiPath = path.join('/');
     
     try {
       const response = await fetch(`${beaconUrl}/${apiPath}`, {
         method: req.body.method || 'GET',
         headers: { 'Content-Type': 'application/json' },
         body: req.body.data ? JSON.stringify(req.body.data) : undefined
       });
       
       const data = await response.json();
       res.status(200).json(data);
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   }
   ```

3. **Deploy:**
   ```bash
   vercel --prod
   ```

## Environment Variables

For both platforms, add these in the dashboard:
- `TELEGRAM_BOT_TOKEN`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL`

## CORS Configuration

Add to vercel.json:
```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,OPTIONS" }
      ]
    }
  ]
}