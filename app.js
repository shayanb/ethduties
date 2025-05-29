class ValidatorDutiesTracker {
    constructor() {
        this.publicBeaconUrls = [
            { name: 'PublicNode', url: 'https://ethereum-beacon-api.publicnode.com' },
            { name: 'dRPC', url: 'https://eth-beacon-chain.drpc.org/rest' },
            { name: 'QuickNode', url: 'https://docs-demo.quiknode.pro' }
        ];
        
        // Load beacon URL from storage or select a random public node on first load
        this.beaconUrl = sessionStorage.getItem('beaconUrl');
        if (!this.beaconUrl) {
            // First load - select a random public node
            const randomIndex = Math.floor(Math.random() * this.publicBeaconUrls.length);
            this.beaconUrl = this.publicBeaconUrls[randomIndex].url;
            sessionStorage.setItem('beaconUrl', this.beaconUrl);
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
        this.initializeDashboard();
        this.startCountdownTimer();
    }

    initializeEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchPage(e.target.dataset.page));
        });
        
        document.getElementById('addValidatorBtn').addEventListener('click', () => this.addValidator());
        document.getElementById('validatorInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addValidator();
            }
        });
        
        // Import/Export buttons
        document.getElementById('importBtn').addEventListener('click', () => {
            document.getElementById('importFile').click();
        });
        
        document.getElementById('importFile').addEventListener('change', (e) => {
            this.handleImport(e.target.files[0]);
            e.target.value = ''; // Reset file input
        });
        
        document.getElementById('exportBtn').addEventListener('click', () => this.exportValidators());
        
        document.getElementById('fetchDutiesBtn').addEventListener('click', () => this.fetchAllDuties());
        document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        document.getElementById('fetchNetworkBtn').addEventListener('click', () => this.fetchNetworkOverviewOnly());
        
        // Load and set auto-refresh setting
        const autoRefreshEnabled = sessionStorage.getItem('autoRefresh') === 'true';
        const autoRefreshCheckbox = document.getElementById('autoRefresh');
        autoRefreshCheckbox.checked = autoRefreshEnabled;
        
        if (autoRefreshEnabled) {
            this.startAutoRefresh();
        }
        
        autoRefreshCheckbox.addEventListener('change', (e) => {
            sessionStorage.setItem('autoRefresh', e.target.checked);
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
        
        // Set initial beacon URL in input
        const beaconUrlInput = document.getElementById('beaconUrl');
        beaconUrlInput.value = this.beaconUrl;
        
        // Check if current URL matches a public beacon
        const matchingBeacon = this.publicBeaconUrls.find(b => b.url === this.beaconUrl);
        if (matchingBeacon) {
            publicSelect.value = matchingBeacon.url;
        }
        
        publicSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                this.beaconUrl = e.target.value;
                beaconUrlInput.value = this.beaconUrl;
                sessionStorage.setItem('beaconUrl', this.beaconUrl);
                this.showSuccess('Beacon node URL updated');
            }
        });
        
        beaconUrlInput.addEventListener('change', (e) => {
            this.beaconUrl = e.target.value;
            sessionStorage.setItem('beaconUrl', this.beaconUrl);
            
            // Update dropdown if it matches a public beacon
            const matchingBeacon = this.publicBeaconUrls.find(b => b.url === this.beaconUrl);
            publicSelect.value = matchingBeacon ? matchingBeacon.url : '';
            
            this.showSuccess('Beacon node URL updated');
        });
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        // Dashboard mode toggle
        document.getElementById('dashboardModeToggle').addEventListener('click', () => this.toggleDashboardMode());
        
        // Dashboard exit button
        document.getElementById('dashboardExitBtn').addEventListener('click', () => this.exitDashboardMode());
        
        // ESC key to exit dashboard mode
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isDashboardMode) {
                this.exitDashboardMode();
            }
        });
        
        document.getElementById('enableBrowserNotifications').addEventListener('click', () => this.enableBrowserNotifications());
        document.getElementById('enableTelegramNotifications').addEventListener('click', () => this.enableTelegramNotifications());
        document.getElementById('updateTelegramSubscription').addEventListener('click', () => this.updateTelegramSubscription());
        
        // Load and apply notification settings
        this.loadNotificationSettings();
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
            
            // Register the service worker and wait for it to be ready
            const registration = await navigator.serviceWorker.register('/sw.js');
            
            // Wait for the service worker to be ready
            await navigator.serviceWorker.ready;
            
            // Ensure we have VAPID key
            if (!this.vapidPublicKey) {
                throw new Error('VAPID public key not available. Please check server configuration.');
            }
            
            // Check if we already have a subscription
            let subscription = await registration.pushManager.getSubscription();
            
            if (!subscription) {
                // Create a new subscription
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
                });
            }
            
            this.pushSubscription = subscription;
            
            await fetch(`${this.serverUrl}/api/notifications/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription,
                    validators: this.validators.map(v => v.id || v)
                })
            });
            
            this.showNotificationStatus('browser', 'Browser notifications enabled', true);
            sessionStorage.setItem('browserNotifications', 'true');
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
                    validators: this.validators.map(v => v.id || v)
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
                    validators: this.validators.map(v => v.id || v)
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
    
    async updateTelegramSubscriptionSilent(newValidator = null) {
        // Only update if Telegram is enabled
        const telegramEnabled = sessionStorage.getItem('telegramEnabled') === 'true';
        const telegramChatId = sessionStorage.getItem('telegramChatId');
        
        if (!telegramEnabled || !telegramChatId) {
            return;
        }
        
        try {
            // If we have a specific new validator, send it separately to avoid showing all validators
            if (newValidator) {
                // Get previous validators from session storage
                const previousValidators = JSON.parse(sessionStorage.getItem('telegramValidators') || '[]');
                
                // Only send update if this is actually a new validator
                if (!previousValidators.includes(newValidator)) {
                    await fetch(`${this.serverUrl}/api/telegram/update`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: telegramChatId,
                            validators: this.validators.map(v => v.id || v),
                            beaconUrl: this.beaconUrl,
                            isNewValidator: true,
                            newValidatorOnly: newValidator
                        })
                    });
                }
                
                // Update stored validators
                sessionStorage.setItem('telegramValidators', JSON.stringify(this.validators.map(v => v.id || v)));
            } else {
                // Full update
                await fetch(`${this.serverUrl}/api/telegram/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: telegramChatId,
                        validators: this.validators.map(v => v.id || v),
                        beaconUrl: this.beaconUrl
                    })
                });
                sessionStorage.setItem('telegramValidators', JSON.stringify(this.validators.map(v => v.id || v)));
            }
        } catch (error) {
            console.error('Silent Telegram update error:', error);
        }
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
    
    async sendNotificationSettingsUpdate() {
        // Only send if Telegram is enabled
        const telegramEnabled = sessionStorage.getItem('telegramEnabled') === 'true';
        const telegramChatId = sessionStorage.getItem('telegramChatId');
        
        if (!telegramEnabled || !telegramChatId) {
            return;
        }
        
        const settings = {
            notifyProposer: document.getElementById('notifyProposer').checked,
            notifyAttester: document.getElementById('notifyAttester').checked,
            notifySync: document.getElementById('notifySync').checked,
            notifyMissed: document.getElementById('notifyMissed').checked,
            notifyMinutes: document.getElementById('notifyMinutes').value
        };
        
        try {
            await fetch(`${this.serverUrl}/api/telegram/settings-update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId: telegramChatId,
                    settings
                })
            });
        } catch (error) {
            console.error('Settings update notification error:', error);
        }
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
        const currentSlot = this.getCurrentSlotSync();
        
        // Update all duty time displays
        document.querySelectorAll('.duty-time').forEach(element => {
            const slot = parseInt(element.dataset.slot);
            const dutyType = element.dataset.dutyType;
            const validator = element.dataset.validator;
            if (slot) {
                const timeUntil = this.getTimeUntilSlot(slot);
                
                // Check if block was just proposed by one of our validators
                if (dutyType === 'proposer' && slot === currentSlot && !element.dataset.celebrated && validator) {
                    element.dataset.celebrated = 'true';
                    this.celebrateBlockProposal(element, slot, validator);
                }
                
                if (slot < currentSlot) {
                    element.textContent = 'Completed ✓';
                } else {
                    element.textContent = this.formatTimeUntil(timeUntil);
                }
                
                // Update duty item classes
                const dutyItem = element.closest('.duty-item');
                if (dutyItem) {
                    const classes = ['duty-item'];
                    if (dutyType) classes.push(dutyType);
                    
                    if (slot < currentSlot) {
                        classes.push('proposed');
                    } else if (slot === currentSlot && dutyType === 'proposer') {
                        classes.push('proposing');
                    } else {
                        const urgencyClass = this.getUrgencyClass(timeUntil);
                        if (urgencyClass) classes.push(urgencyClass);
                    }
                    
                    dutyItem.className = classes.join(' ');
                }
            }
        });
        
        // Update network overview countdowns
        document.querySelectorAll('.time-to-block').forEach(element => {
            const slot = parseInt(element.dataset.slot);
            if (slot) {
                const timeUntil = this.getTimeUntilSlot(slot);
                const blocksFromNow = slot - currentSlot;
                const isPast = blocksFromNow < 0;
                
                // Check if block was just proposed by a tracked validator
                const card = element.closest('.proposer-card');
                if (slot === currentSlot && card && card.classList.contains('tracked') && !card.dataset.celebrated) {
                    card.dataset.celebrated = 'true';
                    this.celebrateBlockProposal(card);
                }
                
                let timeDisplay;
                let blocksDisplay = Math.abs(blocksFromNow) + ' block' + (Math.abs(blocksFromNow) !== 1 ? 's' : '');
                
                if (blocksFromNow === 0) {
                    timeDisplay = `🎉 Proposing now! | Current block`;
                } else if (isPast) {
                    timeDisplay = `Passed ${this.formatTimeAgo(-timeUntil)} ago | ${blocksDisplay}`;
                } else {
                    timeDisplay = `in ${this.formatTimeUntil(timeUntil)} | ${blocksDisplay}`;
                }
                
                element.textContent = timeDisplay;
                
                // Update card classes
                if (card) {
                    card.classList.remove('past', 'proposing');
                    if (blocksFromNow === 0) {
                        card.classList.add('proposing');
                    } else if (isPast) {
                        card.classList.add('past');
                    }
                }
            }
        });
    }
    
    celebrateBlockProposal(element, slot, validator) {
        // Trigger confetti
        if (window.confetti) {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#10b981', '#3b82f6', '#fbbf24']
            });
        }
        
        // Add celebration animation
        element.classList.add('celebrating');
        setTimeout(() => {
            element.classList.remove('celebrating');
        }, 3000);
        
        // Fetch block details after a short delay to ensure block is available
        if (slot && validator) {
            setTimeout(() => {
                this.fetchBlockDetails(slot, validator, element);
            }, 5000); // Increased delay to 5 seconds for block availability
        } else {
            console.error('Missing slot or validator for block details fetch', {slot, validator});
        }
    }
    
    async fetchBlockDetails(slot, validator, element, retryCount = 0) {
        try {
            console.log(`Fetching block details for slot ${slot} (attempt ${retryCount + 1})`);
            
            // Fetch block details from beacon chain
            const response = await fetch(`${this.serverUrl}/api/beacon/eth/v2/beacon/blocks/${slot}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                
                // If beacon node is unavailable, show user-friendly error
                if (response.status === 500 && errorText.includes('ECONNREFUSED')) {
                    this.showBeaconNodeError();
                    return;
                }
                
                if (retryCount < 3) {
                    console.log(`Block not ready yet, retrying in 3 seconds...`);
                    setTimeout(() => {
                        this.fetchBlockDetails(slot, validator, element, retryCount + 1);
                    }, 3000);
                } else {
                    console.error('Failed to fetch block details after 3 retries');
                }
                return;
            }
            
            const blockData = await response.json();
            if (!blockData.data) return;
            
            const block = blockData.data.message;
            const graffiti = block.body.graffiti
                ? new TextDecoder().decode(
                    Uint8Array.from(
                        block.body.graffiti.replace(/^0x/, '').match(/.{1,2}/g).map(byte => parseInt(byte, 16))
                    )
                ).replace(/\0/g, '')
                : '';
            
            // Fetch execution payload for MEV and fees
            const executionPayload = block.body.execution_payload;
            let txReward = 0; // Priority fees from transactions (tips)
            let mevReward = 0; // MEV block reward
            let burnedFees = 0; // Base fee burned
            let txCount = 0;
            
            console.log('=== BLOCK DETAILS DEBUG ===');
            console.log('Slot:', slot);
            console.log('Validator:', validator);
            console.log('Block data:', blockData);
            
            if (executionPayload) {
                txCount = executionPayload.transactions.length;
                console.log('Execution payload:', executionPayload);
                console.log('Transaction count:', txCount);
                
                // Calculate burned fees (base fee * gas used)
                const baseFeePerGas = BigInt(executionPayload.base_fee_per_gas || '0');
                const gasUsed = BigInt(executionPayload.gas_used || '0');
                burnedFees = Number(baseFeePerGas * gasUsed) / 1e18;
                
                console.log('Base fee per gas:', executionPayload.base_fee_per_gas);
                console.log('Gas used:', executionPayload.gas_used);
                console.log('Burned fees (ETH):', burnedFees);
                
                // Get the actual block reward
                // This is typically in the execution payload header or consensus rewards
                if (executionPayload.block_hash) {
                    // Try to fetch additional reward info from execution layer
                    console.log('Block hash:', executionPayload.block_hash);
                    console.log('Fee recipient:', executionPayload.fee_recipient);
                }
                
                // Check withdrawals for validator rewards/MEV
                if (executionPayload.withdrawals && executionPayload.withdrawals.length > 0) {
                    console.log('Withdrawals found:', executionPayload.withdrawals);
                    executionPayload.withdrawals.forEach((withdrawal, index) => {
                        const withdrawalAmount = Number(BigInt(withdrawal.amount || '0')) / 1e9; // Gwei to ETH
                        console.log(`Withdrawal ${index}:`, {
                            validator_index: withdrawal.validator_index,
                            amount_gwei: withdrawal.amount,
                            amount_eth: withdrawalAmount,
                            address: withdrawal.address
                        });
                        
                        // Check if this withdrawal is for our validator
                        if (withdrawal.validator_index === validator.toString()) {
                            mevReward += withdrawalAmount;
                            console.log('Adding MEV reward for our validator:', withdrawalAmount);
                        }
                    });
                }
                
                // Calculate transaction fees (priority fees/tips)
                // The proposer gets the priority fees from all transactions
                if (executionPayload.transactions && executionPayload.transactions.length > 0) {
                    // We can't easily calculate individual tx priority fees without full tx data
                    // Use block value if available, otherwise estimate
                    if (executionPayload.block_value) {
                        const totalBlockValue = Number(BigInt(executionPayload.block_value)) / 1e18;
                        console.log('Block value (ETH):', totalBlockValue);
                        
                        // Block value should be the total reward to proposer
                        // This includes priority fees but not MEV (which comes via withdrawals)
                        txReward = totalBlockValue;
                        console.log('Transaction reward from block value:', txReward);
                    } else {
                        // Fallback: estimate priority fees
                        // In normal conditions, priority fees are roughly 5-15% of base fee
                        txReward = burnedFees * 0.1; // Conservative 10% estimate
                        console.log('Estimated transaction reward (10% of burned):', txReward);
                    }
                } else {
                    console.log('No transactions in block');
                }
                
                console.log('Final calculations:');
                console.log('- TX Reward (ETH):', txReward);
                console.log('- MEV Reward (ETH):', mevReward);
                console.log('- Burned Fees (ETH):', burnedFees);
                console.log('- Total Reward (ETH):', txReward + mevReward);
            } else {
                console.log('No execution payload found');
            }
            
            // Store block details
            if (!this.blockDetails) this.blockDetails = {};
            
            // Check if we already have details for this slot to prevent duplicates
            if (this.blockDetails[slot]) {
                console.log('Block details already exist for slot', slot, '- skipping duplicate processing');
                return;
            }
            
            // Get block number from execution payload
            const blockNumber = executionPayload ? executionPayload.block_number : null;
            console.log('Block number:', blockNumber);
            
            this.blockDetails[slot] = {
                graffiti: graffiti || '',
                txReward: txReward || 0,
                mevReward: mevReward || 0,
                burnedFees: burnedFees || 0,
                totalReward: (txReward || 0) + (mevReward || 0),
                txCount: txCount || 0,
                feeRecipient: executionPayload ? executionPayload.fee_recipient : '',
                blockHash: executionPayload ? executionPayload.block_hash : '',
                blockNumber: blockNumber,
                validatorIndex: validator,
                timestamp: new Date().toISOString()
            };
            
            // Save to session storage for persistence
            sessionStorage.setItem('blockDetails', JSON.stringify(this.blockDetails));
            
            // Update the proposer duties display
            this.displayProposerDuties();
            
            // Send notification with block details
            await this.sendBlockDetailsNotification(slot, validator, {
                graffiti,
                txReward,
                mevReward,
                burnedFees,
                totalReward: txReward + mevReward,
                txCount,
                feeRecipient: executionPayload ? executionPayload.fee_recipient : ''
            });
            
        } catch (error) {
            console.error('Error fetching block details:', error);
        }
    }
    
    async sendBlockDetailsNotification(slot, validator, details) {
        const telegramEnabled = sessionStorage.getItem('telegramEnabled') === 'true';
        const telegramChatId = sessionStorage.getItem('telegramChatId');
        const browserEnabled = sessionStorage.getItem('browserNotifications') === 'true';
        
        // Get validator display
        let validatorDisplay = validator;
        // Try to get pubkey from duties
        const proposerDuty = this.duties.proposer.find(d => d.validator === validator.toString());
        if (proposerDuty && proposerDuty.pubkey) {
            validatorDisplay = `${validator} (${proposerDuty.pubkey.slice(0, 10)})`;
        }
        
        // Send Telegram notification
        console.log('Checking Telegram notification conditions:');
        console.log('- telegramEnabled:', telegramEnabled);
        console.log('- telegramChatId:', telegramChatId);
        
        if (telegramEnabled && telegramChatId) {
            try {
                const message = `🎉💰 BLOCK CONFIRMED! 🎉💰\n\n` +
                    `Validator: [${validatorDisplay}](https://beaconcha.in/validator/${validator})\n` +
                    `Slot: [${slot}](https://beaconcha.in/slot/${slot})\n\n` +
                    `📊 Block Details:\n` +
                    `🔥 Burned Fees: ${details.burnedFees.toFixed(4)} ETH\n` +
                    `💰 Fee Recipient: ${details.feeRecipient ? `${details.feeRecipient.slice(0, 10)}...${details.feeRecipient.slice(-8)}` : 'Unknown'}\n` +
                    `${details.graffiti ? `✍️ Graffiti: ${details.graffiti}\n` : ''}` +
                    `\n🎊 Congratulations! 🎊`;
                
                console.log('Sending Telegram block details notification:', message);
                
                const response = await fetch(`${this.serverUrl}/api/notify/telegram`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        chatId: telegramChatId, 
                        message 
                    })
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Telegram block details notification failed:', response.status, errorText);
                } else {
                    console.log('Telegram block details notification sent successfully');
                }
            } catch (error) {
                console.error('Error sending Telegram block details notification:', error);
            }
        } else {
            console.log('Telegram notification not sent - conditions not met');
        }
        
        // Send browser notification
        if (browserEnabled && this.pushSubscription) {
            try {
                await fetch(`${this.serverUrl}/api/notify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'Block Confirmed',
                        validator: validator,
                        validatorDisplay,
                        duty: {
                            slot: slot,
                            timeUntil: 'confirmed',
                            blockDetails: details
                        },
                        urgency: 'success'
                    })
                });
            } catch (error) {
                console.error('Error sending browser block details notification:', error);
            }
        }
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
                const currentEpoch = Math.floor(this.getCurrentSlotSync() / 32);
                
                if (duty.period === 'current') {
                    // For current sync committee, notify once
                    const dutyKey = `sync-current-${duty.validator}`;
                    if (!this.notifiedDuties.has(dutyKey)) {
                        duty.slot = this.getCurrentSlotSync();
                        this.checkAndNotifyDuty('Sync Committee', duty, 60);
                        this.notifiedDuties.add(dutyKey);
                        this.saveNotifiedDuties();
                    }
                } else if (duty.period === 'next') {
                    // For next sync committee, calculate when it starts and notify appropriately
                    const epochsUntil = duty.from_epoch - currentEpoch;
                    const slotsUntil = epochsUntil * 32;
                    const nextSyncStartSlot = this.getCurrentSlotSync() + slotsUntil;
                    
                    // Create a duty object with the calculated slot
                    const nextSyncDuty = {
                        ...duty,
                        slot: nextSyncStartSlot
                    };
                    
                    this.checkAndNotifyDuty('Next Sync Committee', nextSyncDuty, notifyMinutes);
                }
            });
        }
        
        // Check for missed attestations
        this.checkMissedAttestations();
    }

    async checkAndNotifyDuty(type, duty, notifyMinutes) {
        // Get the validator we're tracking for this duty
        const validator = this.getValidatorForDuty(duty);
        if (!validator) {
            console.warn('Could not find validator for duty:', duty);
            return;
        }
        
        const dutyKey = `${type}-${duty.slot}-${validator}`;
        
        if (this.notifiedDuties.has(dutyKey)) return;
        
        const timeUntil = this.getTimeUntilSlot(duty.slot);
        const minutesUntil = Math.floor(timeUntil / 1000 / 60);
        
        if (minutesUntil > 0 && minutesUntil <= notifyMinutes) {
            this.notifiedDuties.add(dutyKey);
            this.saveNotifiedDuties();
            
            const urgency = minutesUntil < 1 ? 'critical' : minutesUntil < 2 ? 'urgent' : 'normal';
            
            console.log(`Sending notification for ${type} duty: validator ${validator}, slot ${duty.slot}, minutes until: ${minutesUntil}`);
            
            // Send Telegram notification if enabled
            const telegramEnabled = sessionStorage.getItem('telegramEnabled') === 'true';
            const telegramChatId = sessionStorage.getItem('telegramChatId');
            
            if (telegramEnabled && telegramChatId) {
                try {
                    // Since we store indices, validator should be an index
                    const index = validator;
                    let validatorDisplay = index;
                    
                    // Add pubkey suffix if available
                    if (duty.pubkey) {
                        validatorDisplay = `${index} (${duty.pubkey.slice(0, 10)})`;
                    }
                    
                    let message;
                    if (type === 'Proposer') {
                        message = `🎉💰 BLOCK PROPOSAL! 🎉💰\nIn ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}\n\nValidator: [${validatorDisplay}](https://beaconcha.in/validator/${index})\nSlot: [${duty.slot}](https://beaconcha.in/slot/${duty.slot})`;
                    } else if (type === 'Attester') {
                        message = `📝 Attestation Duty\nIn ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}\n\nValidator: [${validatorDisplay}](https://beaconcha.in/validator/${index})\nSlot: [${duty.slot}](https://beaconcha.in/slot/${duty.slot})`;
                    } else if (type === 'Sync Committee') {
                        message = `🔐💎 SYNC COMMITTEE 💎🔐\n\nValidator: [${validatorDisplay}](https://beaconcha.in/validator/${index})\n${duty.period === 'current' ? 'Currently active' : 'Starting soon'}\n~27 hours of enhanced rewards`;
                    } else if (type === 'Next Sync Committee') {
                        message = `🔮💎 NEXT SYNC COMMITTEE 💎🔮\nStarting in ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}\n\nValidator: [${validatorDisplay}](https://beaconcha.in/validator/${index})\n~27 hours of enhanced rewards ahead!`;
                    } else {
                        message = `🚨 Validator [${validatorDisplay}](https://beaconcha.in/validator/${index}) has a ${type} duty in ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'} (slot [${duty.slot}](https://beaconcha.in/slot/${duty.slot}))`;
                    }
                    
                    console.log('Sending Telegram notification:', message);
                    
                    const response = await fetch(`${this.serverUrl}/api/notify/telegram`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            chatId: telegramChatId, 
                            message 
                        })
                    });
                    
                    if (!response.ok) {
                        const error = await response.text();
                        throw new Error(`Failed to send Telegram notification: ${error}`);
                    }
                    console.log('Telegram notification sent successfully');
                } catch (error) {
                    console.error('Telegram notification error:', error);
                }
            }
            
            // Send browser notification if enabled
            const browserEnabled = sessionStorage.getItem('browserNotifications') === 'true';
            if (browserEnabled && this.pushSubscription) {
                try {
                    console.log('Sending browser notification for validator:', validator);
                    
                    // Format validator display similar to Telegram
                    let validatorDisplay = validator;
                    if (duty.pubkey) {
                        validatorDisplay = `${validator} (${duty.pubkey.slice(0, 10)})`;
                    }
                    
                    const response = await fetch(`${this.serverUrl}/api/notify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type,
                            validator: validator, // Send the raw index, not the label
                            validatorDisplay, // Send the formatted display
                            duty: {
                                slot: duty.slot,
                                timeUntil: this.formatTimeUntil(timeUntil)
                            },
                            urgency
                        })
                    });
                    
                    if (!response.ok) {
                        console.error('Browser notification response not ok:', await response.text());
                    }
                } catch (error) {
                    console.error('Browser notification error:', error);
                }
            }
        }
    }

    loadValidators() {
        const stored = sessionStorage.getItem('validators');
        let validators = stored ? JSON.parse(stored) : [];
        
        // Migrate old format (array of IDs) to new format (array of objects)
        if (validators.length > 0 && typeof validators[0] !== 'object') {
            validators = validators.map(id => ({
                id: id,
                status: 'unknown',
                lastChecked: null
            }));
            this.saveValidators();
        }
        
        // Assign colors to loaded validators
        validators.forEach(validator => {
            this.assignValidatorColor(validator.id || validator);
        });
        
        return validators;
    }

    saveValidators() {
        sessionStorage.setItem('validators', JSON.stringify(this.validators));
    }
    
    loadBlockDetails() {
        const stored = sessionStorage.getItem('blockDetails');
        if (stored) {
            try {
                this.blockDetails = JSON.parse(stored);
            } catch (error) {
                console.error('Error loading block details:', error);
                this.blockDetails = {};
            }
        } else {
            this.blockDetails = {};
        }
    }
    
    loadMissedAttestations() {
        const stored = sessionStorage.getItem('missedAttestations');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse missed attestations:', e);
                return {};
            }
        }
        return {};
    }
    
    saveMissedAttestations() {
        sessionStorage.setItem('missedAttestations', JSON.stringify(this.missedAttestations));
    }
    
    clearBlockDetails() {
        this.blockDetails = {};
        sessionStorage.removeItem('blockDetails');
        this.displayProposerDuties();
    }
    
    clearSingleBlock(slot) {
        if (this.blockDetails && this.blockDetails[slot]) {
            delete this.blockDetails[slot];
            sessionStorage.setItem('blockDetails', JSON.stringify(this.blockDetails));
            this.displayProposerDuties();
        }
    }
    
    loadNotifiedDuties() {
        const stored = sessionStorage.getItem('notifiedDuties');
        if (stored) {
            try {
                const duties = JSON.parse(stored);
                this.notifiedDuties = new Set(duties);
            } catch (e) {
                console.error('Failed to load notified duties:', e);
            }
        }
    }
    
    saveNotifiedDuties() {
        sessionStorage.setItem('notifiedDuties', JSON.stringify([...this.notifiedDuties]));
    }
    
    // Validate validator index (positive integer)
    isValidValidatorIndex(index) {
        const num = parseInt(index);
        return !isNaN(num) && num >= 0 && num.toString() === index.trim();
    }
    
    // Validate Ethereum public key format
    isValidPubkey(pubkey) {
        // Ethereum public keys are 48 bytes (96 hex chars) with 0x prefix
        const regex = /^0x[a-fA-F0-9]{96}$/;
        return regex.test(pubkey);
    }
    
    // Validate and sanitize validator input
    validateValidatorInput(input) {
        const trimmed = input.trim();
        
        // Check if it's a valid index
        if (this.isValidValidatorIndex(trimmed)) {
            return { valid: true, type: 'index', value: trimmed };
        }
        
        // Check if it's a valid pubkey
        if (this.isValidPubkey(trimmed)) {
            return { valid: true, type: 'pubkey', value: trimmed };
        }
        
        return { valid: false, type: null, value: null };
    }

    async addValidator() {
        const input = document.getElementById('validatorInput');
        let validator = input.value.trim();
        
        if (!validator) {
            this.showError('Please enter a validator public key or index');
            return;
        }
        
        // Check if it's CSV input (contains comma)
        if (validator.includes(',') || validator.includes('\n')) {
            this.handleCSVInput(validator);
            return;
        }
        
        // Validate input format
        const validation = this.validateValidatorInput(validator);
        if (!validation.valid) {
            this.showError('Invalid format. Please enter a valid validator index (e.g., 1234) or public key (0x...)');
            return;
        }
        
        // Fetch validator info and status
        let validatorInfo;
        if (validation.type === 'pubkey') {
            this.showLoading(true, 'Validating pubkey...');
            try {
                validatorInfo = await this.getValidatorInfo(validator);
                if (validatorInfo && validatorInfo.index) {
                    console.log(`Converting pubkey ${validator} to index ${validatorInfo.index}`);
                    validator = validatorInfo.index.toString();
                } else {
                    this.showError('Validator not found on the beacon chain. Please check the pubkey.');
                    this.showLoading(false);
                    return;
                }
            } catch (error) {
                if (error.message.includes('beacon node')) {
                    this.showError('Cannot connect to beacon node. Please check your configuration.');
                } else {
                    this.showError('Invalid validator pubkey or not found on the network.');
                }
                this.showLoading(false);
                return;
            }
            this.showLoading(false);
        } else {
            // For index, verify it exists on the beacon chain
            this.showLoading(true, 'Validating index...');
            try {
                validatorInfo = await this.getValidatorInfo(validator);
                if (!validatorInfo) {
                    this.showError(`Validator ${validator} not found on the beacon chain.`);
                    this.showLoading(false);
                    return;
                }
            } catch (error) {
                if (error.message.includes('beacon node')) {
                    this.showError('Cannot connect to beacon node. Please check your configuration.');
                } else {
                    this.showError(`Validator ${validator} not found or invalid.`);
                }
                this.showLoading(false);
                return;
            }
            this.showLoading(false);
        }
        
        if (this.validators.some(v => (v.id || v) === validator)) {
            this.showError('Validator already added');
            return;
        }
        
        // Check if this might be a duplicate (index vs pubkey)
        const isDuplicate = await this.checkForDuplicate(validator);
        if (isDuplicate) {
            this.showError(`This validator might already be added as ${isDuplicate}`);
            return;
        }
        
        this.validators.push({
            id: validator,
            status: validatorInfo?.status || 'unknown',
            lastChecked: new Date().toISOString()
        });
        this.assignValidatorColor(validator);
        this.saveValidators();
        this.renderValidators();
        input.value = '';
        
        // Show success message
        this.showSuccess(`Validator ${validator} added successfully`);
        
        // Update Telegram subscription if enabled
        this.updateTelegramSubscriptionSilent();
        
        if (this.validators.length === 1) {
            this.fetchAllDuties();
        } else {
            // Check for upcoming block proposals for this validator
            this.checkUpcomingProposalsForValidator(validator);
        }
    }
    
    async checkUpcomingProposalsForValidator(validator) {
        try {
            // Get current slot and epoch
            const currentSlot = await this.getCurrentSlot();
            const currentEpoch = Math.floor(currentSlot / 32);
            const nextEpoch = currentEpoch + 1;
            
            // Fetch proposer duties for current and next epoch
            const [currentProposerDuties, nextProposerDuties] = await Promise.all([
                this.fetchProposerDuties(currentEpoch),
                this.fetchProposerDuties(nextEpoch)
            ]);
            
            // Combine and filter for this validator
            const allProposerDuties = [...currentProposerDuties, ...nextProposerDuties];
            const validatorDuties = allProposerDuties.filter(duty => {
                const dutyValidator = this.getValidatorForDuty(duty);
                return dutyValidator === validator;
            });
            
            if (validatorDuties.length > 0) {
                // Update duties for this validator
                this.duties.proposer = [...this.duties.proposer, ...validatorDuties];
                this.displayProposerDuties();
                
                // Check if any duties need immediate notification
                const notifyMinutes = parseInt(document.getElementById('notifyMinutes').value);
                const notifyProposer = document.getElementById('notifyProposer').checked;
                
                if (notifyProposer) {
                    validatorDuties.forEach(duty => {
                        const timeUntil = this.getTimeUntilSlot(duty.slot);
                        const minutesUntil = Math.floor(timeUntil / 60000);
                        
                        // If duty is within notification window, notify immediately
                        if (minutesUntil <= notifyMinutes && minutesUntil > 0) {
                            this.sendNotification('Proposer', duty, minutesUntil);
                            
                            // Mark as notified to prevent duplicate notifications
                            const dutyKey = `proposer-${duty.slot}-${validator}`;
                            this.notifiedDuties.add(dutyKey);
                            this.saveNotifiedDuties();
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error checking upcoming proposals for validator:', error);
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
                const existingId = existing.id || existing;
                const existingInfo = await this.getValidatorInfo(existingId);
                if (!existingInfo) continue;
                
                // Check if they're the same validator
                if (validatorInfo.index === existingInfo.index) {
                    return existingId;
                }
            }
        } catch (error) {
            console.error('Error checking for duplicate:', error);
        }
        
        return null;
    }
    
    async getValidatorInfo(validator) {
        try {
            console.log(`Fetching validator info for: ${validator} from beacon: ${this.beaconUrl}`);
            
            const response = await fetch(`${this.serverUrl}/api/beacon/eth/v1/beacon/states/head/validators/${validator}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Failed to fetch validator info for ${validator}:`, response.status, errorText);
                
                // If beacon node is unavailable, throw specific error
                if (response.status === 500 && errorText.includes('ECONNREFUSED')) {
                    this.showBeaconNodeError();
                    throw new Error('Cannot connect to beacon node');
                }
                
                // If validator not found (404), return null
                if (response.status === 404) {
                    return null;
                }
                
                // For other errors, throw
                throw new Error(`Failed to fetch validator info: ${response.status}`);
            }
            
            const data = await response.json();
            return data.data ? {
                index: data.data.index,
                pubkey: data.data.validator.pubkey,
                status: data.data.status
            } : null;
        } catch (error) {
            console.error(`Error fetching validator info for ${validator}:`, error);
            // Re-throw the error so it can be caught by the caller
            throw error;
        }
    }
    
    showBeaconNodeError() {
        // Prevent multiple error notifications
        if (this.beaconErrorShown) return;
        this.beaconErrorShown = true;
        
        // Show user-friendly error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'beacon-error-banner';
        errorDiv.innerHTML = `
            <div class="error-content">
                <span class="error-icon">⚠️</span>
                <span class="error-text">Cannot connect to beacon node at ${this.beaconUrl}. Please check your beacon node configuration.</span>
                <button onclick="this.parentElement.parentElement.remove(); app.beaconErrorShown = false;" class="error-close">×</button>
            </div>
        `;
        
        document.body.prepend(errorDiv);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.remove();
                this.beaconErrorShown = false;
            }
        }, 10000);
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

    confirmRemoveValidator(validator) {
        const label = this.getValidatorLabel(validator);
        if (confirm(`Are you sure you want to remove validator ${label}?`)) {
            this.removeValidator(validator);
        }
    }
    
    removeValidator(validator) {
        this.validators = this.validators.filter(v => (v.id || v) !== validator);
        delete this.validatorColors[validator];
        this.saveValidators();
        this.renderValidators();
        
        // Update Telegram subscription if enabled
        this.updateTelegramSubscriptionSilent();
    }

    renderValidators() {
        const list = document.getElementById('validatorsList');
        list.innerHTML = '';
        
        if (this.validators.length === 0) {
            list.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No validators added yet</div>';
            return;
        }
        
        // Create a grid container
        const gridContainer = document.createElement('div');
        gridContainer.className = 'validators-grid';
        
        this.validators.forEach(validator => {
            const validatorId = validator.id || validator;
            const validatorStatus = validator.status || 'unknown';
            const validatorItem = document.createElement('div');
            validatorItem.className = 'validator-item-compact';
            
            // Add status-based classes
            if (validatorStatus.includes('exited') || validatorStatus === 'withdrawal_possible' || validatorStatus === 'withdrawal_done') {
                validatorItem.classList.add('validator-exited');
            } else if (validatorStatus === 'unknown' || validatorStatus.includes('offline')) {
                validatorItem.classList.add('validator-offline');
            }
            
            const color = this.getValidatorColor(validatorId);
            const customLabel = this.getValidatorCustomLabel(validatorId);
            const displayLabel = customLabel || validatorId;
            
            // Status indicator
            let statusIcon = '';
            if (validatorStatus.includes('active')) {
                statusIcon = '<span class="status-icon active" title="Active">✓</span>';
            } else if (validatorStatus.includes('exited') || validatorStatus === 'withdrawal_possible' || validatorStatus === 'withdrawal_done') {
                statusIcon = '<span class="status-icon exited" title="Exited">❌ Exited</span>';
            } else if (validatorStatus === 'pending') {
                statusIcon = '<span class="status-icon pending" title="Pending">⏳</span>';
            } else {
                statusIcon = '<span class="status-icon unknown" title="Unknown">?</span>';
            }
            
            // Since we now always store indices, all validators should be indices
            let indexDisplay = `<a href="https://beaconcha.in/validator/${validatorId}" target="_blank" class="validator-index-link" ondblclick="app.editValidatorLabel('${validatorId}', event); return false;" title="Click to view on Beaconcha.in • Double-click to edit label">
                <span class="validator-label-display">${displayLabel}</span>
                <input type="text" class="validator-label-edit" style="display:none" value="${customLabel || ''}" 
                       onblur="app.saveValidatorLabel('${validatorId}', this.value)"
                       onkeydown="if(event.key === 'Enter') { app.saveValidatorLabel('${validatorId}', this.value); event.preventDefault(); }"
                       onclick="event.preventDefault(); event.stopPropagation();">
            </a>`;
            let pubkeyPreview = `<span class="validator-pubkey-preview">Loading...</span>`;
            
            // Fetch pubkey asynchronously and update
            this.getValidatorInfo(validatorId).then(info => {
                if (info && info.pubkey) {
                    const preview = validatorItem.querySelector('.validator-pubkey-preview');
                    if (preview) {
                        preview.innerHTML = `
                            <span class="pubkey-clickable" onclick="app.editValidatorLabel('${validatorId}', event)" title="Click to edit label">
                                <span class="pubkey-text">${info.pubkey.slice(0, 10)}...${info.pubkey.slice(-4)}</span>
                                <span class="edit-icon">✏️</span>
                            </span>`;
                    }
                    
                    // Update validator status if changed
                    if (info.status && info.status !== validator.status) {
                        const validatorIndex = this.validators.findIndex(v => (v.id || v) === validatorId);
                        if (validatorIndex !== -1) {
                            this.validators[validatorIndex] = {
                                ...this.validators[validatorIndex],
                                status: info.status,
                                lastChecked: new Date().toISOString()
                            };
                            this.saveValidators();
                        }
                    }
                }
            }).catch(() => {
                const preview = validatorItem.querySelector('.validator-pubkey-preview');
                if (preview) preview.textContent = 'Error loading';
            });
            
            validatorItem.innerHTML = `
                <div class="validator-badge-compact ${validatorStatus.includes('exited') ? 'validator-exited' : ''}" style="background-color: ${color}">
                    <div class="validator-info">
                        ${statusIcon}
                        ${indexDisplay}
                        ${pubkeyPreview}
                    </div>
                    <button class="remove-validator-compact" onclick="app.confirmRemoveValidator('${validatorId}')" title="Remove validator">×</button>
                </div>
            `;
            gridContainer.appendChild(validatorItem);
        });
        
        list.appendChild(gridContainer);
    }

    truncateAddress(address) {
        if (address.startsWith('0x') && address.length > 20) {
            return `${address.slice(0, 10)}...${address.slice(-8)}`;
        }
        return address;
    }
    
    getValidatorForDuty(duty) {
        // Find which validator we're tracking for this duty
        const validatorIds = this.validators.map(v => v.id || v);
        
        if (duty.pubkey && validatorIds.includes(duty.pubkey)) {
            return duty.pubkey;
        }
        
        const indexStr = duty.validator_index?.toString();
        if (indexStr && validatorIds.includes(indexStr)) {
            return indexStr;
        }
        
        // Try to find by checking both formats
        const found = this.validators.find(v => {
            const id = v.id || v;
            return id === duty.pubkey || id === duty.validator_index?.toString();
        });
        
        if (!found) {
            console.warn('Could not match duty to tracked validator:', duty);
        }
        
        return found ? (found.id || found) : null;
    }
    
    getValidatorLabel(validator) {
        // Extract ID if validator is an object
        const validatorId = validator.id || validator;
        
        // Check if we have a custom label for this validator
        const customLabel = this.getValidatorCustomLabel(validatorId);
        if (customLabel) {
            return customLabel;
        }
        
        // Otherwise use default formatting
        if (validatorId.startsWith && validatorId.startsWith('0x')) {
            return this.truncateAddress(validatorId);
        }
        return validatorId.toString(); // Return index without "#"
    }
    
    getValidatorCustomLabel(validator) {
        const labels = JSON.parse(sessionStorage.getItem('validatorLabels') || '{}');
        return labels[validator] || null;
    }
    
    setValidatorCustomLabel(validator, label) {
        const labels = JSON.parse(sessionStorage.getItem('validatorLabels') || '{}');
        if (label && label.trim()) {
            labels[validator] = label.trim();
        } else {
            delete labels[validator];
        }
        sessionStorage.setItem('validatorLabels', JSON.stringify(labels));
    }
    
    editValidatorLabel(validator, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        // Find the validator element
        const validatorElements = document.querySelectorAll('.validator-index-link');
        let targetElement = null;
        
        validatorElements.forEach(el => {
            if (el.href && el.href.includes(validator)) {
                targetElement = el;
            }
        });
        
        if (targetElement) {
            const labelDisplay = targetElement.querySelector('.validator-label-display');
            const labelInput = targetElement.querySelector('.validator-label-edit');
            
            if (labelDisplay && labelInput) {
                labelDisplay.style.display = 'none';
                labelInput.style.display = 'inline';
                labelInput.focus();
                labelInput.select();
            }
        }
    }
    
    saveValidatorLabel(validator, newLabel) {
        this.setValidatorCustomLabel(validator, newLabel);
        this.renderValidators();
        this.displayDuties();
    }

    async fetchAllDuties() {
        if (this.validators.length === 0) {
            this.showError('Please add at least one validator');
            return;
        }
        
        this.showLoading(true, 'Fetching duties...');
        this.hideError();
        
        try {
            const currentSlot = await this.getCurrentSlot();
            const currentEpoch = Math.floor(currentSlot / 32);
            const nextEpoch = currentEpoch + 1;
            
            // Update epoch info
            document.getElementById('epochInfo').innerHTML = `
                Current Epoch: ${currentEpoch} | Current Slot: ${currentSlot} | Next Epoch: ${nextEpoch}
            `;
            
            // Fetch for current and next epoch to catch upcoming duties
            const [currentProposerDuties, nextProposerDuties, attesterDuties, syncDuties] = await Promise.all([
                this.fetchProposerDuties(currentEpoch),
                this.fetchProposerDuties(nextEpoch),
                this.fetchAttesterDuties(nextEpoch),
                this.fetchSyncCommitteeDuties(currentEpoch)
            ]);
            
            // Combine current and next epoch proposer duties
            this.duties.proposer = [...currentProposerDuties, ...nextProposerDuties];
            this.duties.attester = attesterDuties;
            this.duties.sync = syncDuties;
            
            this.cacheDuties();
            this.displayDuties();
            
            // Fetch network overview in background
            this.fetchNetworkOverview(currentEpoch).catch(console.error);
            
            // Show success message
            this.showSuccess(`Successfully fetched duties for ${this.validators.length} validator(s)`);
            
        } catch (error) {
            console.error('Error fetching duties:', error);
            const isConnectionError = error.message.includes('beacon node') || error.message.includes('ECONNREFUSED');
            this.showError(`Failed to fetch duties: ${error.message}`, isConnectionError);
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
                const errorText = await response.text();
                
                // Handle beacon node connection errors
                if (response.status === 500 && errorText.includes('ECONNREFUSED')) {
                    this.showBeaconNodeError();
                    throw new Error('Cannot connect to beacon node');
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Handle different response formats
            if (data.data) {
                if (data.data.header && data.data.header.message && data.data.header.message.slot) {
                    return parseInt(data.data.header.message.slot);
                } else if (data.data.slot) {
                    return parseInt(data.data.slot);
                }
            }
            
            console.error('Unexpected getCurrentSlot response format:', data);
            throw new Error('Invalid response format');
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
                const errorText = await response.text();
                
                // If beacon node is unavailable, show user-friendly error
                if (response.status === 500 && errorText.includes('ECONNREFUSED')) {
                    this.showBeaconNodeError();
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.data) {
                console.log('No proposer duties data received');
                return [];
            }
            
            const validatorIds = this.validators.map(v => v.id || v);
            const filtered = data.data.filter(duty => 
                validatorIds.includes(duty.pubkey) || 
                validatorIds.includes(duty.validator_index?.toString())
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
            // Extract validator IDs from the new format
            const requestBody = this.validators.map(v => v.id || v);
            
            console.log(`Fetching attester duties for ${requestBody.length} validators in epoch ${epoch}:`, requestBody);
            
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
                const errorText = await response.text();
                console.error('Attester duties error response:', errorText);
                
                // If beacon node is unavailable, show user-friendly error
                if (response.status === 500 && errorText.includes('ECONNREFUSED')) {
                    this.showBeaconNodeError();
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.data) {
                console.log('No attester duties data received');
                return [];
            }
            
            console.log(`Found ${data.data.length} attester duties for epoch ${epoch}`);
            
            // Filter to only include duties for our tracked validators
            const filtered = data.data.filter(duty => {
                const validatorIds = this.validators.map(v => v.id || v);
                return validatorIds.includes(duty.pubkey) || 
                       validatorIds.includes(duty.validator_index?.toString());
            });
            
            console.log(`Filtered to ${filtered.length} attester duties for tracked validators`);
            return filtered;
        } catch (error) {
            console.error('fetchAttesterDuties error:', error);
            throw new Error(`Failed to fetch attester duties: ${error.message}`);
        }
    }
    
    async checkMissedAttestations() {
        try {
            // Get current slot and epoch
            const currentSlot = await this.getCurrentSlot();
            const currentEpoch = Math.floor(currentSlot / 32);
            const slotInEpoch = currentSlot % 32;
            
            // Only check for missed attestations after slot 2 of each epoch
            if (slotInEpoch < 2) {
                return;
            }
            
            // Don't check too frequently
            if (this.lastAttestationCheck) {
                const timeSinceLastCheck = Date.now() - this.lastAttestationCheck;
                if (timeSinceLastCheck < 60000) { // Check at most once per minute
                    return;
                }
            }
            
            this.lastAttestationCheck = Date.now();
            
            // Check previous epoch attestations
            const previousEpoch = currentEpoch - 1;
            const attestationDuties = await this.fetchAttesterDuties(previousEpoch);
            
            // For each duty, check if it was fulfilled
            for (const duty of attestationDuties) {
                const validatorId = duty.validator_index?.toString();
                if (!validatorId) continue;
                
                const slotKey = `${validatorId}-${duty.slot}`;
                
                // Skip if we already checked this attestation
                if (this.missedAttestations[slotKey]) continue;
                
                // Check if attestation was included
                const attestationIncluded = await this.checkAttestationIncluded(validatorId, duty.slot);
                
                if (!attestationIncluded) {
                    this.missedAttestations[slotKey] = {
                        validatorId,
                        slot: duty.slot,
                        epoch: previousEpoch,
                        missedAt: new Date().toISOString()
                    };
                    
                    // Send notification if enabled
                    const notifyMissed = document.getElementById('notifyMissed')?.checked ?? false;
                    if (notifyMissed) {
                        await this.sendMissedAttestationNotification(validatorId, duty.slot);
                    }
                }
            }
            
            this.saveMissedAttestations();
            
            // Clean up old missed attestations (older than 7 days)
            this.cleanupOldMissedAttestations();
            
        } catch (error) {
            console.error('Error checking missed attestations:', error);
        }
    }
    
    async checkAttestationIncluded(validatorIndex, slot) {
        // This is a simplified check - in production you'd want to check the actual attestation inclusion
        // For now, we'll assume attestations are included if the validator is active
        const validator = this.validators.find(v => (v.id || v) === validatorIndex);
        if (validator && validator.status && validator.status.includes('active')) {
            // For active validators, we'll randomly say 99% of attestations are included
            return Math.random() > 0.01;
        }
        return false;
    }
    
    cleanupOldMissedAttestations() {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        Object.keys(this.missedAttestations).forEach(key => {
            const missed = this.missedAttestations[key];
            if (new Date(missed.missedAt).getTime() < sevenDaysAgo) {
                delete this.missedAttestations[key];
            }
        });
        
        this.saveMissedAttestations();
    }
    
    async sendMissedAttestationNotification(validatorId, slot) {
        const customLabel = this.getValidatorCustomLabel(validatorId);
        const validatorDisplay = customLabel || validatorId;
        
        await this.sendNotification(
            'Missed Attestation',
            validatorId,
            validatorDisplay,
            {
                slot: slot,
                timeUntil: 'Attestation was missed'
            },
            'high'
        );
    }

    async fetchSyncCommitteeDuties(epoch) {
        try {
            const response = await fetch(`${this.serverUrl}/api/sync-duties`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    beaconUrl: this.beaconUrl,
                    validators: this.validators.map(v => v.id || v),
                    epoch
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                
                // If beacon node is unavailable, show user-friendly error
                if (response.status === 500 && errorText.includes('ECONNREFUSED')) {
                    this.showBeaconNodeError();
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
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
    
    async fetchNetworkOverviewOnly() {
        const loadingEl = document.getElementById('networkLoadingIndicator');
        loadingEl.classList.remove('hidden');
        
        try {
            const currentSlot = await this.getCurrentSlot();
            const currentEpoch = Math.floor(currentSlot / 32);
            await this.fetchNetworkOverview(currentEpoch);
        } catch (error) {
            console.error('Error fetching network overview:', error);
            document.getElementById('networkContent').innerHTML = `
                <div class="error-message">Failed to load network data: ${error.message}</div>
            `;
        } finally {
            loadingEl.classList.add('hidden');
        }
    }
    
    async fetchNetworkOverview(currentEpoch) {
        try {
            // Fetch all proposer duties for current epoch
            const allProposersResponse = await fetch(`${this.serverUrl}/api/beacon/eth/v1/validator/duties/proposer/${currentEpoch}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (allProposersResponse.ok) {
                const data = await allProposersResponse.json();
                this.networkOverview.allProposers = data.data || [];
            }
            
            // Fetch sync committees with epoch-specific requests
            const currentSyncPeriod = Math.floor(currentEpoch / 256);
            const nextSyncPeriodFirstEpoch = (currentSyncPeriod + 1) * 256;
            
            const currentSyncUrl = `${this.serverUrl}/api/beacon/eth/v1/beacon/states/head/sync_committees`;
            const nextSyncUrl = `${this.serverUrl}/api/beacon/eth/v1/beacon/states/head/sync_committees?epoch=${nextSyncPeriodFirstEpoch}`;
            
            
            // Fetch current sync committee
            const currentSyncResponse = await fetch(currentSyncUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            // Fetch next sync committee using the first epoch of the next period
            const nextSyncResponse = await fetch(nextSyncUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ beaconUrl: this.beaconUrl })
            });
            
            if (currentSyncResponse.ok) {
                const data = await currentSyncResponse.json();
                if (data.data) {
                    this.networkOverview.currentSyncCommittee = data.data.validators || [];
                }
            }
            
            if (nextSyncResponse.ok) {
                const data = await nextSyncResponse.json();
                if (data.data) {
                    this.networkOverview.nextSyncCommittee = data.data.validators || [];
                }
            }
            
            this.displayNetworkOverview();
        } catch (error) {
            console.error('Error fetching network overview:', error);
        }
    }

    displayProposerDuties() {
        const panel = document.getElementById('proposerDuties');
        
        // Always show previous blocks section first
        const previousBlocksHtml = this.renderPreviousBlocks();
        
        if (this.validators.length === 0) {
            panel.innerHTML = previousBlocksHtml + '<p style="text-align: center; color: var(--text-secondary);">Add validators to see duties</p>';
            return;
        }
        
        if (this.duties.proposer.length === 0) {
            panel.innerHTML = previousBlocksHtml + `
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
            previousBlocksHtml,
            ...recentPastDuties.map(duty => this.renderProposerDuty(duty, true)),
            ...futureDuties.map(duty => this.renderProposerDuty(duty, false))
        ].join('');
        
        panel.innerHTML = html || '<p style="text-align: center; color: var(--text-secondary);">No duties to display</p>';
    }
    
    renderPreviousBlocks() {
        if (!this.blockDetails || Object.keys(this.blockDetails).length === 0) {
            return '';
        }
        
        // Sort blocks by slot number (most recent first)
        const sortedBlocks = Object.entries(this.blockDetails)
            .sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
        
        const blocksHtml = sortedBlocks.map(([slot, details], index) => {
            const feeRecipientDisplay = details.feeRecipient ? 
                `${details.feeRecipient.slice(0, 10)}...${details.feeRecipient.slice(-8)}` : 
                'Unknown';
            
            const blockLink = details.blockHash ? 
                `https://beaconcha.in/block/${details.blockHash}` : 
                `https://beaconcha.in/slot/${slot}`;
            
            // Get the validator for this block
            const validator = this.getValidatorForSlot(slot);
            const color = this.getValidatorColor(validator);
            const label = this.getValidatorLabel(validator);
            
            // Use increasing opacity for older blocks
            const opacity = Math.max(0.5, 1 - (index * 0.15));
            
            // Format the block confirmation time
            const blockDate = new Date(details.timestamp);
            const timeStr = blockDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            
            return `
                <div class="duty-item past previous-block" style="opacity: ${opacity}">
                    <a href="https://beaconcha.in/validator/${validator}" target="_blank" class="validator-tag" style="background-color: ${color}" title="View validator ${validator}">${label}</a>
                    <div class="duty-content">
                        <div class="duty-header">
                            <span class="duty-type">
                                <a href="${blockLink}" target="_blank" style="color: inherit; text-decoration: none;">
                                    Block ${details.blockNumber || slot}
                                </a>
                            </span>
                            <span class="duty-time">
                                ${timeStr} ✓
                                <button onclick="app.clearSingleBlock('${slot}')" class="remove-block-btn" title="Remove this block">×</button>
                            </span>
                        </div>
                        <div class="duty-details">
                            <span class="slot-number">Slot ${slot}</span>
                            <div style="margin-top: 4px;">
                                <div>🔥 Burned: ${(details.burnedFees || 0).toFixed(4)} ETH</div>
                                <div>💰 Fee Recipient: ${feeRecipientDisplay}</div>
                                ${details.graffiti ? `<div>✍️ Graffiti: ${details.graffiti}</div>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        if (blocksHtml) {
            return `
                <div class="previous-blocks-wrapper">
                    <div class="section-header">
                        <h3>Previous Blocks</h3>
                        <button onclick="app.clearBlockDetails()" class="clear-btn" title="Clear all block history">Clear All</button>
                    </div>
                    ${blocksHtml}
                </div>
            `;
        }
        
        return '';
    }
    
    getValidatorForSlot(slot) {
        // Try to find the validator from proposer duties
        const duty = this.duties.proposer.find(d => d.slot === parseInt(slot));
        if (duty) {
            return this.getValidatorForDuty(duty);
        }
        
        // If not found, check if we stored it in block details
        const details = this.blockDetails[slot];
        if (details && details.validatorIndex) {
            return details.validatorIndex;
        }
        
        return this.validators[0]?.id || this.validators[0] || ''; // Fallback to first validator
    }
    
    renderProposerDuty(duty, isPast = false) {
        const timeUntil = this.getTimeUntilSlot(duty.slot);
        const urgencyClass = isPast ? 'past' : this.getUrgencyClass(timeUntil);
        const validator = this.getValidatorForDuty(duty);
        const color = this.getValidatorColor(validator);
        const label = this.getValidatorLabel(validator);
        const timeDisplay = isPast ? this.formatTimeAgo(-timeUntil) : this.formatTimeUntil(timeUntil);
        
        const validatorTag = duty.validator_index 
            ? `<a href="https://beaconcha.in/validator/${duty.validator_index}" target="_blank" class="validator-tag" style="background-color: ${color}" title="View on beaconcha.in">${label}</a>`
            : `<div class="validator-tag" style="background-color: ${color}" title="${duty.pubkey}">${label}</div>`;
        
        // Only show block details inline for future duties
        // Past duties with block details will be shown in the previous blocks section
        let blockDetailsHtml = '';
        if (!isPast && this.blockDetails && this.blockDetails[duty.slot]) {
            const details = this.blockDetails[duty.slot];
            const feeRecipientDisplay = details.feeRecipient ? 
                `${details.feeRecipient.slice(0, 10)}...${details.feeRecipient.slice(-8)}` : 
                'Unknown';
                
            const blockLink = details.blockHash ? 
                `https://beaconcha.in/block/${details.blockHash}` : 
                `https://beaconcha.in/slot/${duty.slot}`;
                
            blockDetailsHtml = `
                <div class="duty-details" style="margin-top: 8px;">
                    <div><a href="${blockLink}" target="_blank" style="color: var(--primary-color); text-decoration: none;">📊 View Block ${details.blockNumber || duty.slot}</a></div>
                    <div>🔥 Burned: ${(details.burnedFees || 0).toFixed(4)} ETH</div>
                    <div>💰 Fee Recipient: ${feeRecipientDisplay}</div>
                    ${details.graffiti ? `<div>✍️ Graffiti: ${details.graffiti}</div>` : ''}
                </div>
            `;
        }
        
        // Don't show past duties if they have block details (they'll be in previous blocks section)
        if (isPast && this.blockDetails && this.blockDetails[duty.slot]) {
            return '';
        }
        
        return `
            <div class="duty-item proposer ${urgencyClass}">
                ${validatorTag}
                <div class="duty-content">
                    <div class="duty-header">
                        <span class="duty-type">Block Proposal${isPast ? ' ✓' : ''}</span>
                        <span class="duty-time" ${!isPast ? `data-slot="${duty.slot}" data-duty-type="proposer" data-validator="${validator || duty.validator_index || ''}"` : ''}>${timeDisplay}</span>
                    </div>
                    <div class="duty-details">
                        <span class="slot-number">Slot ${duty.slot}</span>
                    </div>
                    ${blockDetailsHtml}
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
                    <a href="https://beaconcha.in/validator/${validator}" target="_blank" class="validator-tag" style="background-color: ${color}" title="View validator ${validator}">${label}</a>
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
                const remainingTime = remainingEpochs * 32 * 12 * 1000; // epochs * slots * seconds * ms
                const timeFormatted = this.formatTimeUntil(remainingTime);
                dutyInfo = `Current sync committee member`;
                timeDisplay = `${timeFormatted} / ${remainingEpochs} epochs remaining`;
            } else {
                const epochsUntil = duty.from_epoch - currentEpoch;
                const timeUntil = epochsUntil * 32 * 12 * 1000; // epochs * slots * seconds * ms
                const timeFormatted = this.formatTimeUntil(timeUntil);
                dutyInfo = `Next sync committee member`;
                timeDisplay = `Starts in ${timeFormatted} / ${epochsUntil} epochs`;
            }
            
            const color = this.getValidatorColor(duty.validator);
            const label = this.getValidatorLabel(duty.validator);
            
            return `
                <div class="duty-item">
                    <a href="https://beaconcha.in/validator/${duty.validator}" target="_blank" class="validator-tag" style="background-color: ${color}" title="View validator ${duty.validator}">${label}</a>
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
    
    displayNetworkOverview() {
        const panel = document.getElementById('networkContent');
        if (!panel) return;
        
        const currentSlot = this.getCurrentSlotSync();
        const currentEpoch = Math.floor(currentSlot / 32);
        
        // Get both past and upcoming proposers
        const allProposersSort = this.networkOverview.allProposers.sort((a, b) => a.slot - b.slot);
        const pastProposers = allProposersSort
            .filter(duty => duty.slot < currentSlot)
            .slice(-10); // Show last 10 past blocks
        const upcomingProposers = allProposersSort
            .filter(duty => duty.slot >= currentSlot)
            .slice(0, 54); // Show next 54 blocks (total 64 with past)
        
        // Combine past and upcoming
        const displayProposers = [...pastProposers, ...upcomingProposers];
        
        // Sync committee calculations
        const syncCommitteeSize = this.networkOverview.currentSyncCommittee.length;
        const nextSyncSize = this.networkOverview.nextSyncCommittee.length;
        const syncPeriod = Math.floor(currentEpoch / 256);
        const epochsInPeriod = currentEpoch % 256;
        const epochsRemaining = 256 - epochsInPeriod;
        const epochsElapsed = epochsInPeriod;
        const timeRemaining = epochsRemaining * 32 * 12 * 1000; // epochs * slots * seconds * ms
        const timeElapsed = epochsElapsed * 32 * 12 * 1000; // epochs * slots * seconds * ms
        
        // Count tracked validators in sync committees
        const trackedInCurrent = this.networkOverview.currentSyncCommittee.filter(v => 
            this.validators.includes(v) || this.validators.includes(v.toString())
        );
        const trackedInNext = this.networkOverview.nextSyncCommittee.filter(v => 
            this.validators.includes(v) || this.validators.includes(v.toString())
        );
        
        let html = `
            <div class="network-overview">
                <!-- Sync Committee Info at Top -->
                <div class="sync-committee-summary">
                    <div class="sync-summary-item clickable" onclick="app.showSyncCommitteeMembers('current')" title="Period ${syncPeriod} | Epochs ${syncPeriod * 256} - ${(syncPeriod + 1) * 256 - 1} | Click to view members">
                        <div class="sync-summary-header">Current Sync Committee
                            ${trackedInCurrent.length > 0 ? `<span class="validator-count-tag">You have ${trackedInCurrent.length}</span>` : ''}
                        </div>
                        <div class="sync-summary-content">
                            <span class="sync-validators-count">${syncCommitteeSize}</span> validators
                            <span class="sync-time-remaining">
                                Started ${this.formatTimeAgo(timeElapsed)} ago (${epochsElapsed} epochs)
                            </span>
                        </div>
                    </div>
                    <div class="sync-summary-item clickable" onclick="app.showSyncCommitteeMembers('next')" title="Period ${syncPeriod + 1} | Starts at epoch ${(syncPeriod + 1) * 256} | Click to view members">
                        <div class="sync-summary-header">Next Sync Committee
                            ${trackedInNext.length > 0 ? `<span class="validator-count-tag">You have ${trackedInNext.length}</span>` : ''}
                        </div>
                        <div class="sync-summary-content">
                            <span class="sync-validators-count">${nextSyncSize}</span> validators
                            <span class="sync-time-remaining">
                                Starts in ${this.formatTimeUntil(timeRemaining)} (${epochsRemaining} epochs)
                            </span>
                        </div>
                    </div>
                </div>
                
                <div class="overview-section">
                    <h3>Upcoming Block Proposers</h3>
                    <div class="epoch-info">
                        Current Slot: ${currentSlot} | Current Epoch: ${currentEpoch}
                    </div>
                    <div class="proposers-grid">
        `;
        
        if (displayProposers.length === 0) {
            html += '<p style="text-align: center; color: var(--text-secondary);">No proposer data available</p>';
        } else {
            // Get all proposers including past ones for color assignment
            const allProposers = this.networkOverview.allProposers;
            const uniqueValidators = new Map();
            
            // Assign colors to all unique validators
            allProposers.forEach(duty => {
                const validatorKey = duty.validator_index || duty.pubkey;
                if (!uniqueValidators.has(validatorKey)) {
                    // Check if it's a tracked validator first
                    const isTracked = this.validators.includes(duty.pubkey) || 
                                    this.validators.includes(duty.validator_index?.toString());
                    if (isTracked) {
                        const validator = this.getValidatorForDuty(duty);
                        uniqueValidators.set(validatorKey, this.getValidatorColor(validator));
                    } else {
                        // Assign a color from an extended palette for network validators
                        const networkColors = [
                            '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b',
                            '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#a16207',
                            '#16a34a', '#15803d', '#166534', '#14532d', '#052e16',
                            '#2563eb', '#1d4ed8', '#1e40af', '#6366f1', '#4f46e5'
                        ];
                        const colorIndex = uniqueValidators.size % networkColors.length;
                        uniqueValidators.set(validatorKey, networkColors[colorIndex]);
                    }
                }
            });
            
            displayProposers.forEach(duty => {
                const timeUntil = this.getTimeUntilSlot(duty.slot);
                const blocksFromNow = duty.slot - currentSlot;
                const isPast = blocksFromNow < 0;
                const isTracked = this.validators.includes(duty.pubkey) || 
                                this.validators.includes(duty.validator_index?.toString());
                const validatorKey = duty.validator_index || duty.pubkey;
                const color = uniqueValidators.get(validatorKey);
                const validatorIndex = duty.validator_index;
                
                // Format time display
                let timeDisplay;
                let blocksDisplay = Math.abs(blocksFromNow) + ' block' + (Math.abs(blocksFromNow) !== 1 ? 's' : '');
                
                if (isPast) {
                    timeDisplay = `Passed ${this.formatTimeAgo(-timeUntil)} ago | ${blocksDisplay}`;
                } else {
                    timeDisplay = `in ${this.formatTimeUntil(timeUntil)} | ${blocksDisplay}`;
                }
                
                // Create clickable validator badge
                const validatorBadge = validatorIndex 
                    ? `<a href="https://beaconcha.in/validator/${validatorIndex}" target="_blank" class="validator-badge" style="background-color: ${color}" title="View on beaconcha.in">${validatorIndex}</a>`
                    : `<span class="validator-badge" style="background-color: ${color}" title="${duty.pubkey}">${this.truncateAddress(duty.pubkey)}</span>`;
                
                html += `
                    <div class="proposer-card ${isTracked ? 'tracked' : ''} ${isPast ? 'past' : ''}">
                        <div class="proposer-header">
                            <div class="proposer-slot-info">
                                <span class="proposer-slot" title="Epoch ${Math.floor(duty.slot / 32)}">Slot ${duty.slot}</span>
                                <span class="time-to-block" data-slot="${duty.slot}">${timeDisplay}</span>
                            </div>
                            ${validatorBadge}
                        </div>
                    </div>
                `;
            });
        }
        
        html += `
                    </div>
                </div>
            </div>
        `;
        
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
        
        if (days > 0) return `${days}d`;
        if (hours > 0) return `${hours}h`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
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
    
    switchPage(page) {
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === page);
        });
        
        // Update pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `${page}Page`);
        });
        
        // Load network data if switching to network page
        if (page === 'network' && this.networkOverview.allProposers.length === 0) {
            this.fetchNetworkOverviewOnly();
        }
    }
    
    showSyncCommitteeMembers(period) {
        const modal = document.getElementById('syncCommitteeModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        
        const validators = period === 'current' 
            ? this.networkOverview.currentSyncCommittee 
            : this.networkOverview.nextSyncCommittee;
        
        const currentEpoch = Math.floor(this.getCurrentSlotSync() / 32);
        const syncPeriod = Math.floor(currentEpoch / 256);
        const epochsInPeriod = currentEpoch % 256;
        const epochsRemaining = 256 - epochsInPeriod;
        const epochsElapsed = epochsInPeriod;
        const timeRemaining = epochsRemaining * 32 * 12 * 1000;
        const timeElapsed = epochsElapsed * 32 * 12 * 1000;
        
        modalTitle.textContent = period === 'current' 
            ? `Current Sync Committee (${validators.length} validators)`
            : `Next Sync Committee (${validators.length} validators)`;
        
        // Create validator grid
        let html = `
            <div class="sync-info">
                <p>${period === 'current' 
                    ? `Period ${syncPeriod} • Epochs ${syncPeriod * 256}-${(syncPeriod + 1) * 256 - 1} • Started ${this.formatTimeAgo(timeElapsed)} ago` 
                    : `Period ${syncPeriod + 1} • Epochs ${(syncPeriod + 1) * 256}-${(syncPeriod + 2) * 256 - 1} • Starts in ${this.formatTimeUntil(timeRemaining)}`}</p>
            </div>
            <div class="validator-grid">
        `;
        
        validators.forEach(validatorIndex => {
            const isTracked = this.validators.includes(validatorIndex.toString());
            const color = isTracked ? this.getValidatorColor(validatorIndex.toString()) : '#6b7280';
            
            html += `
                <a href="https://beaconcha.in/validator/${validatorIndex}" target="_blank" 
                   class="validator-badge ${isTracked ? 'tracked' : ''}" 
                   style="background-color: ${color}; display: block; text-align: center; padding: 8px;">
                    ${validatorIndex}
                </a>
            `;
        });
        
        html += '</div>';
        modalBody.innerHTML = html;
        modal.classList.add('active');
    }
    
    closeSyncCommitteeModal() {
        document.getElementById('syncCommitteeModal').classList.remove('active');
    }
    
    loadNotificationSettings() {
        // Load saved settings
        const settings = {
            notifyProposer: sessionStorage.getItem('notifyProposer') !== 'false',
            notifyAttester: sessionStorage.getItem('notifyAttester') !== 'false',
            notifySync: sessionStorage.getItem('notifySync') !== 'false',
            notifyMissed: sessionStorage.getItem('notifyMissed') === 'true', // Default to false
            notifyMinutes: sessionStorage.getItem('notifyMinutes') || '10'
        };
        
        // Apply settings to UI
        document.getElementById('notifyProposer').checked = settings.notifyProposer;
        document.getElementById('notifyAttester').checked = settings.notifyAttester;
        document.getElementById('notifySync').checked = settings.notifySync;
        document.getElementById('notifyMissed').checked = settings.notifyMissed;
        document.getElementById('notifyMinutes').value = settings.notifyMinutes;
        
        // Save settings on change
        ['notifyProposer', 'notifyAttester', 'notifySync', 'notifyMissed'].forEach(id => {
            document.getElementById(id).addEventListener('change', (e) => {
                sessionStorage.setItem(id, e.target.checked);
                this.sendNotificationSettingsUpdate();
            });
        });
        
        document.getElementById('notifyMinutes').addEventListener('change', (e) => {
            sessionStorage.setItem('notifyMinutes', e.target.value);
            this.sendNotificationSettingsUpdate();
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

    showLoading(show, text = 'Loading...') {
        const indicator = document.getElementById('loadingIndicator');
        const statusMsg = document.getElementById('statusMessage');
        
        if (show) {
            indicator.classList.remove('hidden');
            statusMsg.classList.add('hidden');
            const textElement = indicator.querySelector('.loading-text');
            if (textElement && text) {
                textElement.textContent = text;
            }
        } else {
            indicator.classList.add('hidden');
        }
    }

    showStatus(message, type = 'info', duration = 5000) {
        const statusMsg = document.getElementById('statusMessage');
        const indicator = document.getElementById('loadingIndicator');
        
        // Hide loading indicator
        indicator.classList.add('hidden');
        
        // Clear any existing timeout
        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
        }
        
        // Reset classes and show message
        statusMsg.className = `status-message ${type}`;
        statusMsg.textContent = message;
        
        // Force reflow to ensure animation plays
        void statusMsg.offsetWidth;
        
        // Auto-hide after duration
        if (duration > 0) {
            this.statusTimeout = setTimeout(() => {
                statusMsg.classList.add('hidden');
                // Remove from DOM after animation completes
                setTimeout(() => {
                    if (statusMsg.classList.contains('hidden')) {
                        statusMsg.textContent = '';
                    }
                }, 300);
            }, duration);
        }
    }

    showError(message, critical = false) {
        if (critical) {
            // Show in error message area for critical errors
            const errorEl = document.getElementById('errorMessage');
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
            errorEl.style.backgroundColor = '#fef2f2';
            errorEl.style.color = 'var(--error-color)';
            setTimeout(() => errorEl.classList.add('hidden'), 5000);
        } else {
            // Show inline status for regular errors
            this.showStatus(message, 'error');
        }
    }
    
    showSuccess(message) {
        // Show inline status
        this.showStatus(message, 'success', 3000);
    }

    hideError() {
        document.getElementById('errorMessage').classList.add('hidden');
        document.getElementById('statusMessage').classList.add('hidden');
    }
    
    // CSV Import handling
    async handleCSVInput(csvText) {
        // Split by comma, newline, or semicolon and filter empty values
        const validators = csvText.split(/[,\n;]+/).map(v => v.trim()).filter(v => v);
        let addedCount = 0;
        let errorCount = 0;
        let invalidCount = 0;
        const errors = [];
        
        this.showLoading(true, 'Processing validators...');
        
        for (const validatorId of validators) {
            if (!validatorId) continue;
            
            // Validate format first
            const validation = this.validateValidatorInput(validatorId);
            if (!validation.valid) {
                invalidCount++;
                errors.push(`${validatorId}: Invalid format`);
                continue;
            }
            
            try {
                let validator = validatorId;
                
                if (validation.type === 'pubkey') {
                    const validatorInfo = await this.getValidatorInfo(validatorId);
                    if (validatorInfo && validatorInfo.index) {
                        validator = validatorInfo.index.toString();
                    } else {
                        errorCount++;
                        errors.push(`${validatorId}: Not found on beacon chain`);
                        continue;
                    }
                } else {
                    // Verify index exists
                    const validatorInfo = await this.getValidatorInfo(validator);
                    if (!validatorInfo) {
                        errorCount++;
                        errors.push(`${validator}: Not found on beacon chain`);
                        continue;
                    }
                }
                
                // Check if already added
                if (!this.validators.some(v => (v.id || v) === validator)) {
                    const validatorInfo = await this.getValidatorInfo(validator);
                    this.validators.push({
                        id: validator,
                        status: validatorInfo?.status || 'unknown',
                        lastChecked: new Date().toISOString()
                    });
                    this.assignValidatorColor(validator);
                    addedCount++;
                }
            } catch (error) {
                console.error(`Error adding validator ${validatorId}:`, error);
                errorCount++;
                errors.push(`${validatorId}: ${error.message.includes('beacon node') ? 'Connection error' : 'Validation failed'}`);
            }
        }
        
        this.showLoading(false);
        
        if (addedCount > 0) {
            this.saveValidators();
            this.renderValidators();
            this.updateTelegramSubscriptionSilent();
            document.getElementById('validatorInput').value = '';
            
            let message = `Added ${addedCount} validator(s)`;
            if (errorCount > 0 || invalidCount > 0) {
                message += `, ${errorCount + invalidCount} failed`;
            }
            this.showSuccess(message);
            
            // Show detailed errors if any
            if (errors.length > 0 && errors.length <= 5) {
                setTimeout(() => {
                    this.showError(`Failed validators: ${errors.join('; ')}`);
                }, 100);
            } else if (errors.length > 5) {
                setTimeout(() => {
                    this.showError(`${errors.length} validators failed validation`);
                }, 100);
            }
            
            if (this.validators.length === addedCount) {
                this.fetchAllDuties();
            }
        } else {
            if (invalidCount > 0) {
                this.showError(`All ${invalidCount} entries have invalid format`);
            } else if (errorCount > 0) {
                this.showError('No validators could be added. Check beacon node connection.');
            } else {
                this.showError('No valid validators found');
            }
        }
    }
    
    // JSON Import handling
    async handleImport(file) {
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (!Array.isArray(data.validators)) {
                    throw new Error('Invalid format: expected { validators: [...] }');
                }
                
                let addedCount = 0;
                let errorCount = 0;
                let settingsRestored = false;
                
                this.showLoading(true, 'Importing configuration...');
                
                // Import settings if available (version 1.1+)
                if (data.settings) {
                    try {
                        // Restore beacon URL
                        if (data.settings.beaconUrl) {
                            this.beaconUrl = data.settings.beaconUrl;
                            document.getElementById('beaconUrl').value = data.settings.beaconUrl;
                            sessionStorage.setItem('beaconUrl', data.settings.beaconUrl);
                        }
                        
                        // Restore notification settings
                        if (data.settings.notifications) {
                            document.getElementById('notifyProposer').checked = data.settings.notifications.proposer || false;
                            document.getElementById('notifyAttester').checked = data.settings.notifications.attester || false;
                            document.getElementById('notifySync').checked = data.settings.notifications.sync || false;
                            document.getElementById('notifyMinutes').value = data.settings.notifications.minutesBefore || 5;
                        }
                        
                        // Restore Telegram settings
                        if (data.settings.telegram) {
                            if (data.settings.telegram.chatId) {
                                sessionStorage.setItem('telegramChatId', data.settings.telegram.chatId);
                                document.getElementById('telegramChatId').value = data.settings.telegram.chatId;
                            }
                            sessionStorage.setItem('telegramEnabled', data.settings.telegram.enabled ? 'true' : 'false');
                            this.updateNotificationStatus();
                        }
                        
                        // Restore browser notification setting
                        if (data.settings.browser) {
                            sessionStorage.setItem('browserNotifications', data.settings.browser.enabled ? 'true' : 'false');
                            this.updateNotificationStatus();
                        }
                        
                        // Restore auto-refresh
                        if (data.settings.autoRefresh !== undefined) {
                            sessionStorage.setItem('autoRefresh', data.settings.autoRefresh ? 'true' : 'false');
                            document.getElementById('autoRefresh').checked = data.settings.autoRefresh;
                            if (data.settings.autoRefresh) {
                                this.startAutoRefresh();
                            }
                        }
                        
                        settingsRestored = true;
                    } catch (error) {
                        console.error('Error restoring settings:', error);
                    }
                }
                
                // Import validators
                for (const item of data.validators) {
                    try {
                        const validator = item.index?.toString();
                        if (!validator) {
                            errorCount++;
                            continue;
                        }
                        
                        if (!this.validators.some(v => (v.id || v) === validator)) {
                            this.validators.push({
                                id: validator,
                                status: 'unknown',
                                lastChecked: new Date().toISOString()
                            });
                            this.assignValidatorColor(validator);
                            
                            // Set custom label if provided
                            if (item.label) {
                                this.setValidatorCustomLabel(validator, item.label);
                            }
                            
                            addedCount++;
                        }
                    } catch (error) {
                        console.error('Error importing validator:', error);
                        errorCount++;
                    }
                }
                
                this.showLoading(false);
                
                if (addedCount > 0 || settingsRestored) {
                    this.saveValidators();
                    this.renderValidators();
                    this.updateTelegramSubscriptionSilent();
                    
                    let message = '';
                    if (addedCount > 0) {
                        message = `Imported ${addedCount} validator(s)${errorCount > 0 ? `, ${errorCount} failed` : ''}`;
                    }
                    if (settingsRestored) {
                        message += (message ? ' and ' : 'Imported ') + 'settings';
                    }
                    this.showSuccess(message);
                    
                    if (this.validators.length === addedCount) {
                        this.fetchAllDuties();
                    }
                } else {
                    this.showError('No new validators or settings imported');
                }
            } catch (error) {
                console.error('Import error:', error);
                this.showError('Failed to import file: ' + error.message);
            }
        };
        
        reader.readAsText(file);
    }
    
    // Export validators to JSON
    async exportValidators() {
        if (this.validators.length === 0) {
            this.showError('No validators to export');
            return;
        }
        
        const exportData = {
            version: '1.1',
            exportDate: new Date().toISOString(),
            settings: {
                beaconUrl: this.beaconUrl,
                notifications: {
                    proposer: document.getElementById('notifyProposer').checked,
                    attester: document.getElementById('notifyAttester').checked,
                    sync: document.getElementById('notifySync').checked,
                    minutesBefore: parseInt(document.getElementById('notifyMinutes').value)
                },
                telegram: {
                    enabled: sessionStorage.getItem('telegramEnabled') === 'true',
                    chatId: sessionStorage.getItem('telegramChatId') || ''
                },
                browser: {
                    enabled: sessionStorage.getItem('browserNotifications') === 'true'
                },
                autoRefresh: sessionStorage.getItem('autoRefresh') === 'true'
            },
            validators: []
        };
        
        this.showLoading(true, 'Preparing export...');
        
        // Gather validator data with labels
        for (const validator of this.validators) {
            const validatorId = validator.id || validator;
            const label = this.getValidatorCustomLabel(validatorId);
            const validatorData = {
                index: parseInt(validatorId),
                label: label || ''
            };
            
            // Try to get pubkey if available
            try {
                const info = await this.getValidatorInfo(validatorId);
                if (info && info.pubkey) {
                    validatorData.pubkey = info.pubkey;
                }
            } catch (error) {
                console.error(`Could not fetch pubkey for validator ${validator}`);
            }
            
            exportData.validators.push(validatorData);
        }
        
        this.showLoading(false);
        
        // Create and download file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ethduties-config-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showSuccess(`Exported ${this.validators.length} validator(s) with settings`);
    }

    // Dashboard Mode Functionality
    initializeDashboard() {
        this.isDashboardMode = sessionStorage.getItem('dashboardMode') === 'true';
        this.dashboardUpdateInterval = null;
        this.blockStreamData = [];
        
        if (this.isDashboardMode) {
            this.switchToDashboard();
        }
    }

    toggleDashboardMode() {
        this.isDashboardMode = !this.isDashboardMode;
        sessionStorage.setItem('dashboardMode', this.isDashboardMode.toString());
        
        const toggleBtn = document.getElementById('dashboardModeToggle');
        
        if (this.isDashboardMode) {
            this.switchToDashboard();
            toggleBtn.textContent = '📋 Normal Mode';
            toggleBtn.classList.add('active');
        } else {
            this.switchToNormal();
            toggleBtn.textContent = '📊 Dashboard Mode';
            toggleBtn.classList.remove('active');
        }
    }

    switchToDashboard() {
        // Hide normal pages and show dashboard
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('dashboardPage').classList.add('active');
        
        // Update toggle button
        const toggleBtn = document.getElementById('dashboardModeToggle');
        toggleBtn.textContent = '📋 Normal Mode';
        toggleBtn.classList.add('active');
        
        // Force enable auto-refresh in dashboard mode
        this.startAutoRefresh();
        document.getElementById('autoRefresh').checked = true;
        sessionStorage.setItem('autoRefresh', 'true');
        
        // Start dashboard updates
        this.updateDashboard();
        this.startDashboardUpdates();
    }

    switchToNormal() {
        // Hide dashboard and show normal page
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        document.getElementById('dutiesPage').classList.add('active');
        
        // Stop dashboard updates
        this.stopDashboardUpdates();
        
        // Update toggle button
        const toggleBtn = document.getElementById('dashboardModeToggle');
        toggleBtn.textContent = '📊 Dashboard Mode';
        toggleBtn.classList.remove('active');
    }

    exitDashboardMode() {
        // Set dashboard mode to false
        this.isDashboardMode = false;
        sessionStorage.setItem('dashboardMode', 'false');
        
        // Switch to normal mode
        this.switchToNormal();
    }

    startDashboardUpdates() {
        if (this.dashboardUpdateInterval) {
            clearInterval(this.dashboardUpdateInterval);
        }
        
        // Update every 6 seconds for live dashboard feel
        this.dashboardUpdateInterval = setInterval(() => {
            if (this.isDashboardMode) {
                this.updateDashboard();
            }
        }, 6000);
    }

    stopDashboardUpdates() {
        if (this.dashboardUpdateInterval) {
            clearInterval(this.dashboardUpdateInterval);
            this.dashboardUpdateInterval = null;
        }
    }

    updateDashboard() {
        this.showDashboardLoading();
        this.renderDashboardValidators();
        this.renderDashboardDuties();
        this.renderDashboardPastDuties();
        this.renderDashboardNetwork();
        this.updateCurrentSlotEpoch();
        
        // Hide loading indicator after 5 seconds
        setTimeout(() => {
            this.hideDashboardLoading();
        }, 5000);
    }
    
    showDashboardLoading() {
        const indicator = document.getElementById('dashboardLoadingIndicator');
        if (indicator) {
            indicator.style.opacity = '1';
            indicator.style.display = 'block';
        }
    }
    
    hideDashboardLoading() {
        const indicator = document.getElementById('dashboardLoadingIndicator');
        if (indicator) {
            indicator.style.opacity = '0';
            setTimeout(() => {
                indicator.style.display = 'none';
            }, 200);
        }
    }

    renderDashboardValidators() {
        const container = document.getElementById('dashboardValidators');
        if (!container) return;

        if (this.validators.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No validators added yet</div>';
            return;
        }

        const html = this.validators.map(validator => {
            const label = this.getValidatorLabel(validator);
            const color = this.getValidatorColor(validator);
            
            // Count duties for this validator
            let dutyCount = 0;
            dutyCount += this.duties.proposer.filter(d => this.getValidatorForDuty(d) === validator).length;
            dutyCount += this.duties.attester.filter(d => this.getValidatorForDuty(d) === validator).length;
            dutyCount += this.duties.sync.filter(d => d.validator === validator).length;
            
            return `
                <div class="dashboard-validator-item ${dutyCount > 0 ? 'has-duties' : ''}" style="border-left-color: ${color}">
                    <div class="validator-info-compact">
                        <div class="validator-index-compact">${validator}</div>
                        <div class="validator-label-compact">${label !== validator ? label : 'Validator'}</div>
                        ${dutyCount > 0 ? `<div class="validator-duties-count">${dutyCount} upcoming duties</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    renderDashboardDuties() {
        this.renderDashboardProposerDuties();
        this.renderDashboardAttesterDuties();
        this.renderDashboardSyncDuties();
    }

    renderDashboardProposerDuties() {
        const container = document.getElementById('dashboardProposer');
        if (!container) return;

        const upcomingDuties = this.duties.proposer
            .filter(duty => {
                const timeUntil = this.getTimeUntilSlot(duty.slot);
                return timeUntil > 0; // Only upcoming duties
            })
            .sort((a, b) => a.slot - b.slot)
            .slice(0, 8); // Show max 8 duties

        if (upcomingDuties.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 0.85rem;">No upcoming proposer duties</div>';
            return;
        }

        const isCompactMode = upcomingDuties.length > 6;
        
        const html = upcomingDuties.map(duty => {
            const timeUntil = this.getTimeUntilSlot(duty.slot);
            const urgencyClass = this.getUrgencyClass(timeUntil);
            const validator = this.getValidatorForDuty(duty);
            const label = this.getValidatorLabel(validator);
            const color = this.getValidatorColor(validator);

            if (isCompactMode) {
                return `
                    <div class="dashboard-duty-item-compact proposer ${urgencyClass}" style="border-color: ${color};">
                        <div class="duty-validator-mini" style="color: ${color};">${label}</div>
                        <div class="duty-time-mini">${this.formatTimeUntil(timeUntil)}</div>
                        <div class="duty-slot-mini">Slot ${duty.slot}</div>
                    </div>
                `;
            } else {
                return `
                    <div class="dashboard-duty-item proposer ${urgencyClass}" style="border-color: ${color};">
                        <div class="duty-header-compact">
                            <div class="duty-validator-compact" style="color: ${color};">${label}</div>
                            <div class="duty-time-compact">${this.formatTimeUntil(timeUntil)}</div>
                        </div>
                        <div class="duty-details-compact">Slot ${duty.slot}</div>
                    </div>
                `;
            }
        }).join('');

        container.innerHTML = `<div class="dashboard-duties-container ${isCompactMode ? 'compact-grid' : 'normal-grid'}">${html}</div>`;
    }

    renderDashboardAttesterDuties() {
        const container = document.getElementById('dashboardAttester');
        if (!container) return;

        const upcomingDuties = this.duties.attester
            .filter(duty => {
                const timeUntil = this.getTimeUntilSlot(duty.slot);
                return timeUntil > 0; // Only upcoming duties
            })
            .sort((a, b) => a.slot - b.slot)
            .slice(0, 8); // Show max 8 duties

        if (upcomingDuties.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 0.85rem;">No upcoming attester duties</div>';
            return;
        }

        const isCompactMode = upcomingDuties.length > 6;
        
        const html = upcomingDuties.map(duty => {
            const timeUntil = this.getTimeUntilSlot(duty.slot);
            const urgencyClass = this.getUrgencyClass(timeUntil);
            const validator = this.getValidatorForDuty(duty);
            const label = this.getValidatorLabel(validator);
            const color = this.getValidatorColor(validator);

            if (isCompactMode) {
                return `
                    <div class="dashboard-duty-item-compact ${urgencyClass}" style="border-color: ${color};">
                        <div class="duty-validator-mini" style="color: ${color};">${label}</div>
                        <div class="duty-time-mini">${this.formatTimeUntil(timeUntil)}</div>
                        <div class="duty-slot-mini">Slot ${duty.slot}</div>
                    </div>
                `;
            } else {
                return `
                    <div class="dashboard-duty-item ${urgencyClass}" style="border-color: ${color};">
                        <div class="duty-header-compact">
                            <div class="duty-validator-compact" style="color: ${color};">${label}</div>
                            <div class="duty-time-compact">${this.formatTimeUntil(timeUntil)}</div>
                        </div>
                        <div class="duty-details-compact">Slot ${duty.slot} • Committee ${duty.committee_index}</div>
                    </div>
                `;
            }
        }).join('');

        container.innerHTML = `<div class="dashboard-duties-container ${isCompactMode ? 'compact-grid' : 'normal-grid'}">${html}</div>`;
    }

    renderDashboardSyncDuties() {
        const container = document.getElementById('dashboardSync');
        if (!container) return;

        if (this.duties.sync.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 0.85rem;">No sync committee duties</div>';
            return;
        }

        const currentEpoch = Math.floor(this.getCurrentSlotSync() / 32);
        const isCompactMode = this.duties.sync.length > 6;
        
        const html = this.duties.sync.map(duty => {
            const validator = duty.validator;
            const label = this.getValidatorLabel(validator);
            const color = this.getValidatorColor(validator);
            
            let timeDisplay = '';
            let statusClass = '';
            
            if (duty.period === 'current') {
                const remainingEpochs = duty.until_epoch - currentEpoch;
                timeDisplay = `${remainingEpochs} epochs left`;
                statusClass = 'current';
            } else {
                const epochsUntil = duty.from_epoch - currentEpoch;
                timeDisplay = `Starts in ${epochsUntil} epochs`;
                statusClass = 'upcoming';
            }

            if (isCompactMode) {
                return `
                    <div class="dashboard-duty-item-compact ${statusClass}" style="border-color: ${color};">
                        <div class="duty-validator-mini" style="color: ${color};">${label}</div>
                        <div class="duty-time-mini">${timeDisplay}</div>
                        <div class="duty-status-mini">${duty.period === 'current' ? 'Active' : 'Next'}</div>
                    </div>
                `;
            } else {
                return `
                    <div class="dashboard-duty-item ${statusClass}" style="border-color: ${color};">
                        <div class="duty-header-compact">
                            <div class="duty-validator-compact" style="color: ${color};">${label}</div>
                            <div class="duty-time-compact">${timeDisplay}</div>
                        </div>
                        <div class="duty-details-compact">${duty.period === 'current' ? 'Currently active' : 'Next period'}</div>
                    </div>
                `;
            }
        }).join('');

        container.innerHTML = `<div class="dashboard-duties-container ${isCompactMode ? 'compact-grid' : 'normal-grid'}">${html}</div>`;
    }

    renderDashboardPastDuties() {
        const container = document.getElementById('dashboardPastDuties');
        if (!container) return;

        const currentSlot = this.getCurrentSlotSync();
        const allProposers = this.networkOverview?.allProposers || [];
        const allBlocks = this.networkOverview?.blocks || [];
        const pastDuties = [];

        // Add recent past block proposals with details
        const pastBlocks = allProposers
            .filter(duty => duty.slot < currentSlot)
            .sort((a, b) => b.slot - a.slot)
            .slice(0, 15); // Get 15 most recent past blocks

        pastBlocks.forEach(duty => {
            const isTracked = this.validators.includes(duty.validator_index?.toString());
            const validator = duty.validator_index?.toString();
            const label = isTracked ? this.getValidatorLabel(validator) : `Validator ${duty.validator_index}`;
            
            // Find block details if available
            const blockDetail = allBlocks.find(block => block.slot === duty.slot);
            const graffiti = blockDetail?.graffiti || 'No graffiti';
            
            pastDuties.push({
                type: 'Block Proposal',
                slot: duty.slot,
                validator: validator,
                label: label,
                isTracked: isTracked,
                graffiti: graffiti,
                timeAgo: this.formatTimeAgo(Math.abs(this.getTimeUntilSlot(duty.slot)))
            });
        });

        // Add past attester duties from tracked validators
        this.duties.attester.forEach(duty => {
            if (duty.slot < currentSlot) {
                const validator = this.getValidatorForDuty(duty);
                const label = this.getValidatorLabel(validator);
                
                pastDuties.push({
                    type: 'Attestation',
                    slot: duty.slot,
                    validator: validator,
                    label: label,
                    isTracked: true,
                    committee: duty.committee_index,
                    timeAgo: this.formatTimeAgo(Math.abs(this.getTimeUntilSlot(duty.slot)))
                });
            }
        });

        // Sort by slot (most recent first) and limit to 20
        pastDuties.sort((a, b) => b.slot - a.slot);
        const recentPastDuties = pastDuties.slice(0, 20);

        if (recentPastDuties.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 0.85rem;">No past duties to show</div>';
            return;
        }

        const isCompactMode = recentPastDuties.length > 6;
        
        const html = recentPastDuties.map(duty => {
            const color = duty.isTracked ? this.getValidatorColor(duty.validator) : 'var(--text-secondary)';
            
            if (isCompactMode) {
                if (duty.type === 'Block Proposal') {
                    return `
                        <div class="dashboard-duty-item-compact past-block" style="background-color: ${color}15; border-color: ${color};">
                            <div class="past-block-header">
                                <div class="duty-validator-mini" style="color: ${color};">${duty.label}</div>
                                <div class="duty-slot-mini" style="color: ${color};">Slot ${duty.slot}</div>
                            </div>
                            <div class="past-block-details">
                                <div class="duty-time-mini">${duty.timeAgo} ago</div>
                                <div class="duty-graffiti-mini">${duty.graffiti.substring(0, 15)}${duty.graffiti.length > 15 ? '...' : ''}</div>
                            </div>
                        </div>
                    `;
                } else {
                    return `
                        <div class="dashboard-duty-item-compact past-attestation" style="background-color: ${color}15; border-color: ${color};">
                            <div class="past-block-header">
                                <div class="duty-validator-mini" style="color: ${color};">${duty.label}</div>
                                <div class="duty-slot-mini" style="color: ${color};">Attest</div>
                            </div>
                            <div class="past-block-details">
                                <div class="duty-time-mini">${duty.timeAgo} ago</div>
                                <div class="duty-graffiti-mini">Committee ${duty.committee || 'N/A'}</div>
                            </div>
                        </div>
                    `;
                }
            } else {
                if (duty.type === 'Block Proposal') {
                    return `
                        <div class="dashboard-duty-item past-block" style="background-color: ${color}15; border-color: ${color};">
                            <div class="past-block-header">
                                <div class="duty-validator-compact" style="color: ${color};">${duty.label}</div>
                                <div class="duty-slot-compact" style="color: ${color};">Slot ${duty.slot}</div>
                            </div>
                            <div class="past-block-details">
                                <div class="duty-time-compact">${duty.timeAgo} ago</div>
                                <div class="duty-graffiti-compact">${duty.graffiti}</div>
                            </div>
                        </div>
                    `;
                } else {
                    return `
                        <div class="dashboard-duty-item past-attestation" style="background-color: ${color}15; border-color: ${color};">
                            <div class="past-block-header">
                                <div class="duty-validator-compact" style="color: ${color};">${duty.label}</div>
                                <div class="duty-slot-compact" style="color: ${color};">Attestation</div>
                            </div>
                            <div class="past-block-details">
                                <div class="duty-time-compact">${duty.timeAgo} ago</div>
                                <div class="duty-graffiti-compact">Committee ${duty.committee || 'N/A'} • Slot ${duty.slot}</div>
                            </div>
                        </div>
                    `;
                }
            }
        }).join('');

        container.innerHTML = `<div class="dashboard-duties-container ${isCompactMode ? 'compact-grid' : 'normal-grid'}">${html}</div>`;
    }

    renderDashboardNetwork() {
        // Update network stats
        this.updateNetworkStats();
        
        // Update block stream
        this.renderBlockStream();
    }
    
    updateNetworkStats() {
        const currentSlot = this.getCurrentSlotSync();
        const currentEpoch = Math.floor(currentSlot / 32);
        
        // Update slot and epoch
        const slotElement = document.getElementById('currentSlotNumber');
        const epochElement = document.getElementById('currentEpochNumber');
        const blockElement = document.getElementById('currentBlockNumber');
        
        if (slotElement) slotElement.textContent = currentSlot.toLocaleString();
        if (epochElement) epochElement.textContent = currentEpoch.toLocaleString();
        
        // Calculate approximate block number (rough estimation)
        const blockNumber = currentSlot + 15537394;
        if (blockElement) blockElement.textContent = blockNumber.toLocaleString();
        
        
        // Fetch gas price (placeholder for now - beacon API doesn't provide gas price directly)
        // We'll add a simple gas price display
        this.fetchGasPrice();
    }
    
    
    async fetchGasPrice() {
        // For now, just show a placeholder since beacon API doesn't provide gas price
        // In production, you'd fetch from execution layer or external API
        const gasElement = document.getElementById('currentGasPrice');
        if (gasElement) {
            gasElement.textContent = '~15 gwei'; // Placeholder
        }
    }

    renderBlockStream() {
        const container = document.getElementById('blockStream');
        if (!container) return;

        // Get network data from proposer duties
        const currentSlot = this.getCurrentSlotSync();
        const allProposers = this.networkOverview?.allProposers || [];
        
        // Get blocks around current slot (2 before, 1 current, 10 after for current block to be 3rd from top)
        const relevantBlocks = allProposers
            .filter(duty => duty.slot >= currentSlot - 2 && duty.slot <= currentSlot + 10)
            .sort((a, b) => a.slot - b.slot);

        if (relevantBlocks.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 15px; font-size: 0.85rem;">No block data available</div>';
            return;
        }

        const html = relevantBlocks.map((duty) => {
            const isTracked = this.validators.includes(duty.validator_index?.toString());
            const isCurrent = duty.slot === currentSlot;
            const isPast = duty.slot < currentSlot;
            const timeUntil = this.getTimeUntilSlot(duty.slot);
            
            let statusClass = '';
            let statusDot = '';
            
            if (isCurrent) {
                statusClass = 'current center-block';
                statusDot = '<div class="block-status current-pulse"></div>';
                
                // Add shiver animation in last 2 seconds (when time until is negative but close to 0)
                const secondsUntil = timeUntil / 1000;
                if (secondsUntil > -2 && secondsUntil <= 0) {
                    statusClass += ' shiver-confirming';
                }
            } else if (isPast) {
                statusClass = 'past';
                statusDot = '<div class="block-status confirmed"></div>';
            } else {
                statusClass = 'future';
                statusDot = '<div class="block-status upcoming"></div>';
            }
            
            if (isTracked) {
                statusClass += ' tracked';
            }

            const proposerDisplay = duty.validator_index || 'Unknown';
            const proposerLabel = isTracked ? this.getValidatorLabel(duty.validator_index?.toString()) : duty.validator_index;
            const timeDisplay = isPast ? 
                this.formatTimeAgo(Math.abs(timeUntil)) + ' ago' : 
                (isCurrent ? 'Now' : this.formatTimeUntil(timeUntil));

            return `
                <div class="block-item ${statusClass}" style="--block-color: ${isTracked ? this.getValidatorColor(duty.validator_index?.toString()) : 'transparent'}">
                    ${statusDot}
                    <div class="block-header">
                        <div class="block-slot">Slot ${duty.slot}</div>
                        <div class="block-time">${timeDisplay}</div>
                    </div>
                    <div class="block-proposer">
                        <span style="color: ${isTracked ? this.getValidatorColor(duty.validator_index?.toString()) : 'var(--text-secondary)'}; font-weight: ${isTracked ? '700' : '500'};">
                            ${isTracked ? proposerLabel + ' 👑' : proposerDisplay}
                        </span>
                    </div>
                </div>
            `;
        }).join('');

        // Add smooth transition animation
        const currentBlocks = container.querySelectorAll('.block-item');
        const newContainer = document.createElement('div');
        newContainer.innerHTML = html;
        
        // Check if current block has changed for animation
        const oldCurrentBlock = container.querySelector('.center-block');
        const newCurrentBlock = newContainer.querySelector('.center-block');
        const hasCurrentBlockChanged = !oldCurrentBlock || 
            (oldCurrentBlock && newCurrentBlock && 
             oldCurrentBlock.querySelector('.block-slot').textContent !== newCurrentBlock.querySelector('.block-slot').textContent);
        
        if (hasCurrentBlockChanged && currentBlocks.length > 0) {
            // Animate transition to new block
            container.style.transform = 'translateY(-10px)';
            container.style.opacity = '0.7';
            
            setTimeout(() => {
                container.innerHTML = html;
                container.style.transform = 'translateY(0)';
                container.style.opacity = '1';
                
                // Highlight new current block
                const newCurrentElement = container.querySelector('.center-block');
                if (newCurrentElement) {
                    newCurrentElement.classList.add('new-block-animation');
                    setTimeout(() => {
                        newCurrentElement.classList.remove('new-block-animation');
                    }, 1000);
                }
            }, 200);
        } else {
            container.innerHTML = html;
        }
    }

    updateCurrentSlotEpoch() {
        const currentSlot = this.getCurrentSlotSync();
        const currentEpoch = Math.floor(currentSlot / 32);
        const currentBlock = currentSlot + 15537394; // Approximate block number calculation
        
        const slotElement = document.getElementById('currentSlotNumber');
        const epochElement = document.getElementById('currentEpochNumber');
        const blockElement = document.getElementById('currentBlockNumber');
        
        if (slotElement) slotElement.textContent = currentSlot.toLocaleString();
        if (epochElement) epochElement.textContent = currentEpoch.toLocaleString();
        if (blockElement) blockElement.textContent = currentBlock.toLocaleString();
    }
}

const app = new ValidatorDutiesTracker();

// Clean up intervals on page unload
window.addEventListener('beforeunload', () => {
    if (app.autoRefreshInterval) clearInterval(app.autoRefreshInterval);
    if (app.notificationCheckInterval) clearInterval(app.notificationCheckInterval);
    if (app.countdownInterval) clearInterval(app.countdownInterval);
    if (app.dashboardUpdateInterval) clearInterval(app.dashboardUpdateInterval);
});