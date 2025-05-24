// src/services/websocketManager.js - Unified WebSocket Manager (Both Creation & Migration)
const WebSocket = require('ws');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class WebSocketManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.url = 'wss://pumpportal.fun/api/data';
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
        this.reconnectDelay = config.reconnectDelay || 5000;
        this.pingInterval = config.pingInterval || 30000;
        this.subscriptions = new Set();
        this.pingTimer = null;
        this.connectionId = Math.random().toString(36).substring(7);
        
        // Bind methods to preserve context
        this.connect = this.connect.bind(this);
        this.reconnect = this.reconnect.bind(this);
        this.handleMessage = this.handleMessage.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleClose = this.handleClose.bind(this);
    }

    async connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            logger.debug('WebSocket already connected');
            return;
        }

        logger.info(`[${this.connectionId}] Connecting to PumpPortal WebSocket...`);
        
        try {
            this.ws = new WebSocket(this.url);
            
            this.ws.on('open', () => {
                logger.info(`[${this.connectionId}] WebSocket connected successfully`);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.startPing();
                this.resubscribeAll();
                this.emit('connected');
            });

            this.ws.on('message', this.handleMessage);
            this.ws.on('error', this.handleError);
            this.ws.on('close', this.handleClose);

        } catch (error) {
            logger.error(`[${this.connectionId}] Failed to create WebSocket connection:`, error);
            this.scheduleReconnect();
        }
    }

    handleMessage(data) {
        console.log('🔍 RAW WEBSOCKET MESSAGE:', data.toString().substring(0, 200) + '...'); // Debug line
        try {
            const message = JSON.parse(data.toString());
            
            // Handle subscription confirmation
            if (message.message && message.message.includes('Successfully subscribed')) {
                logger.info(`[${this.connectionId}] ✅ ${message.message}`);
                return;
            }
            
            // Check if this is a token creation event
            if (message.txType === 'create' && message.mint && message.name && message.symbol) {
                logger.info(`[${this.connectionId}] 🪙 NEW TOKEN: ${message.name} (${message.symbol}) - ${message.mint}`);
                logger.debug(`[${this.connectionId}] Token details:`, {
                    mint: message.mint,
                    name: message.name,
                    symbol: message.symbol,
                    uri: message.uri,
                    creator: message.traderPublicKey,
                    marketCapSol: message.marketCapSol,
                    initialBuy: message.initialBuy
                });
                
                // Transform the message to match expected format
                const tokenEvent = {
                    eventType: 'creation',
                    mint: message.mint,
                    name: message.name,
                    symbol: message.symbol,
                    uri: message.uri,
                    traderPublicKey: message.traderPublicKey,
                    creator: message.traderPublicKey,
                    signature: message.signature,
                    marketCapSol: message.marketCapSol,
                    initialBuy: message.initialBuy,
                    solAmount: message.solAmount,
                    timestamp: Date.now(),
                    // Additional metadata
                    bondingCurveKey: message.bondingCurveKey,
                    vTokensInBondingCurve: message.vTokensInBondingCurve,
                    vSolInBondingCurve: message.vSolInBondingCurve,
                    pool: message.pool
                };
                
                this.emit('newToken', tokenEvent);
            }
            // Check if this is a migration event
            else if (message.txType === 'migration' || 
                message.type === 'migration' || 
                (message.signature && message.mint && this.isMigrationEvent(message))) {
                
                logger.info(`[${this.connectionId}] 🔄 MIGRATION: Token ${message.mint} - Signature: ${message.signature}`);
                logger.debug(`[${this.connectionId}] Migration details:`, {
                    mint: message.mint,
                    signature: message.signature,
                    pool: message.pool,
                    timestamp: message.timestamp,
                    allFields: Object.keys(message)
                });
                
                // Transform migration event
                const migrationEvent = {
                    eventType: 'migration',
                    mint: message.mint,
                    signature: message.signature,
                    pool: message.pool,
                    timestamp: Date.now(),
                    // Migration events may not have name/symbol immediately
                    // We'll need to fetch this data separately
                    name: message.name || null,
                    symbol: message.symbol || null,
                    uri: message.uri || null,
                    // Migration-specific data
                    migrationData: {
                        newPool: message.pool,
                        liquidityAdded: message.liquidityAdded,
                        migrationTimestamp: message.timestamp,
                        migrationTx: message.signature
                    },
                    // Include any other fields that might be useful
                    rawData: message
                };
                
                this.emit('tokenMigration', migrationEvent);
            }
            // Log other message types for debugging
            else if (message.signature && message.mint) {
                logger.debug(`[${this.connectionId}] 🔍 Other event with mint: ${message.mint.substring(0, 8)}... | Type: ${message.txType || 'unknown'} | Fields: ${Object.keys(message).join(', ')}`);
                
                // Sometimes migrations might not be clearly marked, look for patterns
                if (this.couldBeMigration(message)) {
                    logger.info(`[${this.connectionId}] 🤔 Possible migration event: ${message.mint}`);
                    logger.debug(`[${this.connectionId}] Possible migration data:`, message);
                }
            } else {
                // Log any other message types we might be missing
                logger.debug(`[${this.connectionId}] ❓ Unknown message type: ${Object.keys(message).join(', ')}`);
            }
        } catch (error) {
            logger.error(`[${this.connectionId}] Error parsing WebSocket message:`, error);
            logger.debug('Raw message data:', data.toString().substring(0, 500) + '...');
        }
    }

    // Helper method to identify migration events
    isMigrationEvent(message) {
        // Look for migration-specific patterns
        const migrationIndicators = [
            message.pool && message.pool !== message.mint, // Has a different pool address
            message.liquidityAdded,
            message.migration === true,
            message.migrated === true,
            message.graduated === true,
            // Add more patterns as we discover them
        ];
        
        return migrationIndicators.some(indicator => indicator);
    }

    // Helper method for potential migrations that aren't clearly marked
    couldBeMigration(message) {
        // Look for patterns that might indicate migration
        return (
            message.pool && 
            message.pool !== message.mint &&
            message.signature &&
            !message.txType // Sometimes migrations don't have txType set
        );
    }

    handleError(error) {
        logger.error(`[${this.connectionId}] WebSocket error:`, error);
        this.emit('error', error);
    }

    handleClose(code, reason) {
        logger.warn(`[${this.connectionId}] WebSocket closed with code ${code}: ${reason}`);
        this.isConnected = false;
        this.stopPing();
        this.emit('disconnected', { code, reason });
        
        // Don't reconnect if it was a clean close (code 1000)
        if (code !== 1000) {
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`[${this.connectionId}] Max reconnection attempts reached. Giving up.`);
            this.emit('maxReconnectAttemptsReached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
        
        logger.info(`[${this.connectionId}] Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(() => {
            if (!this.isConnected) {
                this.reconnect();
            }
        }, delay);
    }

    reconnect() {
        logger.info(`[${this.connectionId}] Attempting to reconnect...`);
        this.cleanup();
        this.connect();
    }

    startPing() {
        this.pingTimer = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping(); // Use WebSocket's built-in ping
            }
        }, this.pingInterval);
    }

    stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    send(payload) {
        if (!this.isConnected || this.ws.readyState !== WebSocket.OPEN) {
            logger.warn(`[${this.connectionId}] Cannot send message: WebSocket not connected`);
            return false;
        }

        try {
            const message = JSON.stringify(payload);
            this.ws.send(message);
            logger.debug(`[${this.connectionId}] Sent message:`, payload);
            return true;
        } catch (error) {
            logger.error(`[${this.connectionId}] Error sending message:`, error);
            return false;
        }
    }

    // Subscription methods for both creation and migration events
    subscribeNewToken() {
        const subscription = { method: 'subscribeNewToken' };
        if (this.send(subscription)) {
            this.subscriptions.add(subscription);
            logger.info(`[${this.connectionId}] ✅ Subscribed to new token events`);
            return true;
        }
        return false;
    }

    subscribeMigration() {
        const subscription = { method: 'subscribeMigration' };
        if (this.send(subscription)) {
            this.subscriptions.add(subscription);
            logger.info(`[${this.connectionId}] ✅ Subscribed to migration events`);
            return true;
        }
        return false;
    }

    resubscribeAll() {
        if (this.subscriptions.size === 0) {
            logger.debug(`[${this.connectionId}] No subscriptions to restore`);
            return;
        }

        logger.info(`[${this.connectionId}] Restoring ${this.subscriptions.size} subscriptions...`);
        
        for (const subscription of this.subscriptions) {
            setTimeout(() => {
                this.send(subscription);
            }, 100); // Small delay between resubscriptions
        }
    }

    unsubscribeAll() {
        logger.info(`[${this.connectionId}] Clearing all subscriptions`);
        this.subscriptions.clear();
    }

    getConnectionInfo() {
        return {
            connectionId: this.connectionId,
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            subscriptionsCount: this.subscriptions.size,
            subscriptionType: 'migration-only',
            readyState: this.ws ? this.ws.readyState : 'Not initialized'
        };
    }

    cleanup() {
        this.stopPing();
        if (this.ws) {
            this.ws.removeAllListeners();
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close(1000, 'Manual cleanup');
            }
            this.ws = null;
        }
        this.isConnected = false;
    }

    disconnect() {
        logger.info(`[${this.connectionId}] Manually disconnecting WebSocket`);
        this.cleanup();
        this.unsubscribeAll();
        this.emit('manualDisconnect');
    }
}

module.exports = WebSocketManager;