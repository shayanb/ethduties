// Configuration for deployment
// This will automatically use the correct server URL based on where it's accessed from
window.APP_CONFIG = {
    // Automatically detect and use the appropriate server URL
    serverUrl: (() => {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        
        // For localhost development
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:3000';
        }
        
        // For production deployment - uses same host with port 3000
        // If using HTTPS, make sure your server supports it
        return `${protocol}//${hostname}:3000`;
    })()
};