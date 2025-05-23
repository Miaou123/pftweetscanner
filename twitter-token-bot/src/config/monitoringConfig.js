// src/config/monitoringConfig.js
require('dotenv').config();

module.exports = {
    // WebSocket Configuration
    websocket: {
        url: 'wss://pumpportal.fun/api/data',
        maxReconnectAttempts: parseInt(process.env.WS_MAX_RECONNECT_ATTEMPTS) || 10,
        reconnectDelay: parseInt(process.env.WS_RECONNECT_DELAY) || 5000,
        pingInterval: parseInt(process.env.WS_PING_INTERVAL) || 30000,
    },

    // Twitter Validation Settings
    twitter: {
        minViews: parseInt(process.env.MIN_TWITTER_VIEWS) || 100000,
        minLikes: parseInt(process.env.MIN_TWITTER_LIKES) || 0,
        minRetweets: parseInt(process.env.MIN_TWITTER_RETWEETS) || 0,
        timeout: parseInt(process.env.TWITTER_TIMEOUT) || 10000,
        maxRetries: parseInt(process.env.TWITTER_MAX_RETRIES) || 3,
        rateLimitDelay: parseInt(process.env.TWITTER_RATE_LIMIT_DELAY) || 60000,
        useEmbedMethod: process.env.TWITTER_USE_EMBED !== 'false',
    },

    // Analysis Configuration
    analysis: {
        timeout: parseInt(process.env.ANALYSIS_TIMEOUT) || 5 * 60 * 1000, // 5 minutes
        maxConcurrent: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || 3,
        enabled: (process.env.ENABLED_ANALYSES || 'bundle,topHolders,devAnalysis,teamSupply,freshWallets').split(','),
        
        // Analysis-specific settings
        bundle: {
            minPercentageThreshold: parseFloat(process.env.BUNDLE_MIN_PERCENTAGE) || 10,
        },
        
        topHolders: {
            minHoldersCount: parseInt(process.env.MIN_HOLDERS_COUNT) || 20,
            controlThreshold: parseFloat(process.env.HOLDER_CONTROL_THRESHOLD) || 50,
        },
        
        teamSupply: {
            freshWalletThreshold: parseInt(process.env.FRESH_WALLET_THRESHOLD) || 100,
            supplyThreshold: parseFloat(process.env.TEAM_SUPPLY_THRESHOLD) || 0.1,
        },
        
        devAnalysis: {
            minBondedPercentage: parseFloat(process.env.MIN_BONDED_PERCENTAGE) || 30,
        }
    },

    // Processing Configuration
    processing: {
        delay: parseInt(process.env.PROCESSING_DELAY) || 2000,
        batchSize: parseInt(process.env.PROCESSING_BATCH_SIZE) || 3,
        retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
        queueMaxSize: parseInt(process.env.QUEUE_MAX_SIZE) || 100,
    },

    // Telegram Configuration
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        channels: (process.env.TELEGRAM_CHANNELS || process.env.TELEGRAM_CHANNEL_ID || '')
            .split(',')
            .filter(Boolean),
        maxMessageLength: parseInt(process.env.TELEGRAM_MAX_MESSAGE_LENGTH) || 4096,
        enablePreviews: process.env.TELEGRAM_ENABLE_PREVIEWS !== 'false',
        retryAttempts: parseInt(process.env.TELEGRAM_RETRY_ATTEMPTS) || 3,
        retryDelay: parseInt(process.env.TELEGRAM_RETRY_DELAY) || 5000,
    },

    // Database Configuration (if using database)
    database: {
        url: process.env.DATABASE_URL || process.env.MONGODB_URI,
        name: process.env.DATABASE_NAME || 'pumpfun_monitor',
        options: {
            maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10,
            serverSelectionTimeoutMS: parseInt(process.env.DB_TIMEOUT) || 5000,
        }
    },

    // Application Settings
    app: {
        logLevel: process.env.LOG_LEVEL || 'info',
        enableHealthCheck: process.env.ENABLE_HEALTH_CHECK !== 'false',
        healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 60000,
        enableMetrics: process.env.ENABLE_METRICS !== 'false',
        gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT) || 30000,
        maxMemoryUsage: parseInt(process.env.MAX_MEMORY_USAGE) || 512 * 1024 * 1024, // 512MB
    },

    // Risk Assessment Thresholds
    risk: {
        // Bundle detection thresholds
        bundle: {
            lowRisk: 5,      // <5% bundled = low risk
            mediumRisk: 15,  // 5-15% bundled = medium risk
            highRisk: 30,    // 15-30% bundled = high risk
            // >30% bundled = very high risk
        },
        
        // Team supply thresholds  
        teamSupply: {
            lowRisk: 10,     // <10% team control = low risk
            mediumRisk: 25,  // 10-25% team control = medium risk
            highRisk: 50,    // 25-50% team control = high risk
            // >50% team control = very high risk
        },
        
        // Fresh wallet thresholds
        freshWallets: {
            lowRisk: 15,     // <15% fresh wallets = low risk
            mediumRisk: 30,  // 15-30% fresh wallets = medium risk
            highRisk: 50,    // 30-50% fresh wallets = high risk
            // >50% fresh wallets = very high risk
        },
        
        // Top holder concentration thresholds
        topHolders: {
            lowRisk: 40,     // <40% top holder control = low risk
            mediumRisk: 60,  // 40-60% top holder control = medium risk
            highRisk: 80,    // 60-80% top holder control = high risk
            // >80% top holder control = very high risk
        }
    },

    // Rate Limiting Configuration
    rateLimits: {
        twitter: {
            requestsPerMinute: parseInt(process.env.TWITTER_REQUESTS_PER_MINUTE) || 30,
            requestsPerHour: parseInt(process.env.TWITTER_REQUESTS_PER_HOUR) || 300,
        },
        
        telegram: {
            messagesPerMinute: parseInt(process.env.TELEGRAM_MESSAGES_PER_MINUTE) || 20,
            messagesPerHour: parseInt(process.env.TELEGRAM_MESSAGES_PER_HOUR) || 100,
        },
        
        analysis: {
            tokensPerMinute: parseInt(process.env.ANALYSIS_TOKENS_PER_MINUTE) || 10,
            tokensPerHour: parseInt(process.env.ANALYSIS_TOKENS_PER_HOUR) || 100,
        }
    },

    // Feature Flags
    features: {
        enableBundleAnalysis: process.env.ENABLE_BUNDLE_ANALYSIS !== 'false',
        enableDevAnalysis: process.env.ENABLE_DEV_ANALYSIS !== 'false',
        enableTeamSupplyAnalysis: process.env.ENABLE_TEAM_SUPPLY_ANALYSIS !== 'false',
        enableFreshWalletAnalysis: process.env.ENABLE_FRESH_WALLET_ANALYSIS !== 'false',
        enableTopHolderAnalysis: process.env.ENABLE_TOP_HOLDER_ANALYSIS !== 'false',
        enableTwitterValidation: process.env.ENABLE_TWITTER_VALIDATION !== 'false',
        enableTelegramPublishing: process.env.ENABLE_TELEGRAM_PUBLISHING !== 'false',
        enableDatabaseLogging: process.env.ENABLE_DATABASE_LOGGING !== 'false',
    },

    // Environment-specific settings
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',

    // Validation function
    validate() {
        const errors = [];
        
        // Check required environment variables
        if (!process.env.HELIUS_RPC_URL) {
            errors.push('HELIUS_RPC_URL is required');
        }
        
        if (this.features.enableTwitterValidation && 
            !process.env.TWITTER_BEARER_TOKEN && 
            !process.env.X_BEARER_TOKEN) {
            errors.push('Twitter Bearer Token is required when Twitter validation is enabled');
        }
        
        if (this.features.enableTelegramPublishing && !this.telegram.botToken) {
            errors.push('TELEGRAM_BOT_TOKEN is required when Telegram publishing is enabled');
        }
        
        if (this.features.enableTelegramPublishing && this.telegram.channels.length === 0) {
            errors.push('At least one Telegram channel must be configured when publishing is enabled');
        }
        
        // Validate numeric ranges
        if (this.twitter.minViews < 0) {
            errors.push('MIN_TWITTER_VIEWS must be a positive number');
        }
        
        if (this.analysis.maxConcurrent < 1 || this.analysis.maxConcurrent > 10) {
            errors.push('MAX_CONCURRENT_ANALYSES must be between 1 and 10');
        }
        
        if (this.processing.delay < 100) {
            errors.push('PROCESSING_DELAY must be at least 100ms');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    },

    // Get configuration summary for logging
    getSummary() {
        return {
            websocket: {
                maxReconnectAttempts: this.websocket.maxReconnectAttempts,
                pingInterval: this.websocket.pingInterval
            },
            twitter: {
                minViews: this.twitter.minViews,
                useEmbedMethod: this.twitter.useEmbedMethod
            },
            analysis: {
                timeout: this.analysis.timeout,
                maxConcurrent: this.analysis.maxConcurrent,
                enabled: this.analysis.enabled
            },
            telegram: {
                channelsConfigured: this.telegram.channels.length,
                publishingEnabled: this.features.enableTelegramPublishing
            },
            features: this.features
        };
    }
};

// Validate configuration on load
const config = module.exports;
const validation = config.validate();

if (!validation.isValid) {
    console.error('❌ Configuration validation failed:');
    validation.errors.forEach(error => console.error(`   • ${error}`));
    
    if (config.isProduction) {
        process.exit(1);
    } else {
        console.warn('⚠️ Continuing with invalid configuration in non-production environment');
    }
}