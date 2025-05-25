// src/app.js - Unified PumpFun Monitoring Application (FIXED CONFIG)
const WebSocketManager = require('./services/websocketManager');
const TokenDeploymentMonitor = require('./monitors/tokenDeploymentMonitor');
const MigrationMonitor = require('./monitors/migrationMonitor');
const logger = require('./utils/logger');
const config = require('./config'); // FIXED: Use simplified config

class PumpFunUnifiedApp {
    constructor(appConfig = {}) {
        // Determine bot mode from environment or config
        this.botMode = process.env.BOT_MODE || appConfig.botMode || 'both';
        
        this.config = {
            // WebSocket configuration
            websocket: {
                maxReconnectAttempts: 10,
                reconnectDelay: 5000,
                pingInterval: 30000,
                ...appConfig.websocket
            },
            
            // Creation Bot Configuration
            creation: {
                minTwitterLikes: config.twitter.minLikesCreation,
                analysisTimeout: config.analysis.timeout,
                maxConcurrentAnalyses: config.analysis.maxConcurrent,
                processingDelay: config.processing.delay,
                telegram: {
                    botToken: config.telegram.botToken,
                    channels: config.telegram.creationChannels,
                },
                enabledAnalyses: config.analysis.creation.enabledAnalyses,
                ...appConfig.creation
            },
            
            // Migration Bot Configuration
            migration: {
                minTwitterLikes: config.twitter.minLikesMigration,
                analysisTimeout: config.analysis.timeout,
                maxConcurrentAnalyses: config.analysis.maxConcurrent,
                processingDelay: config.processing.delay,
                telegram: {
                    botToken: config.telegram.botToken,
                    channels: config.telegram.migrationChannels,
                },
                enabledAnalyses: config.analysis.migration.enabledAnalyses,
                ...appConfig.migration
            },
            
            // Application settings
            app: {
                enableHealthCheck: true,
                healthCheckInterval: 60000,
                enableMetrics: true,
                gracefulShutdownTimeout: 30000,
                ...appConfig.app
            }
        };

        // Initialize components
        this.wsManager = null;
        this.creationMonitor = null;
        this.migrationMonitor = null;
        this.isRunning = false;
        this.startTime = null;
        this.metrics = {
            tokensProcessed: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            analysesPublished: 0,
            errors: 0,
            uptime: 0
        };

        // Bind methods
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);
        this.handleNewToken = this.handleNewToken.bind(this);
        this.handleTokenMigration = this.handleTokenMigration.bind(this);
        this.handleAnalysisCompleted = this.handleAnalysisCompleted.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleShutdown = this.handleShutdown.bind(this);

