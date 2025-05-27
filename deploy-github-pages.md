# Deploying to GitHub Pages

## Frontend Deployment (GitHub Pages)

1. **Create a separate branch for GitHub Pages:**
   ```bash
   git checkout -b gh-pages
   ```

2. **Create a configuration file for the frontend to use a remote server:**
   Create `config.js`:
   ```javascript
   window.APP_CONFIG = {
     serverUrl: 'https://your-server-url.herokuapp.com' // or wherever you deploy the server
   };
   ```

3. **Update app.js to use the config:**
   Change line in app.js from:
   ```javascript
   this.serverUrl = 'http://localhost:3000';
   ```
   To:
   ```javascript
   this.serverUrl = window.APP_CONFIG?.serverUrl || 'http://localhost:3000';
   ```

4. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Prepare for GitHub Pages deployment"
   git push origin gh-pages
   ```

5. **Enable GitHub Pages:**
   - Go to your repo settings
   - Navigate to "Pages"
   - Select source: "Deploy from a branch"
   - Select branch: "gh-pages"
   - Select folder: "/ (root)"

## Server Deployment Options

Since GitHub Pages doesn't support Node.js, deploy the server separately:

### Option 1: Heroku (Free tier available)
1. Create a `Procfile`:
   ```
   web: node server.js
   ```

2. Deploy to Heroku:
   ```bash
   heroku create your-app-name
   git push heroku main
   ```

### Option 2: Railway.app
1. Connect your GitHub repo
2. Railway will auto-detect Node.js
3. Add environment variables in Railway dashboard

### Option 3: Render.com
1. Create a new Web Service
2. Connect GitHub repo
3. Build command: `npm install`
4. Start command: `node server.js`