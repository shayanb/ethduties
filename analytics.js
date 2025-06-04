// Analytics wrapper for privacy-respecting event tracking
const Analytics = {
    // Check if analytics should be active
    isEnabled: function() {
        const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
        const doNotTrack = dnt == "1" || dnt == "yes";
        return !doNotTrack && typeof gtag !== 'undefined';
    },

    // Track page views
    trackPageView: function(pageName) {
        if (!this.isEnabled()) return;
        
        gtag('event', 'page_view', {
            page_title: pageName,
            page_location: window.location.href,
            page_path: window.location.pathname
        });
    },

    // Track general events without sensitive data
    trackEvent: function(category, action, label = null, value = null) {
        if (!this.isEnabled()) return;
        
        const eventParams = {
            event_category: category,
            event_label: label
        };
        
        if (value !== null) {
            eventParams.value = value;
        }
        
        gtag('event', action, eventParams);
    },

    // Specific event tracking methods
    trackValidatorAction: function(action, count = null) {
        // Never send validator IDs or addresses
        this.trackEvent('validators', action, null, count);
    },

    trackDutyCheck: function(dutyType) {
        this.trackEvent('duties', 'check', dutyType);
    },

    trackNotificationSetup: function(type, enabled) {
        this.trackEvent('notifications', 'setup', type, enabled ? 1 : 0);
    },

    trackBeaconNodeChange: function(isPublic) {
        this.trackEvent('settings', 'beacon_node_change', isPublic ? 'public' : 'custom');
    },

    trackDashboardMode: function(action) {
        this.trackEvent('interface', 'dashboard_mode', action);
    },

    trackError: function(errorType, errorMessage) {
        // Sanitize error messages to remove any potential validator data
        const sanitizedMessage = errorMessage.replace(/0x[a-fA-F0-9]+/g, '[REDACTED]')
                                           .replace(/\d{4,}/g, '[INDEX]');
        this.trackEvent('errors', errorType, sanitizedMessage);
    }
};

// Initialize analytics on page load
document.addEventListener('DOMContentLoaded', function() {
    if (Analytics.isEnabled()) {
        // Track initial page view
        Analytics.trackPageView('Home');
        
        // Track navigation between pages
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const page = this.getAttribute('data-page');
                Analytics.trackPageView(page);
            });
        });
    }
});