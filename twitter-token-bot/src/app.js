// src/app.js - Main PumpFun Token Monitoring Application
const WebSocketManager = require('./services/websocketManager');
const TokenDeploymentMonitor = require('./monitors/tokenDeploymentMonitor');
const logger = require('./utils/logger');
const config = require('./config/monitoringConfig');

class PumpFunMonitoringApp {
    constructor(appConfig = {}) {
        this.config = {
            // WebSocket configuration
            websocket: {
                maxReconnectAttempts: 10,
                reconnectDelay: 5000,
                pingInterval: 30000,
                ...appConfig.websocket
            },
            
            // Monitoring configuration
            monitoring: {
                minTwitterViews: 100000,
                analysisTimeout: 5 * 60 * 1000, // 5 minutes
                maxConcurrentAnalyses: 3,
                processingDelay: 2000,
                enabledAnalyses: ['bundle', 'topHolders', 'devAnalysis', 'teamSupply', 'freshWallets'],
                ...appConfig.monitoring
            },
            
            // Telegram configuration
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                channels: [process.env.TELEGRAM_CHANNEL_ID].filter(Boolean),
                enablePreviews: true,
                ...appConfig.telegram
            },
            
            // Application settings
            app: {
                enableHealthCheck: true,
                healthCheckInterval: 60000, // 1 minute
                enableMetrics: true,
                gracefulShutdownTimeout: 30000,
                ...appConfig.app
            }
        };

        // Initialize components
        this.wsManager = null;
        this.tokenMonitor = null;
        this.isRunning = false;
        this.startTime = null;
        this.metrics = {
            tokensProcessed: 0,
            analysesCompleted: 0,
            analysesPublished: 0,
            errors: 0,
            uptime: 0
        };

