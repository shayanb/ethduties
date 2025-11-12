class ValidatorDutiesTracker {
    constructor() {
        this.publicBeaconUrls = [
            { name: 'PublicNode', url: 'https://ethereum-beacon-api.publicnode.com' },
            { name: 'dRPC', url: 'https://eth-beacon-chain.drpc.org/rest' },
            { name: 'QuickNode', url: 'https://docs-demo.quiknode.pro' }
        ];
        
        // Load beacon URL from storage or select a random public node on first load
        this.beaconUrl = localStorage.getItem('beaconUrl');
        if (!this.beaconUrl) {
            // First load - select a random public node
            this.beaconUrl = this.publicBeaconUrls[0].url;
            localStorage.setItem('beaconUrl', this.beaconUrl);
        }
        
        this.serverUrl = window.APP_CONFIG?.serverUrl || 'http://localhost:3000';
        this.autoRefreshInterval = null;
        this.notificationCheckInterval = null;
        this.countdownInterval = null;
        this.duties = {
            proposer: [],
            attester: [],
            sync: []
        };
        this.networkOverview = {
            allProposers: [],
            currentSyncCommittee: [],
            nextSyncCommittee: []
        };
        this.pushSubscription = null;
        this.notifiedDuties = new Set();
        this.validatorColors = {};
        this.beaconErrorShown = false;
        this.colorPalette = [
            '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
            '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
        ];
        
        // Initialize validators after setting up colors
        this.validators = this.loadValidators();
        this.loadNotifiedDuties();
        this.loadBlockDetails();
        
        // Initialize missed attestation tracking
        this.missedAttestations = this.loadMissedAttestations() || {};
        this.lastAttestationCheck = null;
        
        this.initializeEventListeners();
        this.renderValidators();
        this.loadCachedDuties();
        this.initializeNotifications();
        this.initializeDashboard().catch(console.error);
        this.initializeDarkMode();
        this.startCountdownTimer();
    }
    // ... rest of the file is unchanged
