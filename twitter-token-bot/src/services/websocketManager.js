// src/services/websocketManager.js - Clean and simple
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
        
        this.messageStats = {
            received: 0,
            processed: 0,
            errors: 0
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
            logger.info(`[${this.connectionId}] Connected successfully`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.resubscribeAll();
            this.emit('connected');
        });

        this.ws.on('message', (data) => {
            this.messageStats.received++;
            
            try {
                const message = JSON.parse(data.toString());
                
                // Skip subscription confirmations
                if (message.message && message.message.includes('Successfully subscribed')) {
                    logger.info(`[${this.connectionId}] ✅ ${message.message}`);
                    return;
                }
                
                // Token creation
                if (message.txType === 'create') {
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
                    
                    this.messageStats.processed++;
                    this.emit('newToken', tokenEvent);
                }
                // Token migration
                else if (message.txType === 'migration') {
                    logger.info(`[${this.connectionId}] 🔄 MIGRATION RAW DATA:`);
                    logger.info(JSON.stringify(message, null, 2));
                    
                    const migrationEvent = {
                        eventType: 'migration',
                        mint: message.mint,
                        signature: message.signature,
                        timestamp: Date.now(),
                        operationId: `${message.mint}_migration_${Date.now()}`,
                        timer: createTimer(`${message.mint}_migration_${Date.now()}`),
                        rawData: message
                    };
                    
                    this.messageStats.processed++;
                    this.emit('tokenMigration', migrationEvent);
                }
                // Everything else
                else {
                    logger.debug(`[${this.connectionId}] OTHER: ${message.txType || 'NO_TYPE'} | Keys: ${Object.keys(message).join(', ')}`);
                }
                
            } catch (error) {
                this.messageStats.errors++;
                logger.error(`[${this.connectionId}] Parse error:`, error);
            }
        });

        this.ws.on('error', (error) => {
            logger.error(`[${this.connectionId}] WebSocket error:`, error);
            this.emit('error', error);
        });

        this.ws.on('close', (code, reason) => {
            logger.warn(`[${this.connectionId}] Closed: ${code} - ${reason}`);
            this.isConnected = false;
            this.emit('disconnected', { code, reason });
            
            if (code !== 1000) {
                this.scheduleReconnect();
            }
        });
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

        this.ws.send(JSON.stringify(payload));
        return true;
    }

    subscribeNewToken() {
        if (this.send({ method: 'subscribeNewToken' })) {
            logger.info(`[${this.connectionId}] ✅ Subscribed to new tokens`);
            return true;
        }
        return false;
    }

    subscribeMigration() {
        if (this.send({ method: 'subscribeMigration' })) {
            logger.info(`[${this.connectionId}] ✅ Subscribed to migrations`);
            return true;
        }
        return false;
    }

    resubscribeAll() {
        setTimeout(() => this.subscribeNewToken(), 100);
        setTimeout(() => this.subscribeMigration(), 200);
    }

    getConnectionInfo() {
        return {
            connectionId: this.connectionId,
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            messageStats: this.messageStats
        };
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
        this.isConnected = false;
    }
}

module.exports = WebSocketManager;