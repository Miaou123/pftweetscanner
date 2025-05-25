// src/config.js - Simplified configuration
require('dotenv').config();

const config = {
    // Core settings
    botMode: process.env.BOT_MODE || 'both',
    
    // Solana (REQUIRED)
    heliusRpcUrl: process.env.HELIUS_RPC_URL,
    
    // Twitter scraping settings
    twitter: {
        minViewsCreation: parseInt(process.env.CREATION_MIN_TWITTER_VIEWS) || 100000,
        minLikesCreation: parseInt(process.env.CREATION_MIN_TWITTER_LIKES) || 100,
        minViewsMigration: parseInt(process.env.MIGRATION_MIN_TWITTER_VIEWS) || 50000,
        minLikesMigration: parseInt(process.env.MIGRATION_MIN_TWITTER_LIKES) || 1,
        timeout: parseInt(process.env.TWITTER_TIMEOUT) || 15000,
    },
    
    // Telegram
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        creationChannels: [process.env.CREATION_TELEGRAM_CHANNEL_ID].filter(Boolean),
        migrationChannels: [process.env.MIGRATION_TELEGRAM_CHANNEL_ID].filter(Boolean),
    },
    
    // Analysis settings
    analysis: {
        timeout: parseInt(process.env.ANALYSIS_TIMEOUT) || 5 * 60 * 1000,
        maxConcurrent: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || 3,
        bundleThreshold: parseFloat(process.env.BUNDLE_MIN_PERCENTAGE) || 10,
        
        // Simple analysis enabling based on bot type
        creation: {
            enableBundle: process.env.CREATION_ENABLE_BUNDLE_ANALYSIS !== 'false',
            enableTopHolders: process.env.CREATION_ENABLE_TOP_HOLDERS_ANALYSIS === 'true',
            enabledAnalyses: []
        },
        migration: {
            enableBundle: process.env.MIGRATION_ENABLE_BUNDLE_ANALYSIS !== 'false', 
            enableTopHolders: process.env.MIGRATION_ENABLE_TOP_HOLDERS_ANALYSIS !== 'false',
            enabledAnalyses: []
        }
    },
    
    // Processing
    processing: {
        delay: parseInt(process.env.PROCESSING_DELAY) || 2000,
        queueMaxSize: parseInt(process.env.QUEUE_MAX_SIZE) || 100,
    },
    
    // WebSocket
    websocket: {
        url: 'wss://pumpportal.fun/api/data',
        maxReconnectAttempts: parseInt(process.env.WS_MAX_RECONNECT_ATTEMPTS) || 10,
        reconnectDelay: parseInt(process.env.WS_RECONNECT_DELAY) || 5000,
        pingInterval: parseInt(process.env.WS_PING_INTERVAL) || 30000,
    },
    
    // Environment
    isDevelopment: process.env.NODE_ENV === 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
};

// Build enabled analyses arrays
if (config.analysis.creation.enableBundle) {
    config.analysis.creation.enabledAnalyses.push('bundle');
}
if (config.analysis.creation.enableTopHolders) {
    config.analysis.creation.enabledAnalyses.push('topHolders');
}

if (config.analysis.migration.enableBundle) {
    config.analysis.migration.enabledAnalyses.push('bundle');
}
if (config.analysis.migration.enableTopHolders) {
    config.analysis.migration.enabledAnalyses.push('topHolders');
}

// Helper functions for backward compatibility
config.getConfigForBot = function(botType) {
    const botConfig = this.analysis[botType] || this.analysis.creation;
    return {
        enabledAnalyses: botConfig.enabledAnalyses,
        timeout: this.analysis.timeout,
        maxConcurrent: this.analysis.maxConcurrent,
        bundle: { minPercentageThreshold: this.analysis.bundleThreshold },
        topHolders: { minHoldersCount: 20, controlThreshold: 50 }
    };
};

config.isAnalysisEnabled = function(botType, analysisType) {
    const botConfig = this.analysis[botType] || this.analysis.creation;
    return botConfig.enabledAnalyses.includes(analysisType);
};

// Minimal validation
function validate() {
    const errors = [];
    
    if (!config.heliusRpcUrl) {
        errors.push('HELIUS_RPC_URL is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// Validate on load
const validation = validate();
if (!validation.isValid) {
    console.error('❌ Configuration errors:');
    validation.errors.forEach(error => console.error(`   • ${error}`));
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

module.exports = config;