// src/config/analysisConfig.js
require('dotenv').config();

/**
 * Analysis Configuration Manager
 * Handles different analysis settings for creation and migration bots
 */
class AnalysisConfig {
    constructor() {
        this.globalConfig = this.loadGlobalConfig();
        this.creationConfig = this.loadCreationConfig();
        this.migrationConfig = this.loadMigrationConfig();
    }

    loadGlobalConfig() {
        return {
            // Global analysis settings
            timeout: parseInt(process.env.ANALYSIS_TIMEOUT) || 5 * 60 * 1000,
            maxConcurrent: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || 3,
            
            // Bundle analysis thresholds
            bundle: {
                minPercentageThreshold: parseFloat(process.env.BUNDLE_MIN_PERCENTAGE) || 10,
                highRiskThreshold: parseFloat(process.env.BUNDLE_HIGH_RISK_PERCENTAGE) || 30,
            },
            
            // Top holders analysis thresholds
            topHolders: {
                minHoldersCount: parseInt(process.env.TOP_HOLDERS_MIN_COUNT) || 20,
                controlThreshold: parseFloat(process.env.TOP_HOLDERS_CONTROL_THRESHOLD) || 50,
            },
            
            // Fresh wallet analysis thresholds
            freshWallets: {
                threshold: parseInt(process.env.FRESH_WALLET_THRESHOLD) || 100,
                percentageThreshold: parseFloat(process.env.FRESH_WALLET_PERCENTAGE_THRESHOLD) || 15,
            },
            
            // Team supply analysis thresholds
            teamSupply: {
                freshWalletThreshold: parseInt(process.env.FRESH_WALLET_THRESHOLD) || 100,
                supplyThreshold: parseFloat(process.env.TEAM_SUPPLY_THRESHOLD) || 0.1,
            },
            
            // Dev analysis thresholds
            devAnalysis: {
                minBondedPercentage: parseFloat(process.env.MIN_BONDED_PERCENTAGE) || 30,
            }
        };
    }

    loadCreationConfig() {
        return {
            // Analysis timeout (can override global)
            timeout: parseInt(process.env.CREATION_ANALYSIS_TIMEOUT) || this.globalConfig.timeout,
            maxConcurrent: parseInt(process.env.CREATION_MAX_CONCURRENT_ANALYSES) || this.globalConfig.maxConcurrent,
            
            // Feature flags for creation bot
            enabledAnalyses: this.getEnabledAnalyses('CREATION'),
            
            // Creation-specific thresholds (can override global)
            bundle: {
                ...this.globalConfig.bundle,
                minPercentageThreshold: parseFloat(process.env.CREATION_BUNDLE_MIN_PERCENTAGE) || this.globalConfig.bundle.minPercentageThreshold,
            },
            
            topHolders: {
                ...this.globalConfig.topHolders,
                minHoldersCount: parseInt(process.env.CREATION_TOP_HOLDERS_MIN_COUNT) || this.globalConfig.topHolders.minHoldersCount,
            },
            
            freshWallets: {
                ...this.globalConfig.freshWallets,
                threshold: parseInt(process.env.CREATION_FRESH_WALLET_THRESHOLD) || this.globalConfig.freshWallets.threshold,
            },
            
            teamSupply: {
                ...this.globalConfig.teamSupply,
                supplyThreshold: parseFloat(process.env.CREATION_TEAM_SUPPLY_THRESHOLD) || this.globalConfig.teamSupply.supplyThreshold,
            },
            
            devAnalysis: {
                ...this.globalConfig.devAnalysis,
                minBondedPercentage: parseFloat(process.env.CREATION_MIN_BONDED_PERCENTAGE) || this.globalConfig.devAnalysis.minBondedPercentage,
            }
        };
    }

