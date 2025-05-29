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
        
        // For production deployment - uses same host without port
        // Traefik handles the routing to the backend
        return `${protocol}//${hostname}`;
    })()
};