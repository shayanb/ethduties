self.addEventListener('push', event => {
    if (!event.data) return;
    
    const data = event.data.json();
    const options = {
        body: data.body,
        icon: data.icon || '/icon-192.png',
        badge: data.badge || '/badge-72.png',
        vibrate: [200, 100, 200],
        tag: 'validator-duty',
        requireInteraction: true,
        data: data.data
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow('/')
    );
});