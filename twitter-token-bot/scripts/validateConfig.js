// scripts/validateConfig.js - Configuration validation and testing script
require('dotenv').config();
const analysisConfig = require('../src/config/analysisConfig');
const logger = require('../src/utils/logger');

class ConfigValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.info = [];
    }

    validateConfiguration() {
        console.log('🔍 Validating Analysis Configuration...\n');

        // Validate analysis config
        const validation = analysisConfig.validate();
        if (!validation.isValid) {
            this.errors.push(...validation.errors);
        }

        // Check bot mode
        this.validateBotMode();

        // Check analysis configurations
        this.validateAnalysisSettings();

        // Check environment variables
        this.validateEnvironmentVariables();

        // Display results
        this.displayResults();

        return this.errors.length === 0;
    }

    validateBotMode() {
        const botMode = process.env.BOT_MODE || 'both';
        
        if (!['creation', 'migration', 'both'].includes(botMode)) {
            this.errors.push(`Invalid BOT_MODE: ${botMode}. Must be 'creation', 'migration', or 'both'`);
        } else {
            this.info.push(`Bot Mode: ${botMode.toUpperCase()}`);
        }
    }

    validateAnalysisSettings() {
        const summary = analysisConfig.getEnabledAnalysesSummary();
        
        // Check creation bot
        if (summary.creation.count === 0) {
            this.warnings.push('No analyses enabled for creation bot');
        } else {
            this.info.push(`Creation Bot: ${summary.creation.enabled.join(', ')} (${summary.creation.count} analyses)`);
        }

        // Check migration bot
        if (summary.migration.count === 0) {
            this.warnings.push('No analyses enabled for migration bot');
        } else {
            this.info.push(`Migration Bot: ${summary.migration.enabled.join(', ')} (${summary.migration.count} analyses)`);
        }

        // Check if bundle analysis is enabled (recommended)
        if (!summary.creation.enabled.includes('bundle') && !summary.migration.enabled.includes('bundle')) {
            this.warnings.push('Bundle analysis is not enabled for any bot (recommended for both)');
        }
    }

    validateEnvironmentVariables() {
        // Required variables
        const required = [
            'HELIUS_RPC_URL'
        ];

        required.forEach(variable => {
            if (!process.env[variable]) {
                this.errors.push(`Missing required environment variable: ${variable}`);
            }
        });

        // Optional but recommended
        const recommended = [
            'TELEGRAM_BOT_TOKEN'
        ];

        recommended.forEach(variable => {
            if (!process.env[variable]) {
                this.warnings.push(`Missing recommended environment variable: ${variable}`);
            }
        });

        // Check Twitter API (optional since we use scraping)
        if (!process.env.TWITTER_BEARER_TOKEN && !process.env.X_BEARER_TOKEN) {
            this.info.push('No Twitter API credentials found - using web scraping method for engagement validation');
        } else {
            this.info.push('Twitter API credentials found - API method available for engagement validation');
        }

        // Check Telegram channels based on enabled bots
        const botMode = process.env.BOT_MODE || 'both';
        
        if ((botMode === 'creation' || botMode === 'both') && !process.env.CREATION_TELEGRAM_CHANNEL_ID) {
            this.warnings.push('Missing CREATION_TELEGRAM_CHANNEL_ID for creation bot');
        }

        if ((botMode === 'migration' || botMode === 'both') && !process.env.MIGRATION_TELEGRAM_CHANNEL_ID) {
            this.warnings.push('Missing MIGRATION_TELEGRAM_CHANNEL_ID for migration bot');
        }
    }

    displayResults() {
        console.log('📊 Configuration Validation Results:\n');

        // Display info
        if (this.info.length > 0) {
            console.log('ℹ️  Configuration Info:');
            this.info.forEach(msg => console.log(`   • ${msg}`));
            console.log();
        }

        // Display warnings
        if (this.warnings.length > 0) {
            console.log('⚠️  Warnings:');
            this.warnings.forEach(msg => console.log(`   • ${msg}`));
            console.log();
        }

        // Display errors
        if (this.errors.length > 0) {
            console.log('❌ Errors:');
            this.errors.forEach(msg => console.log(`   • ${msg}`));
            console.log();
        }

        // Summary
        if (this.errors.length === 0) {
            console.log('✅ Configuration validation passed!');
            if (this.warnings.length > 0) {
                console.log(`   Note: ${this.warnings.length} warning(s) found but not critical`);
            }
        } else {
            console.log(`❌ Configuration validation failed with ${this.errors.length} error(s)`);
        }

        console.log('\n' + '='.repeat(60) + '\n');

        // Display detailed analysis configuration
        this.displayAnalysisConfiguration();
    }

    displayAnalysisConfiguration() {
        console.log('🔬 Detailed Analysis Configuration:\n');

        const creationConfig = analysisConfig.getConfigForBot('creation');
        const migrationConfig = analysisConfig.getConfigForBot('migration');

        console.log('📊 Creation Bot Analysis Settings:');
        console.log(`   • Enabled Analyses: ${creationConfig.enabledAnalyses.join(', ') || 'None'}`);
        console.log(`   • Timeout: ${creationConfig.timeout / 1000}s`);
        console.log(`   • Max Concurrent: ${creationConfig.maxConcurrent}`);
        
        if (creationConfig.enabledAnalyses.includes('bundle')) {
            console.log(`   • Bundle Min Percentage: ${creationConfig.bundle.minPercentageThreshold}%`);
        }
        
        if (creationConfig.enabledAnalyses.includes('topHolders')) {
            console.log(`   • Top Holders Min Count: ${creationConfig.topHolders.minHoldersCount}`);
            console.log(`   • Top Holders Control Threshold: ${creationConfig.topHolders.controlThreshold}%`);
        }

        console.log('\n📊 Migration Bot Analysis Settings:');
        console.log(`   • Enabled Analyses: ${migrationConfig.enabledAnalyses.join(', ') || 'None'}`);
        console.log(`   • Timeout: ${migrationConfig.timeout / 1000}s`);
        console.log(`   • Max Concurrent: ${migrationConfig.maxConcurrent}`);
        
        if (migrationConfig.enabledAnalyses.includes('bundle')) {
            console.log(`   • Bundle Min Percentage: ${migrationConfig.bundle.minPercentageThreshold}%`);
        }
        
        if (migrationConfig.enabledAnalyses.includes('topHolders')) {
            console.log(`   • Top Holders Min Count: ${migrationConfig.topHolders.minHoldersCount}`);
            console.log(`   • Top Holders Control Threshold: ${migrationConfig.topHolders.controlThreshold}%`);
        }

        console.log('\n📋 Environment Variables for Analysis Control:');
        console.log('   Creation Bot:');
        console.log(`     CREATION_ENABLE_BUNDLE_ANALYSIS=${process.env.CREATION_ENABLE_BUNDLE_ANALYSIS || 'true'}`);
        console.log(`     CREATION_ENABLE_TOP_HOLDERS_ANALYSIS=${process.env.CREATION_ENABLE_TOP_HOLDERS_ANALYSIS || 'false'}`);
        console.log(`     CREATION_ENABLE_FRESH_WALLET_ANALYSIS=${process.env.CREATION_ENABLE_FRESH_WALLET_ANALYSIS || 'false'}`);
        
        console.log('   Migration Bot:');
        console.log(`     MIGRATION_ENABLE_BUNDLE_ANALYSIS=${process.env.MIGRATION_ENABLE_BUNDLE_ANALYSIS || 'true'}`);
        console.log(`     MIGRATION_ENABLE_TOP_HOLDERS_ANALYSIS=${process.env.MIGRATION_ENABLE_TOP_HOLDERS_ANALYSIS || 'true'}`);
        console.log(`     MIGRATION_ENABLE_FRESH_WALLET_ANALYSIS=${process.env.MIGRATION_ENABLE_FRESH_WALLET_ANALYSIS || 'true'}`);
    }

    testAnalysisSelection() {
        console.log('\n🧪 Testing Analysis Selection:\n');

        const testCases = [
            { botType: 'creation', analysisType: 'bundle' },
            { botType: 'creation', analysisType: 'topHolders' },
            { botType: 'migration', analysisType: 'bundle' },
            { botType: 'migration', analysisType: 'topHolders' },
            { botType: 'migration', analysisType: 'freshWallets' }
        ];

        testCases.forEach(({ botType, analysisType }) => {
            const isEnabled = analysisConfig.isAnalysisEnabled(botType, analysisType);
            const status = isEnabled ? '✅ Enabled' : '❌ Disabled';
            console.log(`   ${botType.padEnd(10)} | ${analysisType.padEnd(15)} | ${status}`);
        });
    }

    generateExampleEnvFile() {
        console.log('\n📝 Example .env configuration for your current setup:\n');
        
        const exampleConfig = `# Analysis Configuration Example
BOT_MODE=both

# Creation Bot Analysis Settings
CREATION_ENABLE_BUNDLE_ANALYSIS=true
CREATION_ENABLE_TOP_HOLDERS_ANALYSIS=false
CREATION_ENABLE_FRESH_WALLET_ANALYSIS=false

# Migration Bot Analysis Settings  
MIGRATION_ENABLE_BUNDLE_ANALYSIS=true
MIGRATION_ENABLE_TOP_HOLDERS_ANALYSIS=true
MIGRATION_ENABLE_FRESH_WALLET_ANALYSIS=true

# Telegram Channels
CREATION_TELEGRAM_CHANNEL_ID=@your_creation_channel
MIGRATION_TELEGRAM_CHANNEL_ID=@your_migration_channel

# Analysis Thresholds
BUNDLE_MIN_PERCENTAGE=10
TOP_HOLDERS_MIN_COUNT=20
TOP_HOLDERS_CONTROL_THRESHOLD=50`;

        console.log(exampleConfig);
    }
}

// Main execution
async function main() {
    const validator = new ConfigValidator();
    
    // Validate configuration
    const isValid = validator.validateConfiguration();
    
    // Test analysis selection
    validator.testAnalysisSelection();
    
    // Generate example config
    validator.generateExampleEnvFile();
    
    // Exit with appropriate code
    process.exit(isValid ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Validation script failed:', error);
        process.exit(1);
    });
}

module.exports = ConfigValidator;