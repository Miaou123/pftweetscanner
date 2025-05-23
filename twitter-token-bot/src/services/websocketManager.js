// src/services/websocketManager.js
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
        try {
            const message = JSON.parse(data.toString());
            
            // Log different message types appropriately
            if (message.type === 'newTokenEvent') {
                logger.info(`[${this.connectionId}] New token detected: ${message.mint} (${message.name})`);
                this.emit('newToken', message);
            } else if (message.type === 'tradeEvent') {
                this.emit('tokenTrade', message);
            } else if (message.type === 'migrationEvent') {
                logger.info(`[${this.connectionId}] Migration detected: ${message.mint}`);
                this.emit('migration', message);
            } else if (message.type === 'pong') {
                // Pong response - connection is healthy
                logger.debug(`[${this.connectionId}] Received pong`);
            } else {
                logger.debug(`[${this.connectionId}] Received message:`, message);
                this.emit('message', message);
            }
        } catch (error) {
            logger.error(`[${this.connectionId}] Error parsing WebSocket message:`, error);
            logger.debug('Raw message data:', data.toString());
        }
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
                this.send({ method: 'ping' });
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

    // Subscription methods
    subscribeNewToken() {
        const subscription = { method: 'subscribeNewToken' };
        if (this.send(subscription)) {
            this.subscriptions.add(subscription);
            logger.info(`[${this.connectionId}] Subscribed to new token events`);
            return true;
        }
        return false;
    }

    subscribeTokenTrade(tokenAddresses) {
        if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
            logger.warn('Invalid token addresses for subscription');
            return false;
        }

        const subscription = { 
            method: 'subscribeTokenTrade', 
            keys: tokenAddresses 
        };
        
        if (this.send(subscription)) {
            this.subscriptions.add(subscription);
            logger.info(`[${this.connectionId}] Subscribed to token trades for ${tokenAddresses.length} tokens`);
            return true;
        }
        return false;
    }

    subscribeAccountTrade(accountAddresses) {
        if (!Array.isArray(accountAddresses) || accountAddresses.length === 0) {
            logger.warn('Invalid account addresses for subscription');
            return false;
        }

        const subscription = { 
            method: 'subscribeAccountTrade', 
            keys: accountAddresses 
        };
        
        if (this.send(subscription)) {
            this.subscriptions.add(subscription);
            logger.info(`[${this.connectionId}] Subscribed to account trades for ${accountAddresses.length} accounts`);
            return true;
        }
        return false;
    }

    subscribeMigration() {
        const subscription = { method: 'subscribeMigration' };
        if (this.send(subscription)) {
            this.subscriptions.add(subscription);
            logger.info(`[${this.connectionId}] Subscribed to migration events`);
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