// src/services/websocketManager.js - Enhanced with comprehensive migration logging
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
        
        // Track subscriptions to respect bot mode
        this.subscriptions = {
            newToken: false,
            migration: false
        };
        
        this.messageStats = {
            received: 0,
            processed: 0,
            errors: 0,
            migrations: 0,  // 🔥 NEW: Track migration count
            newTokens: 0,   // 🔥 NEW: Track new token count
            other: 0        // 🔥 NEW: Track other message types
        };

        // 🔥 NEW: Migration debugging stats
        this.migrationStats = {
            total: 0,
            withMint: 0,
            withSignature: 0,
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
                
                // 🔥 LOG ALL MESSAGES FIRST (for debugging)
                this.logRawMessage(message);
                
                // Process new tokens
                if (message.txType === 'create' && this.subscriptions.newToken) {
                    this.messageStats.newTokens++;
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
                // 🔥 ENHANCED MIGRATION PROCESSING
                else if (message.txType === 'migration' && this.subscriptions.migration) {
                    this.messageStats.migrations++;
                    this.migrationStats.total++;
                    
                    // 🔥 ALWAYS LOG MIGRATION DATA (even if processing fails)
                    logger.info(`[${this.connectionId}] 🔄 MIGRATION DETECTED:`);
                    logger.info(`   • Raw Data: ${JSON.stringify(message, null, 2)}`);
                    
                    // Validate migration data
                    if (message.mint) {
                        this.migrationStats.withMint++;
                        logger.info(`   • Mint: ${message.mint}`);
                    } else {
                        logger.warn(`   • ⚠️ Missing mint field!`);
                    }
                    
                    if (message.signature) {
                        this.migrationStats.withSignature++;
                        logger.info(`   • Signature: ${message.signature}`);
                    } else {
                        logger.warn(`   • ⚠️ Missing signature field!`);
                    }
                    
                    // Log all available fields
                    const fields = Object.keys(message);
                    logger.info(`   • Available fields: ${fields.join(', ')}`);
                    
                    try {
                        const migrationEvent = {
                            eventType: 'migration',
                            mint: message.mint,
                            signature: message.signature,
                            timestamp: Date.now(),
                            operationId: `${message.mint || 'unknown'}_migration_${Date.now()}`,
                            timer: createTimer(`${message.mint || 'unknown'}_migration_${Date.now()}`),
                            rawData: message // Include full raw data
                        };
                        
                        this.migrationStats.processed++;
                        this.messageStats.processed++;
                        
                        logger.info(`[${this.connectionId}] ✅ Migration event created for ${message.mint}`);
                        this.emit('tokenMigration', migrationEvent);
                        
                    } catch (migrationError) {
                        this.migrationStats.errors++;
                        logger.error(`[${this.connectionId}] ❌ Error creating migration event:`, migrationError);
                        logger.error(`   • Message that caused error: ${JSON.stringify(message, null, 2)}`);
                    }
                }
                // Log ignored messages for debugging
                else if (message.txType === 'create' && !this.subscriptions.newToken) {
                    logger.debug(`[${this.connectionId}] 🚫 IGNORED NEW TOKEN (not subscribed): ${message.name || 'Unknown'}`);
                }
                else if (message.txType === 'migration' && !this.subscriptions.migration) {
                    logger.debug(`[${this.connectionId}] 🚫 IGNORED MIGRATION (not subscribed): ${message.mint || 'Unknown'}`);
                }
                else {
                    this.messageStats.other++;
                    logger.debug(`[${this.connectionId}] OTHER: ${message.txType || 'NO_TYPE'} | Keys: ${Object.keys(message).join(', ')}`);
                }
                
            } catch (error) {
                this.messageStats.errors++;
                logger.error(`[${this.connectionId}] Parse error:`, error);
                logger.error(`[${this.connectionId}] Raw message that failed: ${data.toString()}`);
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

    // 🔥 NEW: Log raw messages for debugging
    logRawMessage(message) {
        const txType = message.txType || 'UNKNOWN';
        const fields = Object.keys(message);
        
        // Log every 100th message to avoid spam, but always log migrations
        if (txType === 'migration' || this.messageStats.received % 100 === 0) {
            logger.debug(`[${this.connectionId}] RAW MESSAGE #${this.messageStats.received}:`);
            logger.debug(`   • Type: ${txType}`);
            logger.debug(`   • Fields: ${fields.join(', ')}`);
            
            if (txType === 'migration') {
                logger.debug(`   • Full Data: ${JSON.stringify(message, null, 2)}`);
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

        this.ws.send(JSON.stringify(payload));
        return true;
    }

    subscribeNewToken() {
        if (this.send({ method: 'subscribeNewToken' })) {
            this.subscriptions.newToken = true;
            logger.info(`[${this.connectionId}] ✅ Subscribed to new tokens`);
            return true;
        }
        return false;
    }

    subscribeMigration() {
        if (this.send({ method: 'subscribeMigration' })) {
            this.subscriptions.migration = true;
            logger.info(`[${this.connectionId}] ✅ Subscribed to migrations`);
            return true;
        }
        return false;
    }

    resubscribeAll() {
        if (this.subscriptions.newToken) {
            setTimeout(() => this.subscribeNewToken(), 100);
        }
        if (this.subscriptions.migration) {
            setTimeout(() => this.subscribeMigration(), 200);
        }
        
        // Log what we're resubscribing to
        const subs = [];
        if (this.subscriptions.newToken) subs.push('newToken');
        if (this.subscriptions.migration) subs.push('migration');
        logger.info(`[${this.connectionId}] 🔄 Resubscribing to: ${subs.join(', ') || 'nothing'}`);
    }

    // 🔥 ENHANCED: Get detailed connection info including migration stats
    getConnectionInfo() {
        return {
            connectionId: this.connectionId,
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            messageStats: this.messageStats,
            subscriptions: this.subscriptions,
            migrationStats: this.migrationStats, // 🔥 NEW: Migration debugging info
            detailedStats: {
                totalMessages: this.messageStats.received,
                newTokens: this.messageStats.newTokens,
                migrations: this.messageStats.migrations,
                other: this.messageStats.other,
                errors: this.messageStats.errors,
                processed: this.messageStats.processed
            }
        };
    }

    // 🔥 NEW: Get migration statistics
    getMigrationStats() {
        return {
            ...this.migrationStats,
            successRate: this.migrationStats.total > 0 ? 
                ((this.migrationStats.processed / this.migrationStats.total) * 100).toFixed(1) + '%' : '0%',
            dataQuality: {
                withMint: this.migrationStats.withMint,
                withSignature: this.migrationStats.withSignature,
                completeness: this.migrationStats.total > 0 ? 
                    ((this.migrationStats.withMint / this.migrationStats.total) * 100).toFixed(1) + '%' : '0%'
            }
        };
    }

    // 🔥 NEW: Log comprehensive stats periodically
    logStats() {
        logger.info(`[${this.connectionId}] 📊 WebSocket Stats:`);
        logger.info(`   • Total Messages: ${this.messageStats.received}`);
        logger.info(`   • New Tokens: ${this.messageStats.newTokens}`);
        logger.info(`   • Migrations: ${this.messageStats.migrations}`);
        logger.info(`   • Other: ${this.messageStats.other}`);
        logger.info(`   • Errors: ${this.messageStats.errors}`);
        logger.info(`   • Processed: ${this.messageStats.processed}`);
        
        if (this.migrationStats.total > 0) {
            logger.info(`[${this.connectionId}] 🔄 Migration Stats:`);
            logger.info(`   • Total Detected: ${this.migrationStats.total}`);
            logger.info(`   • With Mint: ${this.migrationStats.withMint}/${this.migrationStats.total}`);
            logger.info(`   • With Signature: ${this.migrationStats.withSignature}/${this.migrationStats.total}`);
            logger.info(`   • Successfully Processed: ${this.migrationStats.processed}/${this.migrationStats.total}`);
            logger.info(`   • Errors: ${this.migrationStats.errors}`);
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
        this.isConnected = false;
        // Reset subscriptions
        this.subscriptions = {
            newToken: false,
            migration: false
        };
    }
}

module.exports = WebSocketManager;