        // Bind methods
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);
        this.handleNewToken = this.handleNewToken.bind(this);
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
            logger.info('🚀 Starting PumpFun Token Monitoring Application...');
            this.startTime = Date.now();

            // Validate configuration
            await this.validateConfiguration();

            // Initialize WebSocket manager
            await this.initializeWebSocket();

            // Initialize token deployment monitor
            await this.initializeTokenMonitor();

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
        const required = ['HELIUS_RPC_URL'];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        // Validate Twitter configuration
        if (!process.env.TWITTER_BEARER_TOKEN && !process.env.X_BEARER_TOKEN) {
            logger.warn('⚠️ No Twitter API credentials found - engagement validation may be limited');
        }

        // Validate Telegram configuration
        if (!this.config.telegram.botToken) {
            logger.warn('⚠️ No Telegram bot token - publishing disabled');
        } else if (this.config.telegram.channels.length === 0) {
            logger.warn('⚠️ No Telegram channels configured - results will not be published');
        }

        logger.info('✅ Configuration validation completed');
    }

    async initializeWebSocket() {
        logger.info('🔌 Initializing WebSocket connection...');
        
        this.wsManager = new WebSocketManager(this.config.websocket);
        
        // Setup event listeners
        this.wsManager.on('connected', () => {
            logger.info('✅ WebSocket connected successfully');
            // Subscribe to new token events
            this.wsManager.subscribeNewToken();
        });

        this.wsManager.on('disconnected', ({ code, reason }) => {
            logger.warn(`⚠️ WebSocket disconnected: ${code} - ${reason}`);
            this.metrics.errors++;
        });

        this.wsManager.on('newToken', this.handleNewToken);
        this.wsManager.on('error', this.handleError);
        
        this.wsManager.on('maxReconnectAttemptsReached', () => {
            logger.error('❌ Max WebSocket reconnection attempts reached');
            this.handleCriticalError('WebSocket connection failed permanently');
        });

        // Connect to WebSocket
        await this.wsManager.connect();
    }

    async initializeTokenMonitor() {
        logger.info('📊 Initializing token deployment monitor...');
        
        this.tokenMonitor = new TokenDeploymentMonitor(this.config.monitoring);
        
        // Setup event listeners
        this.tokenMonitor.on('analysisCompleted', this.handleAnalysisCompleted);
        this.tokenMonitor.on('error', this.handleError);

        logger.info('✅ Token monitor initialized');
    }

    handleNewToken(tokenEvent) {
        try {
            this.metrics.tokensProcessed++;
            logger.debug(`📥 New token received: ${tokenEvent.symbol} (${tokenEvent.mint})`);
            
            // Process the token through the monitor
            this.tokenMonitor.processNewToken(tokenEvent);
            
        } catch (error) {
            logger.error('Error handling new token:', error);
            this.metrics.errors++;
        }
    }

    handleAnalysisCompleted({ tokenEvent, twitterMetrics, analysisResult, operationId }) {
        try {
            this.metrics.analysesCompleted++;
            
            if (analysisResult.success) {
                this.metrics.analysesPublished++;
                logger.info(`✅ Analysis completed and published for ${tokenEvent.symbol}`);
            } else {
                logger.warn(`⚠️ Analysis completed with limited success for ${tokenEvent.symbol}`);
            }

            // Log summary
            const duration = analysisResult.duration ? `${Math.round(analysisResult.duration / 1000)}s` : 'unknown';
            const riskLevel = analysisResult.summary?.riskLevel || 'unknown';
            
            logger.info(`📈 ${tokenEvent.symbol}: Risk=${riskLevel}, Duration=${duration}, Twitter=${twitterMetrics.views} views`);
            
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
        
        // Try to send alert if Telegram is configured
        if (this.tokenMonitor?.telegramPublisher) {
            this.tokenMonitor.telegramPublisher.publishSimpleAlert(
                { symbol: 'SYSTEM' },
                `🚨 Critical Error: ${message}\n\nApplication may need manual intervention.`,
                'high'
            ).catch(err => logger.error('Failed to send critical error alert:', err));
        }
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
            websocket: this.wsManager?.getConnectionInfo() || {},
            monitor: this.tokenMonitor?.getStatus() || {},
            metrics: this.getMetrics(),
            memory: process.memoryUsage(),
            errors: this.metrics.errors
        };

        // Log health status periodically
        if (this.metrics.tokensProcessed % 100 === 0 && this.metrics.tokensProcessed > 0) {
            logger.info(`💓 Health Check - Uptime: ${Math.round(health.uptime / 1000 / 60)}min, Tokens: ${this.metrics.tokensProcessed}, Analyses: ${this.metrics.analysesCompleted}`);
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
        
        // Clean up token monitor cache periodically
        if (this.tokenMonitor) {
            this.tokenMonitor.clearProcessedTokens();
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
        logger.info(`   • Min Twitter Views: ${this.config.monitoring.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Analysis Timeout: ${this.config.monitoring.analysisTimeout / 1000}s`);
        logger.info(`   • Max Concurrent: ${this.config.monitoring.maxConcurrentAnalyses}`);
        logger.info(`   • Enabled Analyses: ${this.config.monitoring.enabledAnalyses.join(', ')}`);
        logger.info(`   • Telegram Channels: ${this.config.telegram.channels.length}`);
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

            // Stop token monitor
            if (this.tokenMonitor) {
                // Cancel any active analyses
                const status = this.tokenMonitor.getStatus();
                logger.info(`Stopping with ${status.currentlyAnalyzing} active analyses`);
                this.tokenMonitor = null;
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
            startTime: this.startTime,
            websocket: this.wsManager?.getConnectionInfo() || null,
            monitor: this.tokenMonitor?.getStatus() || null,
            metrics: this.getMetrics(),
            config: {
                minTwitterViews: this.config.monitoring.minTwitterViews,
                enabledAnalyses: this.config.monitoring.enabledAnalyses,
                telegramChannels: this.config.telegram.channels.length
            }
        };
    }

    // Development/testing methods
    async testConfiguration() {
        const results = {
            websocket: { configured: !!this.wsManager },
            telegram: null
        };

        if (this.tokenMonitor?.telegramPublisher) {
            results.telegram = await this.tokenMonitor.telegramPublisher.testConfiguration();
        }

        return results;
    }
}

// Export for use as module
module.exports = PumpFunMonitoringApp;

// Run as standalone application if called directly
if (require.main === module) {
    const app = new PumpFunMonitoringApp();
    
    app.start().catch(error => {
        logger.error('Failed to start application:', error);
        process.exit(1);
    });
}