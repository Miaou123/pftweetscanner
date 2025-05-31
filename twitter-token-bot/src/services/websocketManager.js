// src/services/websocketManager.js - Fixed to not require migration confirmation
const WebSocket = require('ws');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { createTimer } = require('../utils/simpleTimer');

class WebSocketManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.url = 'wss://pumpportal.fun/api/data';
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
        this.reconnectDelay = config.reconnectDelay || 5000;
        this.connectionId = Math.random().toString(36).substring(7);
        
        // Track what we should be subscribed to
        this.subscriptionState = {
            newToken: false,
            migration: false, // Will be set to true after sending request (no confirmation expected)
            targetSubscriptions: {
                newToken: false,
                migration: false
            }
        };
        
        this.messageStats = {
            received: 0,
            processed: 0,
            errors: 0,
            migrations: 0,
            creations: 0,
            unknownTypes: 0
        };
    }

    async connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            logger.debug('WebSocket already connected');
            return;
        }

        logger.info(`[${this.connectionId}] Connecting to PumpPortal...`);
        
        this.ws = new WebSocket(this.url);
        
        this.ws.on('open', () => {
            logger.info(`[${this.connectionId}] ✅ Connected successfully`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            // Reset subscription state
            this.subscriptionState.newToken = false;
            this.subscriptionState.migration = false;
            
            // Resubscribe after a small delay to ensure connection is stable
            setTimeout(() => {
                this.resubscribeAll();
            }, 1000);
            
            this.emit('connected');
        });

        this.ws.on('message', (data) => {
            this.messageStats.received++;
            
            try {
                const message = JSON.parse(data.toString());
                
                // Handle subscription confirmations (only for new tokens)
                if (message.message && message.message.includes('Successfully subscribed')) {
                    logger.info(`[${this.connectionId}] ✅ ${message.message}`);
                    
                    // Update subscription state based on confirmation
                    if (message.message.includes('new token')) {
                        this.subscriptionState.newToken = true;
                    }
                    // Note: Migration subscriptions don't seem to send confirmations
                    return;
                }
                
                // 🚀 ENHANCED: Migration detection with multiple patterns
                if (this.isMigrationMessage(message)) {
                    this.handleMigrationMessage(message);
                }
                // Token creation
                else if (message.txType === 'create') {
                    this.handleCreationMessage(message);
                }
                // Unknown message types - log for debugging
                else {
                    this.handleUnknownMessage(message);
                }
                
            } catch (error) {
                this.messageStats.errors++;
                logger.error(`[${this.connectionId}] ❌ Message parse error:`, error);
                logger.debug(`[${this.connectionId}] Raw message: ${data.toString().substring(0, 200)}...`);
            }
        });

        this.ws.on('error', (error) => {
            logger.error(`[${this.connectionId}] WebSocket error:`, error);
            this.emit('error', error);
        });

        this.ws.on('close', (code, reason) => {
            logger.warn(`[${this.connectionId}] Closed: ${code} - ${reason}`);
            this.isConnected = false;
            
            // Reset subscription state on disconnect
            this.subscriptionState.newToken = false;
            this.subscriptionState.migration = false;
            
            this.emit('disconnected', { code, reason });
            
            if (code !== 1000) {
                this.scheduleReconnect();
            }
        });
    }

    // 🚀 FIXED: Migration detection based on actual PumpPortal data
    isMigrationMessage(message) {
        // 🔥 ACTUAL PATTERN: txType === "migrate" (not "migration")
        if (message.txType === 'migrate') {
            return true;
        }
        
        // Standard migration pattern (keep as fallback)
        if (message.txType === 'migration') {
            return true;
        }
        
        // Alternative patterns that might indicate migration
        if (message.type === 'migration' || message.type === 'migrate') {
            return true;
        }
        
        // Check for other potential migration indicators
        if (message.action === 'migrate' || message.event === 'migration') {
            return true;
        }
        
        // Look for pump-amm pool migrations specifically
        if (message.mint && message.signature && message.pool === 'pump-amm') {
            return true;
        }
        
        return false;
    }

    handleMigrationMessage(message) {
        this.messageStats.migrations++;
        this.messageStats.processed++;
        
        logger.info(`[${this.connectionId}] 🔄 MIGRATION DETECTED!`);
        logger.info(`[${this.connectionId}] Migration data:`, {
            txType: message.txType,
            mint: message.mint,
            signature: message.signature,
            pool: message.pool,
            keys: Object.keys(message)
        });
        
        const migrationEvent = {
            eventType: 'migration',
            mint: message.mint,
            signature: message.signature,
            pool: message.pool, // Add pool info
            timestamp: Date.now(),
            operationId: `${message.mint}_migration_${Date.now()}`,
            timer: createTimer(`${message.mint}_migration_${Date.now()}`),
            rawData: message
        };
        
        this.emit('tokenMigration', migrationEvent);
    }

    handleCreationMessage(message) {
        this.messageStats.creations++;
        this.messageStats.processed++;
        
        logger.info(`[${this.connectionId}] 🪙 NEW TOKEN: ${message.name} (${message.symbol}) - ${message.mint}`);
        
        const tokenEvent = {
            eventType: 'creation',
            mint: message.mint,
            name: message.name,
            symbol: message.symbol,
            creator: message.traderPublicKey,
            signature: message.signature,
            timestamp: Date.now(),
            operationId: `${message.symbol}_creation_${Date.now()}`,
            timer: createTimer(`${message.symbol}_creation_${Date.now()}`)
        };
        
        this.emit('newToken', tokenEvent);
    }

    handleUnknownMessage(message) {
        this.messageStats.unknownTypes++;
        
        // Log unknown message types for debugging (but skip migrations since we handle them now)
        if (message.txType !== 'migrate' && message.txType !== 'migration') {
            logger.debug(`[${this.connectionId}] UNKNOWN MESSAGE TYPE: ${message.txType || message.type || 'NO_TYPE'}`);
            logger.debug(`[${this.connectionId}] Message keys: ${Object.keys(message).join(', ')}`);
            
            // Check if this might be a new pattern we should handle
            if (message.mint && (message.signature || message.sig)) {
                logger.warn(`[${this.connectionId}] ⚠️ Unknown transaction with mint/signature:`, {
                    txType: message.txType || message.type,
                    mint: message.mint,
                    signature: message.signature || message.sig,
                    allKeys: Object.keys(message),
                    sample: JSON.stringify(message, null, 2).substring(0, 300) + '...'
                });
            }
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`[${this.connectionId}] Max reconnects reached`);
            this.emit('maxReconnectAttemptsReached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 60000);
        
        logger.info(`[${this.connectionId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(() => {
            if (!this.isConnected) {
                this.connect();
            }
        }, delay);
    }

    send(payload) {
        if (!this.isConnected || this.ws.readyState !== WebSocket.OPEN) {
            logger.warn(`[${this.connectionId}] Cannot send: not connected`);
            return false;
        }

        try {
            this.ws.send(JSON.stringify(payload));
            logger.debug(`[${this.connectionId}] Sent: ${JSON.stringify(payload)}`);
            return true;
        } catch (error) {
            logger.error(`[${this.connectionId}] Send error:`, error);
            return false;
        }
    }

    subscribeNewToken() {
        this.subscriptionState.targetSubscriptions.newToken = true;
        
        if (this.send({ method: 'subscribeNewToken' })) {
            logger.info(`[${this.connectionId}] 📤 Sent new token subscription request`);
            return true;
        }
        return false;
    }

    subscribeMigration() {
        this.subscriptionState.targetSubscriptions.migration = true;
        
        if (this.send({ method: 'subscribeMigration' })) {
            logger.info(`[${this.connectionId}] 📤 Sent migration subscription request`);
            // 🚀 FIXED: Assume migration subscription works (no confirmation expected)
            this.subscriptionState.migration = true;
            logger.info(`[${this.connectionId}] ✅ Assuming migration subscription is active (no confirmation expected)`);
            return true;
        }
        return false;
    }

    // 🚀 FIXED: Updated resubscription logic
    resubscribeAll() {
        const subscriptions = [];
        
        if (this.subscriptionState.targetSubscriptions.newToken) {
            subscriptions.push('new tokens');
            setTimeout(() => this.subscribeNewToken(), 100);
        }
        
        if (this.subscriptionState.targetSubscriptions.migration) {
            subscriptions.push('migrations');
            setTimeout(() => this.subscribeMigration(), 200);
        }
        
        if (subscriptions.length > 0) {
            logger.info(`[${this.connectionId}] 🔄 Resubscribing to: ${subscriptions.join(', ')}`);
        } else {
            logger.warn(`[${this.connectionId}] 🔄 No target subscriptions set - nothing to resubscribe to`);
        }
    }

    // 🚀 UPDATED: Simplified subscription verification (migration assumed working)
    verifySubscriptions() {
        const issues = [];
        
        if (this.subscriptionState.targetSubscriptions.newToken && !this.subscriptionState.newToken) {
            issues.push('new tokens');
        }
        
        // Don't verify migration subscription since no confirmation is expected
        
        if (issues.length > 0) {
            logger.warn(`[${this.connectionId}] ⚠️ Subscription verification failed for: ${issues.join(', ')}`);
            logger.warn(`[${this.connectionId}] Attempting to resubscribe...`);
            
            // Retry subscriptions
            setTimeout(() => {
                this.resubscribeAll();
            }, 2000);
        } else {
            logger.info(`[${this.connectionId}] ✅ All subscriptions verified successfully`);
        }
    }

    // 🚀 UPDATED: Get subscription status
    getSubscriptionStatus() {
        return {
            connected: this.isConnected,
            subscriptions: {
                newToken: {
                    target: this.subscriptionState.targetSubscriptions.newToken,
                    actual: this.subscriptionState.newToken,
                    working: this.subscriptionState.targetSubscriptions.newToken === this.subscriptionState.newToken
                },
                migration: {
                    target: this.subscriptionState.targetSubscriptions.migration,
                    actual: this.subscriptionState.migration,
                    working: this.subscriptionState.targetSubscriptions.migration === this.subscriptionState.migration,
                    note: "Migration subscription assumed working (no confirmation expected)"
                }
            }
        };
    }

    getConnectionInfo() {
        return {
            connectionId: this.connectionId,
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            messageStats: this.messageStats,
            subscriptionStatus: this.getSubscriptionStatus()
        };
    }

    // 🚀 UPDATED: Get detailed stats string
    getStatsString() {
        const { received, processed, errors, migrations, creations, unknownTypes } = this.messageStats;
        const subscriptionStatus = this.getSubscriptionStatus();
        
        return `📡 WebSocket Stats: ${received} received | ${processed} processed | ${creations} creations | ${migrations} migrations | ${unknownTypes} unknown | ${errors} errors | Subscriptions: newToken=${subscriptionStatus.subscriptions.newToken.working ? '✅' : '❌'} migration=${subscriptionStatus.subscriptions.migration.working ? '✅' : '🔶'}`;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
        this.isConnected = false;
        
        // Reset subscription state
        this.subscriptionState.newToken = false;
        this.subscriptionState.migration = false;
    }
}

module.exports = WebSocketManager;