    loadMigrationConfig() {
        return {
            // Analysis timeout (can override global)
            timeout: parseInt(process.env.MIGRATION_ANALYSIS_TIMEOUT) || this.globalConfig.timeout,
            maxConcurrent: parseInt(process.env.MIGRATION_MAX_CONCURRENT_ANALYSES) || this.globalConfig.maxConcurrent,
            
            // Feature flags for migration bot
            enabledAnalyses: this.getEnabledAnalyses('MIGRATION'),
            
            // Migration-specific thresholds (can override global)
            bundle: {
                ...this.globalConfig.bundle,
                minPercentageThreshold: parseFloat(process.env.MIGRATION_BUNDLE_MIN_PERCENTAGE) || this.globalConfig.bundle.minPercentageThreshold,
            },
            
            topHolders: {
                ...this.globalConfig.topHolders,
                minHoldersCount: parseInt(process.env.MIGRATION_TOP_HOLDERS_MIN_COUNT) || this.globalConfig.topHolders.minHoldersCount,
            },
            
            freshWallets: {
                ...this.globalConfig.freshWallets,
                threshold: parseInt(process.env.MIGRATION_FRESH_WALLET_THRESHOLD) || this.globalConfig.freshWallets.threshold,
            },
            
            teamSupply: {
                ...this.globalConfig.teamSupply,
                supplyThreshold: parseFloat(process.env.MIGRATION_TEAM_SUPPLY_THRESHOLD) || this.globalConfig.teamSupply.supplyThreshold,
            },
            
            devAnalysis: {
                ...this.globalConfig.devAnalysis,
                minBondedPercentage: parseFloat(process.env.MIGRATION_MIN_BONDED_PERCENTAGE) || this.globalConfig.devAnalysis.minBondedPercentage,
            }
        };
    }

    getEnabledAnalyses(botType) {
        const enabledAnalyses = [];
        
        // Check each analysis type
        if (this.getBooleanEnv(`${botType}_ENABLE_BUNDLE_ANALYSIS`, true)) {
            enabledAnalyses.push('bundle');
        }
        
        if (this.getBooleanEnv(`${botType}_ENABLE_TOP_HOLDERS_ANALYSIS`, false)) {
            enabledAnalyses.push('topHolders');
        }
        
        if (this.getBooleanEnv(`${botType}_ENABLE_FRESH_WALLET_ANALYSIS`, false)) {
            enabledAnalyses.push('freshWallets');
        }
        
        if (this.getBooleanEnv(`${botType}_ENABLE_DEV_ANALYSIS`, false)) {
            enabledAnalyses.push('devAnalysis');
        }
        
        if (this.getBooleanEnv(`${botType}_ENABLE_TEAM_SUPPLY_ANALYSIS`, false)) {
            enabledAnalyses.push('teamSupply');
        }
        
        return enabledAnalyses;
    }

    getBooleanEnv(envVar, defaultValue = false) {
        const value = process.env[envVar];
        if (value === undefined) return defaultValue;
        return value.toLowerCase() === 'true';
    }

    // Get config for specific bot type
    getConfigForBot(botType) {
        switch (botType.toLowerCase()) {
            case 'creation':
                return this.creationConfig;
            case 'migration':
                return this.migrationConfig;
            default:
                throw new Error(`Unknown bot type: ${botType}`);
        }
    }

    // Check if specific analysis is enabled for bot type
    isAnalysisEnabled(botType, analysisType) {
        const config = this.getConfigForBot(botType);
        return config.enabledAnalyses.includes(analysisType);
    }

    // Get analysis thresholds for specific bot and analysis type
    getAnalysisThresholds(botType, analysisType) {
        const config = this.getConfigForBot(botType);
        return config[analysisType] || {};
    }

    // Get summary of enabled analyses for logging
    getEnabledAnalysesSummary() {
        return {
            creation: {
                enabled: this.creationConfig.enabledAnalyses,
                count: this.creationConfig.enabledAnalyses.length
            },
            migration: {
                enabled: this.migrationConfig.enabledAnalyses,
                count: this.migrationConfig.enabledAnalyses.length
            }
        };
    }

    // Validation method
    validate() {
        const errors = [];
        
        // Ensure at least one analysis is enabled for each active bot
        if (this.creationConfig.enabledAnalyses.length === 0) {
            errors.push('No analyses enabled for creation bot');
        }
        
        if (this.migrationConfig.enabledAnalyses.length === 0) {
            errors.push('No analyses enabled for migration bot');
        }
        
        // Validate thresholds
        if (this.globalConfig.bundle.minPercentageThreshold < 0 || this.globalConfig.bundle.minPercentageThreshold > 100) {
            errors.push('Bundle min percentage threshold must be between 0 and 100');
        }
        
        if (this.globalConfig.topHolders.controlThreshold < 0 || this.globalConfig.topHolders.controlThreshold > 100) {
            errors.push('Top holders control threshold must be between 0 and 100');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Get configuration summary for logging
    getSummary() {
        return {
            global: {
                timeout: this.globalConfig.timeout,
                maxConcurrent: this.globalConfig.maxConcurrent
            },
            creation: {
                enabledAnalyses: this.creationConfig.enabledAnalyses,
                timeout: this.creationConfig.timeout
            },
            migration: {
                enabledAnalyses: this.migrationConfig.enabledAnalyses,
                timeout: this.migrationConfig.timeout
            }
        };
    }
}

// Export singleton instance
module.exports = new AnalysisConfig();