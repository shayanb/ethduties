class ValidatorDutiesTracker {
    constructor() {
        this.beaconUrl = 'http://localhost:5052';
        this.serverUrl = 'http://localhost:3000';
        this.publicBeaconUrls = [
            { name: 'PublicNode', url: 'https://ethereum-beacon-api.publicnode.com' },
            { name: 'Ankr', url: 'https://rpc.ankr.com/eth_beacon' },
            { name: 'ChainSafe', url: 'https://lodestar-mainnet.chainsafe.io' },
            { name: 'Nether', url: 'https://beacon.nether.ws' },
            { name: 'QuickNode', url: 'https://nd-123-456-789.p2pify.com/beacon' }
        ];
        this.autoRefreshInterval = null;
        this.notificationCheckInterval = null;
        this.countdownInterval = null;
        this.duties = {
            proposer: [],
            attester: [],
            sync: []
        };
        this.pushSubscription = null;
        this.notifiedDuties = new Set();
        this.validatorColors = {};
        this.colorPalette = [
            '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
            '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
        ];
        
        // Initialize validators after setting up colors
        this.validators = this.loadValidators();
        
        this.initializeEventListeners();
        this.renderValidators();
        this.loadCachedDuties();
        this.initializeNotifications();
        this.startCountdownTimer();
    }

    initializeEventListeners() {
        document.getElementById('addValidatorBtn').addEventListener('click', () => this.addValidator());
        document.getElementById('validatorInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addValidator();
            }
        });
        
        document.getElementById('fetchDutiesBtn').addEventListener('click', () => this.fetchAllDuties());
        document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        
        document.getElementById('autoRefresh').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        });
        
        // Initialize public beacon dropdown
        const publicSelect = document.getElementById('publicBeaconSelect');
        this.publicBeaconUrls.forEach(beacon => {
            const option = document.createElement('option');
            option.value = beacon.url;
            option.textContent = beacon.name;
            publicSelect.appendChild(option);
        });
        
        publicSelect.addEventListener('change', (e) => {
            const beaconUrlInput = document.getElementById('beaconUrl');
            if (e.target.value) {
                this.beaconUrl = e.target.value;
                beaconUrlInput.value = this.beaconUrl;
            }
        });
        
        document.getElementById('beaconUrl').addEventListener('change', (e) => {
            this.beaconUrl = e.target.value;
        });
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        document.getElementById('enableBrowserNotifications').addEventListener('click', () => this.enableBrowserNotifications());
        document.getElementById('enableTelegramNotifications').addEventListener('click', () => this.enableTelegramNotifications());
        document.getElementById('updateTelegramSubscription').addEventListener('click', () => this.updateTelegramSubscription());
    }

    async initializeNotifications() {
        const vapidResponse = await fetch(`${this.serverUrl}/api/vapid-public-key`);
        const { publicKey } = await vapidResponse.json();
        this.vapidPublicKey = publicKey;
        
        // Load saved Telegram chat ID
        const savedChatId = sessionStorage.getItem('telegramChatId');
        const telegramEnabled = sessionStorage.getItem('telegramEnabled') === 'true';
        
        if (savedChatId) {
            document.getElementById('telegramChatId').value = savedChatId;
            
            if (telegramEnabled) {
                this.showNotificationStatus('telegram', 'Telegram notifications active from previous session', true);
                document.getElementById('enableTelegramNotifications').style.display = 'none';
                document.getElementById('updateTelegramSubscription').style.display = 'inline-block';
            }
        }
        
        this.startNotificationCheck();
    }

    async enableBrowserNotifications() {
        try {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                throw new Error('Push notifications not supported');
            }
            
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('Notification permission denied');
            }
            
            const registration = await navigator.serviceWorker.register('/sw.js');
            
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
            });
            
            this.pushSubscription = subscription;
            
            await fetch(`${this.serverUrl}/api/notifications/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription,
                    validators: this.validators
                })
            });
            
            this.showNotificationStatus('browser', 'Browser notifications enabled', true);
        } catch (error) {
            console.error('Browser notification error:', error);
            this.showNotificationStatus('browser', error.message, false);
        }
    }

    async enableTelegramNotifications() {
        try {
            const chatId = document.getElementById('telegramChatId').value.trim();
            if (!chatId) {
                throw new Error('Please enter your Telegram chat ID');
            }
            
            if (this.validators.length === 0) {
                throw new Error('Please add validators first');
            }
            
            const response = await fetch(`${this.serverUrl}/api/telegram/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId,
                    validators: this.validators
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to subscribe to Telegram notifications');
            }
            
            sessionStorage.setItem('telegramChatId', chatId);
            sessionStorage.setItem('telegramEnabled', 'true');
            
            const validatorList = this.validators.map(v => this.getValidatorLabel(v)).join(', ');
            this.showNotificationStatus('telegram', `Telegram notifications enabled for: ${validatorList}`, true);
            
            // Update UI
            document.getElementById('enableTelegramNotifications').style.display = 'none';
            document.getElementById('updateTelegramSubscription').style.display = 'inline-block';
        } catch (error) {
            console.error('Telegram notification error:', error);
            this.showNotificationStatus('telegram', error.message, false);
        }
    }
    
    async updateTelegramSubscription() {
        try {
            const chatId = document.getElementById('telegramChatId').value.trim();
            if (!chatId) {
                throw new Error('Chat ID not found');
            }
            
            if (this.validators.length === 0) {
                throw new Error('Please add validators first');
            }
            
            const response = await fetch(`${this.serverUrl}/api/telegram/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId,
                    validators: this.validators
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to update subscription');
            }
            
            const validatorList = this.validators.map(v => this.getValidatorLabel(v)).join(', ');
            this.showNotificationStatus('telegram', `Subscription updated for: ${validatorList}`, true);
        } catch (error) {
            console.error('Telegram update error:', error);
            this.showNotificationStatus('telegram', error.message, false);
        }
    }

    showNotificationStatus(type, message, success) {
        const statusEl = document.getElementById(`${type}NotificationStatus`);
        statusEl.textContent = message;
        statusEl.className = `notification-status ${success ? 'success' : 'error'}`;
    }

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    startNotificationCheck() {
        this.notificationCheckInterval = setInterval(() => {
            this.checkForUpcomingDuties();
        }, 10000);
    }
    
    startCountdownTimer() {
        // Update countdowns every second
        this.countdownInterval = setInterval(() => {
            this.updateCountdowns();
        }, 1000);
    }
    
    updateCountdowns() {
        // Update all duty time displays
        document.querySelectorAll('.duty-time').forEach(element => {
            const slot = parseInt(element.dataset.slot);
            if (slot) {
                const timeUntil = this.getTimeUntilSlot(slot);
                element.textContent = this.formatTimeUntil(timeUntil);
                
                // Update urgency class
                const dutyItem = element.closest('.duty-item');
                if (dutyItem) {
                    dutyItem.className = `duty-item ${element.dataset.dutyType || ''} ${this.getUrgencyClass(timeUntil)}`;
                }
            }
        });
    }

    checkForUpcomingDuties() {
        const notifyMinutes = parseInt(document.getElementById('notifyMinutes').value);
        const notifyProposer = document.getElementById('notifyProposer').checked;
        const notifyAttester = document.getElementById('notifyAttester').checked;
        const notifySync = document.getElementById('notifySync').checked;
        
        if (notifyProposer) {
            this.duties.proposer.forEach(duty => {
                this.checkAndNotifyDuty('Proposer', duty, notifyMinutes);
            });
        }
        
        if (notifyAttester) {
            this.duties.attester.forEach(duty => {
                this.checkAndNotifyDuty('Attester', duty, notifyMinutes);
            });
        }
        
        if (notifySync) {
            this.duties.sync.forEach(duty => {
                // For sync committee, we need to add a slot property for notification
                if (duty.period === 'current') {
                    // Use current slot as a reference
                    duty.slot = this.getCurrentSlotSync();
                    this.checkAndNotifyDuty('Sync Committee', duty, notifyMinutes);
                }
            });
        }
    }

    checkAndNotifyDuty(type, duty, notifyMinutes) {
        // Get the validator we're tracking for this duty
        const validator = this.getValidatorForDuty(duty);
        const dutyKey = `${type}-${duty.slot}-${validator}`;
        
        if (this.notifiedDuties.has(dutyKey)) return;
        
        const timeUntil = this.getTimeUntilSlot(duty.slot);
        const minutesUntil = timeUntil / 1000 / 60;
        
        if (minutesUntil > 0 && minutesUntil <= notifyMinutes) {
            this.notifiedDuties.add(dutyKey);
            
            const urgency = minutesUntil < 1 ? 'critical' : minutesUntil < 2 ? 'urgent' : 'normal';
            
            console.log(`Sending notification for ${type} duty: validator ${validator}, slot ${duty.slot}`);
            
            fetch(`${this.serverUrl}/api/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    validator: validator,
                    duty: {
                        slot: duty.slot,
                        timeUntil: this.formatTimeUntil(timeUntil)
                    },
                    urgency
                })
            }).catch(error => {
                console.error('Error sending notification:', error);
            });
        }
    }

    loadValidators() {
        const stored = sessionStorage.getItem('validators');
        const validators = stored ? JSON.parse(stored) : [];
        
        // Assign colors to loaded validators
        validators.forEach(validator => {
            this.assignValidatorColor(validator);
        });
        
        return validators;
    }

    saveValidators() {
        sessionStorage.setItem('validators', JSON.stringify(this.validators));
    }

    async addValidator() {
        const input = document.getElementById('validatorInput');
        const validator = input.value.trim();
        
        if (!validator) {
            this.showError('Please enter a validator public key or index');
            return;
        }
        
        if (this.validators.includes(validator)) {
            this.showError('Validator already added');
            return;
        }
        
        // Check if this might be a duplicate (index vs pubkey)
        const isDuplicate = await this.checkForDuplicate(validator);
        if (isDuplicate) {
            this.showError(`This validator might already be added as ${isDuplicate}`);
            return;
        }
        
        this.validators.push(validator);
        this.assignValidatorColor(validator);
        this.saveValidators();
        this.renderValidators();
        input.value = '';
        
        if (this.validators.length === 1) {
            this.fetchAllDuties();
        }
    }
    
    async checkForDuplicate(newValidator) {
        // If we don't have existing validators, no duplicates possible
        if (this.validators.length === 0) return null;
        
        try {
            // Get validator info from beacon chain
            const validatorInfo = await this.getValidatorInfo(newValidator);
            if (!validatorInfo) return null;
            
            // Check if we already have this validator by comparing both index and pubkey
            for (const existing of this.validators) {
                const existingInfo = await this.getValidatorInfo(existing);
                if (!existingInfo) continue;
                
                // Check if they're the same validator
                if (validatorInfo.index === existingInfo.index) {
                    return existing;
                }
            }
        } catch (error) {
            console.error('Error checking for duplicate:', error);
        }
        
        return null;
    }
    
    async getValidatorInfo(validator) {
        try {
            const response = await fetch(`${this.serverUrl}/api/beacon/eth/v1/beacon/states/head/validators/${validator}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (!response.ok) return null;
            
            const data = await response.json();
            return data.data ? {
                index: data.data.index,
                pubkey: data.data.validator.pubkey
            } : null;
        } catch (error) {
            return null;
        }
    }

    assignValidatorColor(validator) {
        if (!this.validatorColors[validator]) {
            const usedColors = Object.values(this.validatorColors);
            const availableColors = this.colorPalette.filter(color => !usedColors.includes(color));
            const color = availableColors.length > 0 ? availableColors[0] : 
                         this.colorPalette[Object.keys(this.validatorColors).length % this.colorPalette.length];
            this.validatorColors[validator] = color;
        }
    }
    
    getValidatorColor(validator) {
        return this.validatorColors[validator] || '#6b7280';
    }

    removeValidator(validator) {
        this.validators = this.validators.filter(v => v !== validator);
        delete this.validatorColors[validator];
        this.saveValidators();
        this.renderValidators();
    }

    renderValidators() {
        const list = document.getElementById('validatorsList');
        list.innerHTML = '';
        
        if (this.validators.length === 0) {
            list.innerHTML = '<li style="text-align: center; color: var(--text-secondary);">No validators added yet</li>';
            return;
        }
        
        this.validators.forEach(validator => {
            const li = document.createElement('li');
            const color = this.getValidatorColor(validator);
            li.innerHTML = `
                <div class="validator-color-badge" style="background-color: ${color}"></div>
                <span class="validator-address">${this.truncateAddress(validator)}</span>
                <button class="remove-validator" onclick="app.removeValidator('${validator}')">Remove</button>
            `;
            list.appendChild(li);
        });
    }

    truncateAddress(address) {
        if (address.startsWith('0x') && address.length > 20) {
            return `${address.slice(0, 10)}...${address.slice(-8)}`;
        }
        return address;
    }
    
    getValidatorForDuty(duty) {
        // Find which validator we're tracking for this duty
        if (duty.pubkey && this.validators.includes(duty.pubkey)) {
            return duty.pubkey;
        }
        
        const indexStr = duty.validator_index?.toString();
        if (indexStr && this.validators.includes(indexStr)) {
            return indexStr;
        }
        
        // Fallback - return first match
        return duty.pubkey || indexStr;
    }
    
    getValidatorLabel(validator) {
        if (validator.startsWith('0x')) {
            return this.truncateAddress(validator);
        }
        return `#${validator}`;
    }

    async fetchAllDuties() {
        if (this.validators.length === 0) {
            this.showError('Please add at least one validator');
            return;
        }
        
        this.showLoading(true);
        this.hideError();
        
        try {
            const currentSlot = await this.getCurrentSlot();
            const currentEpoch = Math.floor(currentSlot / 32);
            const nextEpoch = currentEpoch + 1;
            
            // Update epoch info
            document.getElementById('epochInfo').innerHTML = `
                Current Epoch: ${currentEpoch} | Current Slot: ${currentSlot} | Next Epoch: ${nextEpoch}
            `;
            
            const [proposerDuties, attesterDuties, syncDuties] = await Promise.all([
                this.fetchProposerDuties(currentEpoch),
                this.fetchAttesterDuties(nextEpoch),
                this.fetchSyncCommitteeDuties(currentEpoch)
            ]);
            
            this.duties.proposer = proposerDuties;
            this.duties.attester = attesterDuties;
            this.duties.sync = syncDuties;
            
            this.cacheDuties();
            this.displayDuties();
            
            // Show success message
            this.showSuccess(`Successfully fetched duties for ${this.validators.length} validator(s)`);
            
        } catch (error) {
            console.error('Error fetching duties:', error);
            this.showError(`Failed to fetch duties: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async getCurrentSlot() {
        try {
            const response = await fetch(`${this.serverUrl}/api/beacon/eth/v1/beacon/headers/head`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.data || !data.data.header || !data.data.header.message) {
                throw new Error('Invalid response format');
            }
            
            return parseInt(data.data.header.message.slot);
        } catch (error) {
            console.error('getCurrentSlot error:', error);
            throw new Error(`Failed to get current slot: ${error.message}`);
        }
    }

    async fetchProposerDuties(epoch) {
        try {
            const response = await fetch(`${this.serverUrl}/api/beacon/eth/v1/validator/duties/proposer/${epoch}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.data) {
                console.log('No proposer duties data received');
                return [];
            }
            
            const filtered = data.data.filter(duty => 
                this.validators.includes(duty.pubkey) || 
                this.validators.includes(duty.validator_index?.toString())
            );
            
            console.log(`Found ${filtered.length} proposer duties for tracked validators`);
            return filtered;
        } catch (error) {
            console.error('fetchProposerDuties error:', error);
            throw new Error(`Failed to fetch proposer duties: ${error.message}`);
        }
    }

    async fetchAttesterDuties(epoch) {
        try {
            const validatorIndices = this.validators.filter(v => !v.startsWith('0x'));
            const validatorPubkeys = this.validators.filter(v => v.startsWith('0x'));
            
            const requestBody = [...validatorIndices, ...validatorPubkeys];
            
            console.log(`Fetching attester duties for ${requestBody.length} validators in epoch ${epoch}`);
            
            const response = await fetch(`${this.serverUrl}/api/beacon/eth/v1/validator/duties/attester/${epoch}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    beaconUrl: this.beaconUrl,
                    method: 'POST',
                    data: requestBody
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.data) {
                console.log('No attester duties data received');
                return [];
            }
            
            console.log(`Found ${data.data.length} attester duties`);
            return data.data || [];
        } catch (error) {
            console.error('fetchAttesterDuties error:', error);
            throw new Error(`Failed to fetch attester duties: ${error.message}`);
        }
    }

    async fetchSyncCommitteeDuties(epoch) {
        try {
            const response = await fetch(`${this.serverUrl}/api/sync-duties`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    beaconUrl: this.beaconUrl,
                    validators: this.validators,
                    epoch
                })
            });
            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error('Failed to fetch sync committee duties:', error);
            return [];
        }
    }

    displayDuties() {
        this.displayProposerDuties();
        this.displayAttesterDuties();
        this.displaySyncCommitteeDuties();
    }

    displayProposerDuties() {
        const panel = document.getElementById('proposerDuties');
        
        if (this.validators.length === 0) {
            panel.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Add validators to see duties</p>';
            return;
        }
        
        if (this.duties.proposer.length === 0) {
            panel.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: var(--text-secondary); margin-bottom: 10px;">No proposer duties found for your validators in the current epoch</p>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">This is normal - proposer duties are randomly assigned</p>
                </div>
            `;
            return;
        }
        
        // Separate past and future duties
        const currentSlot = this.getCurrentSlotSync();
        const pastDuties = [];
        const futureDuties = [];
        
        this.duties.proposer.forEach(duty => {
            if (duty.slot < currentSlot) {
                pastDuties.push(duty);
            } else {
                futureDuties.push(duty);
            }
        });
        
        // Sort past duties by most recent first
        pastDuties.sort((a, b) => b.slot - a.slot);
        
        // Show only the 3 most recent past duties
        const recentPastDuties = pastDuties.slice(0, 3);
        
        const html = [
            ...recentPastDuties.map(duty => this.renderProposerDuty(duty, true)),
            ...futureDuties.map(duty => this.renderProposerDuty(duty, false))
        ].join('');
        
        panel.innerHTML = html || '<p style="text-align: center; color: var(--text-secondary);">No duties to display</p>';
    }
    
    renderProposerDuty(duty, isPast = false) {
        const timeUntil = this.getTimeUntilSlot(duty.slot);
        const urgencyClass = isPast ? 'past' : this.getUrgencyClass(timeUntil);
        const validator = this.getValidatorForDuty(duty);
        const color = this.getValidatorColor(validator);
        const label = this.getValidatorLabel(validator);
        const timeDisplay = isPast ? this.formatTimeAgo(-timeUntil) : this.formatTimeUntil(timeUntil);
        
        return `
            <div class="duty-item proposer ${urgencyClass}">
                <div class="validator-tag" style="background-color: ${color}">${label}</div>
                <div class="duty-content">
                    <div class="duty-header">
                        <span class="duty-type">Block Proposal${isPast ? ' ✓' : ''}</span>
                        <span class="duty-time" ${!isPast ? `data-slot="${duty.slot}" data-duty-type="proposer"` : ''}>${timeDisplay}</span>
                    </div>
                    <div class="duty-details">
                        <span class="slot-number">Slot ${duty.slot}</span>
                    </div>
                </div>
            </div>
        `;
    }

    displayAttesterDuties() {
        const panel = document.getElementById('attesterDuties');
        
        if (this.validators.length === 0) {
            panel.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Add validators to see duties</p>';
            return;
        }
        
        if (this.duties.attester.length === 0) {
            panel.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: var(--text-secondary); margin-bottom: 10px;">No attester duties found for your validators</p>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Check that your validator indices/pubkeys are correct</p>
                </div>
            `;
            return;
        }
        
        const html = this.duties.attester.map(duty => {
            const timeUntil = this.getTimeUntilSlot(duty.slot);
            const urgencyClass = this.getUrgencyClass(timeUntil);
            const validator = this.getValidatorForDuty(duty);
            const color = this.getValidatorColor(validator);
            const label = this.getValidatorLabel(validator);
            
            return `
                <div class="duty-item ${urgencyClass}">
                    <div class="validator-tag" style="background-color: ${color}">${label}</div>
                    <div class="duty-content">
                        <div class="duty-header">
                            <span class="duty-type">Attestation</span>
                            <span class="duty-time" data-slot="${duty.slot}">${this.formatTimeUntil(timeUntil)}</span>
                        </div>
                        <div class="duty-details">
                            <span class="slot-number">Slot ${duty.slot}</span>
                            <div>Committee: ${duty.committee_index}, Position: ${duty.validator_committee_index}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        panel.innerHTML = html;
    }

    displaySyncCommitteeDuties() {
        const panel = document.getElementById('syncDuties');
        
        if (this.validators.length === 0) {
            panel.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Add validators to see duties</p>';
            return;
        }
        
        if (this.duties.sync.length === 0) {
            panel.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: var(--text-secondary); margin-bottom: 10px;">No sync committee duties found for your validators</p>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Sync committees are selected every ~27 hours</p>
                </div>
            `;
            return;
        }
        
        const currentEpoch = Math.floor(this.getCurrentSlotSync() / 32);
        const html = this.duties.sync.map(duty => {
            let dutyInfo = '';
            let timeDisplay = '';
            
            if (duty.period === 'current') {
                const remainingEpochs = duty.until_epoch - currentEpoch;
                dutyInfo = `Current sync committee member`;
                timeDisplay = `${remainingEpochs} epochs remaining`;
            } else {
                const epochsUntil = duty.from_epoch - currentEpoch;
                dutyInfo = `Next sync committee member`;
                timeDisplay = `Starts in ${epochsUntil} epochs`;
            }
            
            const color = this.getValidatorColor(duty.validator);
            const label = this.getValidatorLabel(duty.validator);
            
            return `
                <div class="duty-item">
                    <div class="validator-tag" style="background-color: ${color}">${label}</div>
                    <div class="duty-content">
                        <div class="duty-header">
                            <span class="duty-type">Sync Committee</span>
                            <span class="duty-time">${timeDisplay}</span>
                        </div>
                        <div class="duty-details">
                            <div>${dutyInfo}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        panel.innerHTML = html;
    }

    getCurrentSlotSync() {
        const genesisTime = 1606824023;
        const currentTime = Math.floor(Date.now() / 1000);
        return Math.floor((currentTime - genesisTime) / 12);
    }

    getTimeUntilSlot(slot) {
        const currentSlot = this.getCurrentSlotSync();
        const slotsUntil = slot - currentSlot;
        return slotsUntil * 12 * 1000;
    }

    formatTimeUntil(milliseconds) {
        if (milliseconds < 0) return 'Passed';
        
        const totalSeconds = Math.floor(milliseconds / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m ${seconds}s`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }
    
    formatTimeAgo(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return `${seconds}s ago`;
    }

    getUrgencyClass(timeUntil) {
        const minutes = timeUntil / 1000 / 60;
        if (minutes < 1) return 'critical';
        if (minutes < 2) return 'urgent';
        return '';
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.duty-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tab}Duties`);
        });
    }

    cacheDuties() {
        const cache = {
            duties: this.duties,
            timestamp: Date.now()
        };
        sessionStorage.setItem('dutiesCache', JSON.stringify(cache));
    }

    loadCachedDuties() {
        const cached = sessionStorage.getItem('dutiesCache');
        if (!cached) return;
        
        const { duties, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        
        if (age < 5 * 60 * 1000) {
            this.duties = duties;
            this.displayDuties();
        }
    }

    clearCache() {
        sessionStorage.removeItem('dutiesCache');
        this.duties = {
            proposer: [],
            attester: [],
            sync: []
        };
        this.displayDuties();
    }

    startAutoRefresh() {
        this.fetchAllDuties();
        this.autoRefreshInterval = setInterval(() => {
            this.fetchAllDuties();
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    showLoading(show) {
        document.getElementById('loadingIndicator').classList.toggle('hidden', !show);
    }

    showError(message) {
        const errorEl = document.getElementById('errorMessage');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.style.backgroundColor = '#fef2f2';
        errorEl.style.color = 'var(--error-color)';
        setTimeout(() => errorEl.classList.add('hidden'), 5000);
    }
    
    showSuccess(message) {
        const errorEl = document.getElementById('errorMessage');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.style.backgroundColor = '#f0fdf4';
        errorEl.style.color = 'var(--success-color)';
        setTimeout(() => errorEl.classList.add('hidden'), 3000);
    }

    hideError() {
        document.getElementById('errorMessage').classList.add('hidden');
    }
}

const app = new ValidatorDutiesTracker();

// Clean up intervals on page unload
window.addEventListener('beforeunload', () => {
    if (app.autoRefreshInterval) clearInterval(app.autoRefreshInterval);
    if (app.notificationCheckInterval) clearInterval(app.notificationCheckInterval);
    if (app.countdownInterval) clearInterval(app.countdownInterval);
});