        // Setup graceful shutdown
        this.setupShutdownHandlers();
    }

    async start() {
        if (this.isRunning) {
            logger.warn('Application is already running');
            return;
        }

        try {
            logger.info('🚀 Starting PumpFun Unified Monitoring Application...');
            logger.info(`📊 Bot Mode: ${this.botMode.toUpperCase()}`);
            this.startTime = Date.now();

            // Validate configuration
            await this.validateConfiguration();

            // Initialize WebSocket manager
            await this.initializeWebSocket();

            // Initialize monitors based on mode
            await this.initializeMonitors();

            // Start health check if enabled
            if (this.config.app.enableHealthCheck) {
                this.startHealthCheck();
            }

            // Start metrics collection if enabled
            if (this.config.app.enableMetrics) {
                this.startMetricsCollection();
            }

            this.isRunning = true;
            logger.info('✅ Application started successfully');
            
            // Log current configuration
            this.logConfiguration();

        } catch (error) {
            logger.error('❌ Failed to start application:', error);
            await this.stop();
            throw error;
        }
    }

    async validateConfiguration() {
        logger.info('🔍 Validating configuration...');

        // Check required environment variables
        if (!config.heliusRpcUrl) {
            throw new Error('Missing required environment variable: HELIUS_RPC_URL');
        }

        // Validate bot mode
        if (!['creation', 'migration', 'both'].includes(this.botMode)) {
            throw new Error(`Invalid BOT_MODE: ${this.botMode}. Must be 'creation', 'migration', or 'both'`);
        }

        logger.info('ℹ️  Using web scraping for Twitter engagement validation (no API tokens required)');

        // Validate Telegram configuration based on mode
        if (this.shouldRunCreation() && this.config.creation.telegram.channels.length === 0) {
            logger.warn('⚠️ No creation Telegram channels configured');
        }
        
        if (this.shouldRunMigration() && this.config.migration.telegram.channels.length === 0) {
            logger.warn('⚠️ No migration Telegram channels configured');
        }

        logger.info('✅ Configuration validation completed');
    }

    async initializeWebSocket() {
        logger.info('🔌 Initializing WebSocket connection...');
        
        this.wsManager = new WebSocketManager(this.config.websocket);
        
        // Setup event listeners
        this.wsManager.on('connected', () => {
            logger.info('✅ WebSocket connected successfully');
            
            // Subscribe based on bot mode
            if (this.shouldRunCreation()) {
                this.wsManager.subscribeNewToken();
            }
            if (this.shouldRunMigration()) {
                this.wsManager.subscribeMigration();
            }
        });

        this.wsManager.on('disconnected', ({ code, reason }) => {
            logger.warn(`⚠️ WebSocket disconnected: ${code} - ${reason}`);
            this.metrics.errors++;
        });

        // Setup event handlers based on mode
        if (this.shouldRunCreation()) {
            this.wsManager.on('newToken', this.handleNewToken);
        }
        if (this.shouldRunMigration()) {
            this.wsManager.on('tokenMigration', this.handleTokenMigration);
        }
        
        this.wsManager.on('error', this.handleError);
        
        this.wsManager.on('maxReconnectAttemptsReached', () => {
            logger.error('❌ Max WebSocket reconnection attempts reached');
            this.handleCriticalError('WebSocket connection failed permanently');
        });

        // Connect to WebSocket
        await this.wsManager.connect();
    }

    async initializeMonitors() {
        logger.info('📊 Initializing monitors...');
        
        // Initialize Creation Monitor
        if (this.shouldRunCreation()) {
            logger.info('🆕 Initializing Creation Monitor...');
            this.creationMonitor = new TokenDeploymentMonitor(this.config.creation);
            this.creationMonitor.on('analysisCompleted', (data) => {
                this.handleAnalysisCompleted({ ...data, source: 'creation' });
            });
            this.creationMonitor.on('error', this.handleError);
            logger.info('✅ Creation Monitor initialized');
        }
        
        // Initialize Migration Monitor
        if (this.shouldRunMigration()) {
            logger.info('🔄 Initializing Migration Monitor...');
            this.migrationMonitor = new MigrationMonitor(this.config.migration);
            this.migrationMonitor.on('analysisCompleted', (data) => {
                this.handleAnalysisCompleted({ ...data, source: 'migration' });
            });
            this.migrationMonitor.on('error', this.handleError);
            logger.info('✅ Migration Monitor initialized');
        }
    }

    shouldRunCreation() {
        return this.botMode === 'creation' || this.botMode === 'both';
    }

    shouldRunMigration() {
        return this.botMode === 'migration' || this.botMode === 'both';
    }

    handleNewToken(tokenEvent) {
        if (!this.shouldRunCreation() || !this.creationMonitor) {
            return;
        }

        try {
            this.metrics.tokensProcessed++;
            logger.debug(`📥 New token received: ${tokenEvent.symbol} (${tokenEvent.mint})`);
            
            // Process the token through the creation monitor
            this.creationMonitor.processNewToken(tokenEvent);
            
        } catch (error) {
            logger.error('Error handling new token:', error);
            this.metrics.errors++;
        }
    }

    handleTokenMigration(migrationEvent) {
        if (!this.shouldRunMigration() || !this.migrationMonitor) {
            return;
        }

        try {
            this.metrics.migrationsProcessed++;
            logger.info(`📥 Migration received: ${migrationEvent.mint}`);
            logger.debug(`Migration details:`, migrationEvent);
            
            // Process the migration through the migration monitor
            this.migrationMonitor.processTokenMigration(migrationEvent);
            
        } catch (error) {
            logger.error('Error handling token migration:', error);
            this.metrics.errors++;
        }
    }

    handleAnalysisCompleted({ tokenEvent, twitterMetrics, analysisResult, operationId, source }) {
        try {
            this.metrics.analysesCompleted++;
            
            if (analysisResult.success) {
                this.metrics.analysesPublished++;
                const eventType = source === 'migration' ? 'migration' : 'creation';
                logger.info(`✅ Analysis completed and published for ${tokenEvent.symbol} (${eventType})`);
            } else {
                logger.warn(`⚠️ Analysis completed with limited success for ${tokenEvent.symbol}`);
            }

            // Log summary with source indicator
            const duration = analysisResult.duration ? `${Math.round(analysisResult.duration / 1000)}s` : 'unknown';
            const eventEmoji = source === 'migration' ? '🔄' : '🆕';
            
            logger.info(`📈 ${eventEmoji} ${tokenEvent.symbol} (${source}): Duration=${duration}, Twitter=${twitterMetrics.views} views`);
            
        } catch (error) {
            logger.error('Error handling analysis completion:', error);
            this.metrics.errors++;
        }
    }

    handleError(error) {
        this.metrics.errors++;
        logger.error('Application error:', error);
        
        // Handle critical errors
        if (this.isCriticalError(error)) {
            this.handleCriticalError(error.message || 'Unknown critical error');
        }
    }

    isCriticalError(error) {
        const criticalPatterns = [
            /ECONNREFUSED/,
            /timeout.*exceeded/,
            /rate.*limit.*exceeded/,
            /authentication.*failed/
        ];
        
        const errorMessage = error.message || error.toString();
        return criticalPatterns.some(pattern => pattern.test(errorMessage));
    }

    handleCriticalError(message) {
        logger.error(`🚨 Critical error detected: ${message}`);
        
        // Try to send alert to both channels if configured
        const alertPromises = [];
        
        if (this.creationMonitor?.telegramPublisher) {
            alertPromises.push(
                this.creationMonitor.telegramPublisher.publishSimpleAlert(
                    { symbol: 'SYSTEM' },
                    `🚨 Critical Error (Creation Bot): ${message}`,
                    'high'
                )
            );
        }
        
        if (this.migrationMonitor?.telegramPublisher) {
            alertPromises.push(
                this.migrationMonitor.telegramPublisher.publishSimpleAlert(
                    { symbol: 'SYSTEM' },
                    `🚨 Critical Error (Migration Bot): ${message}`,
                    'high'
                )
            );
        }
        
        Promise.allSettled(alertPromises).catch(err => 
            logger.error('Failed to send critical error alerts:', err)
        );
    }

    startHealthCheck() {
        setInterval(() => {
            this.performHealthCheck();
        }, this.config.app.healthCheckInterval);
        
        logger.info(`💓 Health check started (${this.config.app.healthCheckInterval / 1000}s intervals)`);
    }

    performHealthCheck() {
        const health = {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            mode: this.botMode,
            websocket: this.wsManager?.getConnectionInfo() || {},
            creationMonitor: this.creationMonitor?.getStatus() || null,
            migrationMonitor: this.migrationMonitor?.getStatus() || null,
            metrics: this.getMetrics(),
            memory: process.memoryUsage(),
            errors: this.metrics.errors
        };

        // Log health status periodically
        const totalEvents = this.metrics.tokensProcessed + this.metrics.migrationsProcessed;
        if (totalEvents % 50 === 0 && totalEvents > 0) {
            logger.info(`💓 Health Check - Mode: ${this.botMode}, Uptime: ${Math.round(health.uptime / 1000 / 60)}min, Tokens: ${this.metrics.tokensProcessed}, Migrations: ${this.metrics.migrationsProcessed}, Analyses: ${this.metrics.analysesCompleted}`);
        }

        // Check for warning conditions
        if (health.websocket.reconnectAttempts > 5) {
            logger.warn(`⚠️ High WebSocket reconnection attempts: ${health.websocket.reconnectAttempts}`);
        }

        if (health.memory.heapUsed > 500 * 1024 * 1024) { // 500MB
            logger.warn(`⚠️ High memory usage: ${Math.round(health.memory.heapUsed / 1024 / 1024)}MB`);
        }

        return health;
    }

    startMetricsCollection() {
        setInterval(() => {
            this.updateMetrics();
        }, 60000); // Update every minute
        
        logger.info('📊 Metrics collection started');
    }

    updateMetrics() {
        this.metrics.uptime = Date.now() - this.startTime;
        
        // Clean up monitor caches periodically
        if (this.creationMonitor) {
            this.creationMonitor.clearProcessedTokens();
        }
        if (this.migrationMonitor) {
            this.migrationMonitor.clearProcessedTokens();
        }
    }

    getMetrics() {
        return {
            ...this.metrics,
            uptime: Date.now() - this.startTime,
            uptimeFormatted: this.formatUptime(this.metrics.uptime)
        };
    }

    formatUptime(uptime) {
        const seconds = Math.floor(uptime / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    logConfiguration() {
        logger.info('📋 Current Configuration:');
        logger.info(`   • Bot Mode: ${this.botMode.toUpperCase()}`);
        
        if (this.shouldRunCreation()) {
            logger.info(`   • Creation Min Twitter Likes: ${this.config.creation.minTwitterLikes.toLocaleString()}`);
            logger.info(`   • Creation Telegram Channels: ${this.config.creation.telegram.channels.length}`);
            logger.info(`   • Creation Enabled Analyses: ${this.config.creation.enabledAnalyses.join(', ')}`);
        }
        
        if (this.shouldRunMigration()) {
            logger.info(`   • Migration Min Twitter Likes: ${this.config.migration.minTwitterLikes.toLocaleString()}`);
            logger.info(`   • Migration Telegram Channels: ${this.config.migration.telegram.channels.length}`);
            logger.info(`   • Migration Enabled Analyses: ${this.config.migration.enabledAnalyses.join(', ')}`);
        }
        
        logger.info(`   • Max Concurrent Analyses: ${this.config.creation.maxConcurrentAnalyses}`);
        logger.info(`   • WebSocket Reconnects: ${this.config.websocket.maxReconnectAttempts}`);
    }

    setupShutdownHandlers() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
        
        signals.forEach(signal => {
            process.on(signal, () => {
                logger.info(`Received ${signal}, starting graceful shutdown...`);
                this.handleShutdown();
            });
        });

        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            this.handleShutdown(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection:', reason);
            this.handleShutdown(1);
        });
    }

    async handleShutdown(exitCode = 0) {
        if (!this.isRunning) {
            process.exit(exitCode);
            return;
        }

        logger.info('🛑 Shutting down gracefully...');
        
        try {
            // Set timeout for graceful shutdown
            const shutdownTimeout = setTimeout(() => {
                logger.warn('⚠️ Graceful shutdown timeout, forcing exit');
                process.exit(1);
            }, this.config.app.gracefulShutdownTimeout);

            await this.stop();
            
            clearTimeout(shutdownTimeout);
            logger.info('✅ Graceful shutdown completed');
            process.exit(exitCode);
            
        } catch (error) {
            logger.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    }

    async stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        try {
            // Disconnect WebSocket
            if (this.wsManager) {
                this.wsManager.disconnect();
                this.wsManager = null;
            }

            // Stop monitors
            if (this.creationMonitor) {
                const status = this.creationMonitor.getStatus();
                logger.info(`Stopping creation monitor with ${status.currentlyAnalyzing} active analyses`);
                this.creationMonitor = null;
            }
            
            if (this.migrationMonitor) {
                const status = this.migrationMonitor.getStatus();
                logger.info(`Stopping migration monitor with ${status.currentlyAnalyzing} active analyses`);
                this.migrationMonitor = null;
            }

            logger.info('🛑 Application stopped');
            
        } catch (error) {
            logger.error('Error stopping application:', error);
            throw error;
        }
    }

    // Public API methods
    getStatus() {
        return {
            isRunning: this.isRunning,
            mode: this.botMode,
            startTime: this.startTime,
            websocket: this.wsManager?.getConnectionInfo() || null,
            creationMonitor: this.creationMonitor?.getStatus() || null,
            migrationMonitor: this.migrationMonitor?.getStatus() || null,
            metrics: this.getMetrics(),
            config: {
                mode: this.botMode,
                creation: this.shouldRunCreation() ? {
                    minTwitterViews: this.config.creation.minTwitterViews,
                    telegramChannels: this.config.creation.telegram.channels.length
                } : null,
                migration: this.shouldRunMigration() ? {
                    minTwitterViews: this.config.migration.minTwitterViews,
                    telegramChannels: this.config.migration.telegram.channels.length
                } : null
            }
        };
    }
}

// Export for use as module
module.exports = PumpFunUnifiedApp;

// Run as standalone application if called directly
if (require.main === module) {
    const app = new PumpFunUnifiedApp();
    
    app.start().catch(error => {
        logger.error('Failed to start application:', error);
        process.exit(1);
    });
}