#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ProjectSetup {
    constructor() {
        this.projectName = 'twitter-token-bot';
        this.baseDir = process.cwd();
        this.projectDir = path.join(this.baseDir, this.projectName);
    }

    async setup() {
        console.log('🚀 Setting up Twitter Token Bot project...\n');
        
        try {
            this.createDirectoryStructure();
            this.createPackageJson();
            this.createEnvironmentFiles();
            this.createConfigFiles();
            this.createCoreFiles();
            this.createAnalysisFiles();
            this.createIntegrationFiles();
            this.createTwitterFiles();
            this.createUtilsFiles();
            this.createDatabaseFiles();
            this.installDependencies();
            
            console.log('\n✅ Project setup completed successfully!');
            console.log(`📁 Project created in: ${this.projectDir}`);
            console.log('\n📋 Next steps:');
            console.log('1. cd ' + this.projectName);
            console.log('2. Update .env file with your API keys');
            console.log('3. npm start');
            
        } catch (error) {
            console.error('❌ Error during setup:', error.message);
            process.exit(1);
        }
    }

    createDirectoryStructure() {
        console.log('📁 Creating directory structure...');
        
        const directories = [
            'src',
            'src/analysis',
            'src/bot',
            'src/bot/commands',
            'src/bot/formatters',
            'src/config',
            'src/database',
            'src/database/models',
            'src/database/services',
            'src/integrations',
            'src/integrations/twitter',
            'src/integrations/solana',
            'src/tools',
            'src/utils',
            'src/utils/rateLimiters',
            'src/services',
            'src/scheduler',
            'logs',
            'data',
            'tests'
        ];

        // Create project directory
        if (!fs.existsSync(this.projectDir)) {
            fs.mkdirSync(this.projectDir);
        }

        // Create all subdirectories
        directories.forEach(dir => {
            const fullPath = path.join(this.projectDir, dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        });
    }

    createPackageJson() {
        console.log('📦 Creating package.json...');
        
        const packageJson = {
            "name": "twitter-token-bot",
            "version": "1.0.0",
            "description": "Automated Twitter bot for Solana token analysis and posting",
            "main": "src/index.js",
            "scripts": {
                "start": "node src/index.js",
                "dev": "nodemon src/index.js",
                "test": "jest",
                "lint": "eslint src/",
                "setup-db": "node src/database/setup.js"
            },
            "keywords": ["twitter", "bot", "solana", "crypto", "token", "analysis"],
            "author": "Your Name",
            "license": "MIT",
            "dependencies": {
                "twitter-api-v2": "^1.17.2",
                "axios": "^1.6.0",
                "dotenv": "^16.3.1",
                "winston": "^3.11.0",
                "winston-daily-rotate-file": "^4.7.1",
                "node-cron": "^3.0.3",
                "mongodb": "^6.3.0",
                "bignumber.js": "^9.1.2",
                "@solana/web3.js": "^1.87.6",
                "puppeteer-extra": "^3.3.6",
                "puppeteer-extra-plugin-stealth": "^2.11.2",
                "user-agents": "^1.1.0",
                "p-limit": "^5.0.0",
                "lodash": "^4.17.21",
                "node-cache": "^5.1.2",
                "csv-parser": "^3.0.0",
                "papaparse": "^5.4.1",
                "sharp": "^0.33.0",
                "canvas": "^2.11.2",
                "chartjs-node-canvas": "^4.1.6"
            },
            "devDependencies": {
                "nodemon": "^3.0.2",
                "jest": "^29.7.0",
                "eslint": "^8.56.0",
                "@types/node": "^20.10.0"
            },
            "engines": {
                "node": ">=18.0.0"
            }
        };

        fs.writeFileSync(
            path.join(this.projectDir, 'package.json'),
            JSON.stringify(packageJson, null, 2)
        );
    }

    createEnvironmentFiles() {
        console.log('🔐 Creating environment files...');
        
        const envExample = `# Twitter API Configuration
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# Solana RPC Configuration
HELIUS_RPC_URL=your_helius_rpc_url_with_api_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# API Keys
DEFINED_API_KEY=your_defined_api_key
GMGN_API_KEY=your_gmgn_api_key

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/twitter-token-bot
DB_NAME=twitter_token_bot

# Bot Configuration
NODE_ENV=development
LOG_LEVEL=info
PORT=3000

# Rate Limiting
TWITTER_RATE_LIMIT_WINDOW=900000
TWITTER_RATE_LIMIT_MAX_TWEETS=300

# Analysis Configuration
MIN_MARKET_CAP=10000
MIN_LIQUIDITY=5000
MAX_TOKEN_AGE_HOURS=24
ANALYSIS_INTERVAL_MINUTES=15

# Proxy Configuration (Optional)
PROXY_USER=
PROXY_PASS=
PROXY_HOST=
PROXY_PORT=
`;

        const env = `# Copy from .env.example and fill in your actual values
NODE_ENV=development
LOG_LEVEL=debug
`;

        fs.writeFileSync(path.join(this.projectDir, '.env.example'), envExample);
        fs.writeFileSync(path.join(this.projectDir, '.env'), env);
    }

    createConfigFiles() {
        console.log('⚙️ Creating configuration files...');
        
        // Main config file
        const configJs = `const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    // Twitter Configuration
    twitter: {
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        bearerToken: process.env.TWITTER_BEARER_TOKEN,
        rateLimits: {
            windowMs: parseInt(process.env.TWITTER_RATE_LIMIT_WINDOW) || 900000,
            maxTweets: parseInt(process.env.TWITTER_RATE_LIMIT_MAX_TWEETS) || 300
        }
    },

    // Solana Configuration
    solana: {
        heliusRpcUrl: process.env.HELIUS_RPC_URL,
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
        commitment: 'confirmed'
    },

    // API Configuration
    apis: {
        definedApiKey: process.env.DEFINED_API_KEY,
        gmgnApiKey: process.env.GMGN_API_KEY
    },

    // Database Configuration
    database: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/twitter-token-bot',
        name: process.env.DB_NAME || 'twitter_token_bot'
    },

    // Analysis Configuration
    analysis: {
        minMarketCap: parseInt(process.env.MIN_MARKET_CAP) || 10000,
        minLiquidity: parseInt(process.env.MIN_LIQUIDITY) || 5000,
        maxTokenAgeHours: parseInt(process.env.MAX_TOKEN_AGE_HOURS) || 24,
        intervalMinutes: parseInt(process.env.ANALYSIS_INTERVAL_MINUTES) || 15,
        
        // Analysis thresholds
        freshWalletThreshold: 100,
        teamWalletMinSupply: 5, // percentage
        bundleDetectionThreshold: 2,
        
        // Token filtering
        minHolders: 50,
        maxSupplyConcentration: 80 // percentage
    },

    // Logging Configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        maxFiles: '14d',
        maxSize: '20m'
    },

    // Rate Limiting
    rateLimits: {
        helius: {
            requestsPerSecond: 10,
            burstSize: 20
        },
        twitter: {
            postsPerHour: 20,
            postsPerDay: 200
        }
    },

    // Proxy Configuration
    proxy: {
        user: process.env.PROXY_USER,
        pass: process.env.PROXY_PASS,
        host: process.env.PROXY_HOST,
        port: process.env.PROXY_PORT
    }
};
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/config/index.js'), configJs);

        // Twitter config
        const twitterConfigJs = `const config = require('./index');

module.exports = {
    client: {
        appKey: config.twitter.apiKey,
        appSecret: config.twitter.apiSecret,
        accessToken: config.twitter.accessToken,
        accessSecret: config.twitter.accessTokenSecret,
        bearerToken: config.twitter.bearerToken
    },
    
    posting: {
        enabled: process.env.NODE_ENV === 'production',
        maxTweetLength: 280,
        hashtagLimit: 3,
        mentionLimit: 2
    },
    
    content: {
        templates: {
            newToken: "🚀 New token detected: {symbol}\\n\\n💰 Market Cap: {marketCap}\\n🔥 Liquidity: {liquidity}\\n👥 Holders: {holders}\\n\\n{analysis}\\n\\n#Solana #Crypto #{symbol}",
            teamSupply: "⚠️ Team Supply Alert: {symbol}\\n\\n🏢 Team controls {percentage}% of supply\\n💼 {teamWallets} team wallets detected\\n\\n{details}\\n\\n#TeamSupply #Solana",
            freshWallets: "🆕 Fresh Wallet Activity: {symbol}\\n\\n👶 {freshCount} fresh wallets hold {percentage}% of supply\\n💸 Potential coordination detected\\n\\n{analysis}\\n\\n#FreshWallets #Solana"
        },
        
        hashtags: {
            general: ['#Solana', '#Crypto', '#DeFi'],
            analysis: ['#TokenAnalysis', '#OnChain', '#SmartMoney'],
            alerts: ['#Alert', '#TeamSupply', '#FreshWallets', '#Bundle']
        }
    }
};
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/config/twitter.js'), twitterConfigJs);
    }

    createCoreFiles() {
        console.log('🎯 Creating core application files...');
        
        // Main index.js
        const indexJs = `const TwitterBot = require('./bot/TwitterBot');
const logger = require('./utils/logger');
const config = require('./config');

async function main() {
    try {
        logger.info('🚀 Starting Twitter Token Bot...');
        
        // Validate configuration
        if (!config.twitter.apiKey || !config.solana.heliusRpcUrl) {
            throw new Error('Missing required configuration. Please check your .env file.');
        }
        
        // Initialize the bot
        const bot = new TwitterBot();
        await bot.initialize();
        
        // Start the bot
        await bot.start();
        
        logger.info('✅ Bot started successfully');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('🛑 Shutting down bot...');
            await bot.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            logger.info('🛑 Shutting down bot...');
            await bot.stop();
            process.exit(0);
        });
        
    } catch (error) {
        logger.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

main();
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/index.js'), indexJs);

        // Logger utility
        const loggerJs = `const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config');

const createLogger = () => {
    const logger = winston.createLogger({
        level: config.logging.level,
        format: winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        defaultMeta: { service: 'twitter-token-bot' },
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple(),
                    winston.format.printf(({ timestamp, level, message, ...meta }) => {
                        let msg = \`\${timestamp} [\${level}]: \${message}\`;
                        if (Object.keys(meta).length > 0) {
                            msg += \` \${JSON.stringify(meta)}\`;
                        }
                        return msg;
                    })
                )
            }),
            new DailyRotateFile({
                filename: 'logs/combined-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxSize: config.logging.maxSize,
                maxFiles: config.logging.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            }),
            new DailyRotateFile({
                filename: 'logs/error-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                level: 'error',
                maxSize: config.logging.maxSize,
                maxFiles: config.logging.maxFiles,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            })
        ]
    });

    return logger;
};

module.exports = createLogger();
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/utils/logger.js'), loggerJs);
    }

    createAnalysisFiles() {
        console.log('🔍 Creating analysis files...');
        
        // Bundle analysis (adapted from your existing code)
        const bundleAnalysisJs = `const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

class BundleAnalyzer {
    constructor() {
        this.FRESH_WALLET_THRESHOLD = 10;
        this.TOKEN_THRESHOLD = 2;
    }

    async analyzeBundleActivity(tokenAddress, trades) {
        try {
            logger.debug(\`Analyzing bundle activity for \${tokenAddress}\`);
            
            // Group trades by slot/timestamp for bundle detection
            const bundles = this.groupTradesBySlot(trades);
            
            // Filter for significant bundles
            const significantBundles = bundles.filter(bundle => 
                bundle.uniqueWallets.size >= this.TOKEN_THRESHOLD
            );
            
            // Calculate bundle statistics
            const stats = this.calculateBundleStats(significantBundles);
            
            return {
                detected: significantBundles.length > 0,
                bundleCount: significantBundles.length,
                totalTokensBundled: stats.totalTokens,
                totalSolSpent: stats.totalSol,
                percentageOfSupply: stats.supplyPercentage,
                bundles: significantBundles,
                risk: this.assessBundleRisk(stats)
            };
            
        } catch (error) {
            logger.error('Error in bundle analysis:', error);
            throw error;
        }
    }

    groupTradesBySlot(trades) {
        const bundles = {};
        
        trades.forEach(trade => {
            if (trade.is_buy) {
                const slot = trade.slot || Math.floor(trade.timestamp / 1000);
                
                if (!bundles[slot]) {
                    bundles[slot] = {
                        slot,
                        uniqueWallets: new Set(),
                        tokensBought: 0,
                        solSpent: 0,
                        transactions: []
                    };
                }
                
                bundles[slot].uniqueWallets.add(trade.user);
                bundles[slot].tokensBought += trade.token_amount || 0;
                bundles[slot].solSpent += trade.sol_amount || 0;
                bundles[slot].transactions.push(trade);
            }
        });
        
        return Object.values(bundles);
    }

    calculateBundleStats(bundles) {
        return bundles.reduce((stats, bundle) => {
            stats.totalTokens += bundle.tokensBought;
            stats.totalSol += bundle.solSpent;
            return stats;
        }, { totalTokens: 0, totalSol: 0, supplyPercentage: 0 });
    }

    assessBundleRisk(stats) {
        if (stats.supplyPercentage > 20) return 'HIGH';
        if (stats.supplyPercentage > 10) return 'MEDIUM';
        if (stats.supplyPercentage > 5) return 'LOW';
        return 'MINIMAL';
    }
}

module.exports = BundleAnalyzer;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/analysis/bundleAnalyzer.js'), bundleAnalysisJs);

        // Fresh wallets analysis
        const freshWalletsJs = `const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

class FreshWalletsAnalyzer {
    constructor() {
        this.FRESH_WALLET_THRESHOLD = 100;
        this.SUPPLY_THRESHOLD = new BigNumber('0.0005'); // 0.05%
    }

    async analyzeFreshWallets(tokenAddress, holders, tokenInfo) {
        try {
            logger.debug(\`Analyzing fresh wallets for \${tokenAddress}\`);
            
            const totalSupply = new BigNumber(tokenInfo.total_supply);
            
            // Filter significant holders
            const significantHolders = holders.filter(holder => {
                const balance = new BigNumber(holder.balance);
                const percentage = balance.dividedBy(totalSupply);
                return percentage.isGreaterThanOrEqualTo(this.SUPPLY_THRESHOLD);
            });
            
            // Analyze each wallet
            const analyzedWallets = await Promise.all(
                significantHolders.map(holder => this.analyzeWallet(holder))
            );
            
            // Filter fresh wallets
            const freshWallets = analyzedWallets.filter(w => w.category === 'Fresh');
            
            // Calculate total supply held by fresh wallets
            const freshSupplyHeld = freshWallets.reduce((total, wallet) => {
                return total.plus(new BigNumber(wallet.balance));
            }, new BigNumber(0));
            
            const totalSupplyControlled = freshSupplyHeld
                .dividedBy(totalSupply)
                .multipliedBy(100)
                .toNumber();
            
            return {
                detected: freshWallets.length > 0,
                freshWalletsCount: freshWallets.length,
                totalSupplyControlled,
                freshWallets: freshWallets.map(w => ({
                    address: w.address,
                    balance: w.balance.toString(),
                    percentage: new BigNumber(w.balance)
                        .dividedBy(totalSupply)
                        .multipliedBy(100)
                        .toNumber(),
                    transactionCount: w.transactionCount
                })),
                risk: this.assessFreshWalletRisk(totalSupplyControlled, freshWallets.length)
            };
            
        } catch (error) {
            logger.error('Error in fresh wallets analysis:', error);
            throw error;
        }
    }

    async analyzeWallet(holder) {
        try {
            // Simulate transaction count check
            const transactionCount = await this.getTransactionCount(holder.address);
            
            return {
                ...holder,
                category: transactionCount < this.FRESH_WALLET_THRESHOLD ? 'Fresh' : 'Normal',
                transactionCount
            };
        } catch (error) {
            logger.error(\`Error analyzing wallet \${holder.address}:\`, error);
            return {
                ...holder,
                category: 'Error',
                error: error.message
            };
        }
    }

    async getTransactionCount(address) {
        // Placeholder - integrate with your Solana API
        return Math.floor(Math.random() * 200);
    }

    assessFreshWalletRisk(supplyControlled, walletCount) {
        if (supplyControlled > 30 || walletCount > 20) return 'HIGH';
        if (supplyControlled > 15 || walletCount > 10) return 'MEDIUM';
        if (supplyControlled > 5 || walletCount > 5) return 'LOW';
        return 'MINIMAL';
    }
}

module.exports = FreshWalletsAnalyzer;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/analysis/freshWalletsAnalyzer.js'), freshWalletsJs);

        // Top holders analysis
        const topHoldersJs = `const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

class TopHoldersAnalyzer {
    constructor() {
        this.HIGH_WALLET_VALUE_THRESHOLD = 100000; // $100k
        this.LOW_TRANSACTION_THRESHOLD = 50;
    }

    async analyzeTopHolders(tokenAddress, holders, tokenInfo) {
        try {
            logger.debug(\`Analyzing top holders for \${tokenAddress}\`);
            
            const analyzedHolders = await Promise.all(
                holders.slice(0, 20).map((holder, index) => 
                    this.analyzeHolder(holder, index + 1, tokenInfo)
                )
            );
            
            // Filter interesting wallets
            const interestingWallets = analyzedHolders.filter(h => h.isInteresting);
            
            // Calculate concentration metrics
            const top10Supply = analyzedHolders.slice(0, 10)
                .reduce((sum, holder) => sum + parseFloat(holder.supplyPercentage || 0), 0);
            
            const top5Supply = analyzedHolders.slice(0, 5)
                .reduce((sum, holder) => sum + parseFloat(holder.supplyPercentage || 0), 0);
            
            return {
                topHolders: analyzedHolders,
                interestingWallets,
                concentration: {
                    top5: top5Supply,
                    top10: top10Supply
                },
                risk: this.assessConcentrationRisk(top5Supply, top10Supply),
                totalHolders: holders.length
            };
            
        } catch (error) {
            logger.error('Error in top holders analysis:', error);
            throw error;
        }
    }

    async analyzeHolder(holder, rank, tokenInfo) {
        try {
            const totalSupply = new BigNumber(tokenInfo.total_supply);
            const balance = new BigNumber(holder.balance || holder.tokenBalance);
            const supplyPercentage = balance.dividedBy(totalSupply).multipliedBy(100).toFixed(2);
            
            // Determine wallet category
            const category = await this.categorizeWallet(holder.address);
            
            return {
                rank,
                address: holder.address,
                balance: balance.toFixed(0),
                supplyPercentage,
                category: category.type,
                isInteresting: category.isInteresting,
                portfolioValue: category.portfolioValue || 0,
                transactionCount: category.transactionCount || 0
            };
            
        } catch (error) {
            logger.error(\`Error analyzing holder \${holder.address}:\`, error);
            return {
                rank,
                address: holder.address,
                error: 'Failed to analyze'
            };
        }
    }

    async categorizeWallet(address) {
        try {
            // Simulate wallet analysis
            const portfolioValue = Math.random() * 1000000;
            const transactionCount = Math.floor(Math.random() * 1000);
            
            let type = 'Normal';
            let isInteresting = false;
            
            if (portfolioValue > this.HIGH_WALLET_VALUE_THRESHOLD) {
                type = 'High Value';
                isInteresting = true;
            } else if (transactionCount < this.LOW_TRANSACTION_THRESHOLD) {
                type = 'Fresh';
                isInteresting = true;
            }
            
            return {
                type,
                isInteresting,
                portfolioValue,
                transactionCount
            };
            
        } catch (error) {
            return { type: 'Error', isInteresting: false };
        }
    }

    assessConcentrationRisk(top5, top10) {
        if (top5 > 70 || top10 > 85) return 'HIGH';
        if (top5 > 50 || top10 > 70) return 'MEDIUM';
        if (top5 > 30 || top10 > 50) return 'LOW';
        return 'MINIMAL';
    }
}

module.exports = TopHoldersAnalyzer;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/analysis/topHoldersAnalyzer.js'), topHoldersJs);

        // Main token analyzer
        const tokenAnalyzerJs = `const BundleAnalyzer = require('./bundleAnalyzer');
const FreshWalletsAnalyzer = require('./freshWalletsAnalyzer');
const TopHoldersAnalyzer = require('./topHoldersAnalyzer');
const logger = require('../utils/logger');

class TokenAnalyzer {
    constructor() {
        this.bundleAnalyzer = new BundleAnalyzer();
        this.freshWalletsAnalyzer = new FreshWalletsAnalyzer();
        this.topHoldersAnalyzer = new TopHoldersAnalyzer();
    }

    async analyzeToken(tokenAddress, tokenData) {
        try {
            logger.info(\`Starting comprehensive analysis for \${tokenAddress}\`);
            
            const {
                tokenInfo,
                holders,
                trades,
                marketData
            } = tokenData;
            
            // Run all analyses in parallel
            const [bundleAnalysis, freshWalletsAnalysis, topHoldersAnalysis] = await Promise.all([
                this.bundleAnalyzer.analyzeBundleActivity(tokenAddress, trades),
                this.freshWalletsAnalyzer.analyzeFreshWallets(tokenAddress, holders, tokenInfo),
                this.topHoldersAnalyzer.analyzeTopHolders(tokenAddress, holders, tokenInfo)
            ]);
            
            // Calculate overall risk score
            const riskScore = this.calculateRiskScore({
                bundle: bundleAnalysis,
                freshWallets: freshWalletsAnalysis,
                topHolders: topHoldersAnalysis
            });
            
            return {
                tokenAddress,
                tokenInfo,
                marketData,
                analysis: {
                    bundle: bundleAnalysis,
                    freshWallets: freshWalletsAnalysis,
                    topHolders: topHoldersAnalysis
                },
                riskScore,
                timestamp: new Date().toISOString(),
                shouldPost: this.shouldPostToTwitter(riskScore, bundleAnalysis, freshWalletsAnalysis)
            };
            
        } catch (error) {
            logger.error(\`Error analyzing token \${tokenAddress}:\`, error);
            throw error;
        }
    }

    calculateRiskScore(analyses) {
        const riskWeights = {
            HIGH: 4,
            MEDIUM: 2,
            LOW: 1,
            MINIMAL: 0
        };
        
        const bundleRisk = riskWeights[analyses.bundle.risk] || 0;
        const freshWalletRisk = riskWeights[analyses.freshWallets.risk] || 0;
        const concentrationRisk = riskWeights[analyses.topHolders.risk] || 0;
        
        const totalRisk = bundleRisk + freshWalletRisk + concentrationRisk;
        const maxRisk = 12; // 3 analyses * 4 (HIGH risk)
        
        return Math.round((totalRisk / maxRisk) * 100);
    }

    shouldPostToTwitter(riskScore, bundleAnalysis, freshWalletsAnalysis) {
        // Post if high risk detected or interesting patterns found
        return riskScore > 50 || 
               bundleAnalysis.detected || 
               freshWalletsAnalysis.totalSupplyControlled > 10;
    }
}

module.exports = TokenAnalyzer;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/analysis/tokenAnalyzer.js'), tokenAnalyzerJs);
    }

    createIntegrationFiles() {
        console.log('🔗 Creating integration files...');
        
        // Solana API integration
        const solanaApiJs = `const { Connection, PublicKey } = require('@solana/web3.js');
const config = require('../config');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class SolanaAPI {
    constructor() {
        this.connection = new Connection(config.solana.heliusRpcUrl, config.solana.commitment);
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    async getTokenInfo(tokenAddress) {
        try {
            const cacheKey = \`token_info_\${tokenAddress}\`;
            const cached = this.getCached(cacheKey);
            if (cached) return cached;
            
            const asset = await this.getAsset(tokenAddress);
            if (!asset) {
                throw new Error('Token not found');
            }
            
            const tokenInfo = {
                address: tokenAddress,
                symbol: asset.content?.metadata?.symbol || 'Unknown',
                name: asset.content?.metadata?.name || 'Unknown Token',
                decimals: asset.token_info?.decimals || 0,
                supply: {
                    total: asset.token_info?.supply || 0
                },
                price: asset.token_info?.price_info?.price_per_token || 0
            };
            
            this.setCached(cacheKey, tokenInfo);
            return tokenInfo;
            
        } catch (error) {
            logger.error(\`Error fetching token info for \${tokenAddress}:\`, error);
            throw error;
        }
    }

    async getTokenHolders(tokenAddress, limit = 100) {
        try {
            const cacheKey = \`holders_\${tokenAddress}_\${limit}\`;
            const cached = this.getCached(cacheKey);
            if (cached) return cached;
            
            // Get token accounts
            const accounts = await this.connection.getProgramAccounts(
                new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                {
                    filters: [
                        { dataSize: 165 },
                        { memcmp: { offset: 0, bytes: tokenAddress }}
                    ]
                }
            );
            
            const holders = [];
            for (const account of accounts.slice(0, limit)) {
                try {
                    const accountInfo = await this.connection.getParsedAccountInfo(account.pubkey);
                    if (accountInfo.value?.data?.parsed?.info) {
                        const info = accountInfo.value.data.parsed.info;
                        if (info.tokenAmount.uiAmount > 0) {
                            holders.push({
                                address: info.owner,
                                balance: info.tokenAmount.amount,
                                uiAmount: info.tokenAmount.uiAmount
                            });
                        }
                    }
                } catch (err) {
                    // Skip invalid accounts
                    continue;
                }
            }
            
            // Sort by balance descending
            holders.sort((a, b) => new BigNumber(b.balance).minus(a.balance).toNumber());
            
            this.setCached(cacheKey, holders);
            return holders;
            
        } catch (error) {
            logger.error(\`Error fetching token holders for \${tokenAddress}:\`, error);
            throw error;
        }
    }

    async getAsset(tokenAddress) {
        try {
            const response = await fetch(config.solana.heliusRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'asset-request',
                    method: 'getAsset',
                    params: { id: tokenAddress }
                })
            });
            
            const data = await response.json();
            return data.result;
            
        } catch (error) {
            logger.error(\`Error fetching asset \${tokenAddress}:\`, error);
            throw error;
        }
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCached(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
}

module.exports = new SolanaAPI();
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/integrations/solana/solanaAPI.js'), solanaApiJs);

        // Twitter API integration
        const twitterApiJs = `const { TwitterApi } = require('twitter-api-v2');
const config = require('../../config');
const logger = require('../../utils/logger');

class TwitterAPI {
    constructor() {
        this.client = new TwitterApi({
            appKey: config.twitter.apiKey,
            appSecret: config.twitter.apiSecret,
            accessToken: config.twitter.accessToken,
            accessSecret: config.twitter.accessTokenSecret
        });
        
        this.rwClient = this.client.readWrite;
        this.rateLimitTracker = new Map();
    }

    async postTweet(content, options = {}) {
        try {
            if (!config.twitter.posting?.enabled) {
                logger.info('Tweet not posted (posting disabled):', content);
                return { posted: false, reason: 'Posting disabled' };
            }
            
            // Check rate limits
            if (!this.canPost()) {
                logger.warn('Rate limit reached, skipping tweet');
                return { posted: false, reason: 'Rate limit reached' };
            }
            
            // Validate content length
            if (content.length > config.twitter.posting.maxTweetLength) {
                content = this.truncateContent(content);
            }
            
            const tweet = await this.rwClient.v2.tweet({
                text: content,
                ...options
            });
            
            this.updateRateLimit();
            
            logger.info(\`Tweet posted successfully: \${tweet.data.id}\`);
            return {
                posted: true,
                tweetId: tweet.data.id,
                content
            };
            
        } catch (error) {
            logger.error('Error posting tweet:', error);
            
            // Handle specific Twitter API errors
            if (error.code === 429) {
                logger.warn('Twitter rate limit exceeded');
                return { posted: false, reason: 'Rate limit exceeded' };
            }
            
            throw error;
        }
    }

    async postTweetWithMedia(content, mediaBuffer, mediaType = 'image/png') {
        try {
            // Upload media
            const mediaId = await this.client.v1.uploadMedia(mediaBuffer, {
                mimeType: mediaType
            });
            
            // Post tweet with media
            return await this.postTweet(content, {
                media: { media_ids: [mediaId] }
            });
            
        } catch (error) {
            logger.error('Error posting tweet with media:', error);
            throw error;
        }
    }

    canPost() {
        const now = Date.now();
        const hourAgo = now - (60 * 60 * 1000);
        const dayAgo = now - (24 * 60 * 60 * 1000);
        
        // Clean old entries
        for (const [timestamp] of this.rateLimitTracker) {
            if (timestamp < dayAgo) {
                this.rateLimitTracker.delete(timestamp);
            }
        }
        
        // Count posts in last hour and day
        const postsLastHour = Array.from(this.rateLimitTracker.keys())
            .filter(timestamp => timestamp > hourAgo).length;
        const postsLastDay = this.rateLimitTracker.size;
        
        return postsLastHour < config.rateLimits.twitter.postsPerHour &&
               postsLastDay < config.rateLimits.twitter.postsPerDay;
    }

    updateRateLimit() {
        this.rateLimitTracker.set(Date.now(), true);
    }

    truncateContent(content) {
        const maxLength = config.twitter.posting.maxTweetLength - 3; // Reserve space for '...'
        if (content.length <= maxLength) return content;
        
        return content.substring(0, maxLength) + '...';
    }

    formatHashtags(tags) {
        return tags.slice(0, config.twitter.posting.hashtagLimit)
            .map(tag => tag.startsWith('#') ? tag : \`#\${tag}\`)
            .join(' ');
    }
}

module.exports = new TwitterAPI();
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/integrations/twitter/twitterAPI.js'), twitterApiJs);
    }

    createTwitterFiles() {
        console.log('🐦 Creating Twitter-specific files...');
        
        // Content generator
        const contentGeneratorJs = `const config = require('../config/twitter');
const logger = require('../utils/logger');

class ContentGenerator {
    constructor() {
        this.templates = config.content.templates;
        this.hashtags = config.content.hashtags;
    }

    generateNewTokenAlert(analysis) {
        try {
            const { tokenInfo, marketData, analysis: tokenAnalysis } = analysis;
            
            let content = this.templates.newToken
                .replace('{symbol}', tokenInfo.symbol)
                .replace('{marketCap}', this.formatNumber(marketData.marketCap))
                .replace('{liquidity}', this.formatNumber(marketData.liquidity))
                .replace('{holders}', marketData.holders || 'N/A');
            
            // Add analysis summary
            const analysisText = this.generateAnalysisSummary(tokenAnalysis);
            content = content.replace('{analysis}', analysisText);
            
            // Add relevant hashtags
            const tags = this.selectHashtags(tokenAnalysis);
            content += '\\n\\n' + tags;
            
            return this.validateContent(content);
            
        } catch (error) {
            logger.error('Error generating new token alert:', error);
            throw error;
        }
    }

    generateTeamSupplyAlert(analysis) {
        try {
            const { tokenInfo, analysis: tokenAnalysis } = analysis;
            const teamSupply = tokenAnalysis.freshWallets;
            
            let content = this.templates.teamSupply
                .replace('{symbol}', tokenInfo.symbol)
                .replace('{percentage}', teamSupply.totalSupplyControlled.toFixed(1))
                .replace('{teamWallets}', teamSupply.freshWalletsCount);
            
            // Add details
            const details = this.generateTeamSupplyDetails(teamSupply);
            content = content.replace('{details}', details);
            
            // Add hashtags
            const tags = [...this.hashtags.alerts, \`#\${tokenInfo.symbol}\`].join(' ');
            content += '\\n\\n' + tags;
            
            return this.validateContent(content);
            
        } catch (error) {
            logger.error('Error generating team supply alert:', error);
            throw error;
        }
    }

    generateBundleAlert(analysis) {
        try {
            const { tokenInfo, analysis: tokenAnalysis } = analysis;
            const bundle = tokenAnalysis.bundle;
            
            const content = \`🚨 Bundle Activity Detected: \${tokenInfo.symbol}

📦 \${bundle.bundleCount} bundles detected
💰 \${this.formatNumber(bundle.totalSolSpent)} SOL spent
📊 \${bundle.percentageOfSupply.toFixed(1)}% of supply acquired

⚠️ Risk Level: \${bundle.risk}

#Bundle #Solana #\${tokenInfo.symbol}\`;
            
            return this.validateContent(content);
            
        } catch (error) {
            logger.error('Error generating bundle alert:', error);
            throw error;
        }
    }

    generateAnalysisSummary(analysis) {
        const alerts = [];
        
        if (analysis.bundle.detected) {
            alerts.push(\`🏗️ Bundle activity detected (\${analysis.bundle.bundleCount} bundles)\`);
        }
        
        if (analysis.freshWallets.detected) {
            alerts.push(\`👶 Fresh wallets control \${analysis.freshWallets.totalSupplyControlled.toFixed(1)}% of supply\`);
        }
        
        if (analysis.topHolders.concentration.top5 > 50) {
            alerts.push(\`⚠️ High concentration: Top 5 hold \${analysis.topHolders.concentration.top5.toFixed(1)}%\`);
        }
        
        return alerts.length > 0 ? alerts.join('\\n') : '✅ No major red flags detected';
    }

    generateTeamSupplyDetails(teamSupply) {
        const details = [];
        
        if (teamSupply.freshWalletsCount > 10) {
            details.push(\`👥 \${teamSupply.freshWalletsCount} suspicious wallets\`);
        }
        
        if (teamSupply.totalSupplyControlled > 20) {
            details.push('🚨 High team control risk');
        }
        
        return details.length > 0 ? details.join(' | ') : 'Multiple coordinated wallets detected';
    }

    selectHashtags(analysis) {
        const tags = [...this.hashtags.general];
        
        if (analysis.bundle.detected) {
            tags.push('#Bundle');
        }
        
        if (analysis.freshWallets.detected) {
            tags.push('#FreshWallets');
        }
        
        if (analysis.topHolders.risk === 'HIGH') {
            tags.push('#HighRisk');
        }
        
        return tags.slice(0, 5).join(' ');
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return \`$\${(num / 1000000).toFixed(1)}M\`;
        } else if (num >= 1000) {
            return \`$\${(num / 1000).toFixed(1)}K\`;
        } else {
            return \`$\${num.toFixed(0)}\`;
        }
    }

    validateContent(content) {
        if (content.length > config.posting.maxTweetLength) {
            logger.warn('Content exceeds Twitter limit, truncating');
            return content.substring(0, config.posting.maxTweetLength - 3) + '...';
        }
        return content;
    }
}

module.exports = ContentGenerator;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/bot/contentGenerator.js'), contentGeneratorJs);

        // Main Twitter bot class
        const twitterBotJs = `const TwitterAPI = require('../integrations/twitter/twitterAPI');
const ContentGenerator = require('./contentGenerator');
const TokenAnalyzer = require('../analysis/tokenAnalyzer');
const SolanaAPI = require('../integrations/solana/solanaAPI');
const TokenScanner = require('../services/tokenScanner');
const PostScheduler = require('../scheduler/postScheduler');
const Database = require('../database');
const logger = require('../utils/logger');
const config = require('../config');

class TwitterBot {
    constructor() {
        this.twitterAPI = TwitterAPI;
        this.contentGenerator = new ContentGenerator();
        this.tokenAnalyzer = new TokenAnalyzer();
        this.tokenScanner = new TokenScanner();
        this.postScheduler = new PostScheduler();
        this.database = Database;
        this.isRunning = false;
    }

    async initialize() {
        try {
            logger.info('🔧 Initializing Twitter Bot...');
            
            // Initialize database
            await this.database.connect();
            
            // Initialize token scanner
            await this.tokenScanner.initialize();
            
            // Initialize post scheduler
            this.postScheduler.initialize(this.handleScheduledPost.bind(this));
            
            logger.info('✅ Bot initialized successfully');
            
        } catch (error) {
            logger.error('❌ Failed to initialize bot:', error);
            throw error;
        }
    }

    async start() {
        try {
            if (this.isRunning) {
                logger.warn('Bot is already running');
                return;
            }
            
            this.isRunning = true;
            logger.info('🚀 Starting Twitter Bot...');
            
            // Start token scanning
            await this.tokenScanner.start();
            
            // Start post scheduler
            this.postScheduler.start();
            
            // Start main analysis loop
            this.startAnalysisLoop();
            
            logger.info('✅ Bot started successfully');
            
        } catch (error) {
            logger.error('❌ Failed to start bot:', error);
            this.isRunning = false;
            throw error;
        }
    }

    async stop() {
        try {
            logger.info('🛑 Stopping Twitter Bot...');
            
            this.isRunning = false;
            
            // Stop scanner and scheduler
            await this.tokenScanner.stop();
            this.postScheduler.stop();
            
            // Close database connection
            await this.database.disconnect();
            
            logger.info('✅ Bot stopped successfully');
            
        } catch (error) {
            logger.error('❌ Error stopping bot:', error);
            throw error;
        }
    }

    async startAnalysisLoop() {
        while (this.isRunning) {
            try {
                await this.runAnalysisCycle();
                
                // Wait for next cycle
                await this.sleep(config.analysis.intervalMinutes * 60 * 1000);
                
            } catch (error) {
                logger.error('Error in analysis loop:', error);
                await this.sleep(60000); // Wait 1 minute before retrying
            }
        }
    }

    async runAnalysisCycle() {
        logger.info('🔍 Starting analysis cycle...');
        
        try {
            // Get new tokens to analyze
            const newTokens = await this.tokenScanner.getNewTokens();
            
            logger.info(\`Found \${newTokens.length} new tokens to analyze\`);
            
            for (const token of newTokens) {
                try {
                    await this.analyzeAndProcessToken(token);
                } catch (error) {
                    logger.error(\`Error processing token \${token.address}:\`, error);
                }
            }
            
            logger.info('✅ Analysis cycle completed');
            
        } catch (error) {
            logger.error('Error in analysis cycle:', error);
            throw error;
        }
    }

    async analyzeAndProcessToken(tokenData) {
        try {
            logger.debug(\`Analyzing token: \${tokenData.address}\`);
            
            // Run comprehensive analysis
            const analysis = await this.tokenAnalyzer.analyzeToken(
                tokenData.address, 
                tokenData
            );
            
            // Save analysis to database
            await this.database.saveAnalysis(analysis);
            
            // Check if we should post about this token
            if (analysis.shouldPost) {
                await this.handleAnalysisPost(analysis);
            }
            
        } catch (error) {
            logger.error(\`Error analyzing token \${tokenData.address}:\`, error);
            throw error;
        }
    }

    async handleAnalysisPost(analysis) {
        try {
            let content;
            
            // Determine post type based on analysis
            if (analysis.analysis.bundle.detected && analysis.analysis.bundle.risk === 'HIGH') {
                content = this.contentGenerator.generateBundleAlert(analysis);
            } else if (analysis.analysis.freshWallets.totalSupplyControlled > 15) {
                content = this.contentGenerator.generateTeamSupplyAlert(analysis);
            } else {
                content = this.contentGenerator.generateNewTokenAlert(analysis);
            }
            
            // Schedule the post
            await this.postScheduler.schedulePost({
                content,
                analysis,
                priority: analysis.riskScore > 70 ? 'high' : 'normal'
            });
            
            logger.info(\`Scheduled post for token: \${analysis.tokenInfo.symbol}\`);
            
        } catch (error) {
            logger.error('Error handling analysis post:', error);
            throw error;
        }
    }

    async handleScheduledPost(postData) {
        try {
            const result = await this.twitterAPI.postTweet(postData.content);
            
            if (result.posted) {
                // Update database with post info
                await this.database.updateAnalysisPost(
                    postData.analysis.tokenAddress,
                    {
                        tweetId: result.tweetId,
                        postedAt: new Date(),
                        content: result.content
                    }
                );
                
                logger.info(\`Successfully posted tweet for \${postData.analysis.tokenInfo.symbol}\`);
            } else {
                logger.warn(\`Failed to post tweet: \${result.reason}\`);
            }
            
        } catch (error) {
            logger.error('Error in scheduled post handler:', error);
            throw error;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = TwitterBot;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/bot/TwitterBot.js'), twitterBotJs);
    }

    createUtilsFiles() {
        console.log('🛠️ Creating utility files...');
        
        // Rate limiter
        const rateLimiterJs = `class RateLimiter {
    constructor(requestsPerSecond = 10, burstSize = 20) {
        this.requestsPerSecond = requestsPerSecond;
        this.burstSize = burstSize;
        this.tokens = burstSize;
        this.lastRefill = Date.now();
        this.queue = [];
    }

    async execute(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.processQueue();
        });
    }

    processQueue() {
        if (this.queue.length === 0) return;

        this.refillTokens();

        if (this.tokens > 0) {
            this.tokens--;
            const { fn, resolve, reject } = this.queue.shift();
            
            fn().then(resolve).catch(reject);
            
            // Process next item
            setTimeout(() => this.processQueue(), 0);
        } else {
            // Wait and try again
            setTimeout(() => this.processQueue(), 1000 / this.requestsPerSecond);
        }
    }

    refillTokens() {
        const now = Date.now();
        const timePassed = (now - this.lastRefill) / 1000;
        const tokensToAdd = Math.floor(timePassed * this.requestsPerSecond);
        
        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.burstSize, this.tokens + tokensToAdd);
            this.lastRefill = now;
        }
    }
}

module.exports = RateLimiter;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/utils/rateLimiters/rateLimiter.js'), rateLimiterJs);

        // Cache utility
        const cacheJs = `const NodeCache = require('node-cache');

class Cache {
    constructor(ttlSeconds = 300) {
        this.cache = new NodeCache({
            stdTTL: ttlSeconds,
            checkperiod: 60,
            useClones: false
        });
    }

    get(key) {
        return this.cache.get(key);
    }

    set(key, value, ttl) {
        return this.cache.set(key, value, ttl || undefined);
    }

    del(key) {
        return this.cache.del(key);
    }

    flush() {
        return this.cache.flushAll();
    }

    keys() {
        return this.cache.keys();
    }

    has(key) {
        return this.cache.has(key);
    }

    stats() {
        return this.cache.getStats();
    }
}

module.exports = Cache;
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/utils/cache.js'), cacheJs);
    }

    createDatabaseFiles() {
        console.log('🗄️ Creating database files...');
        
        // Database connection
        const databaseJs = `const { MongoClient } = require('mongodb');
const config = require('../config');
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect() {
        try {
            logger.info('Connecting to database...');
            
            this.client = new MongoClient(config.database.uri);
            await this.client.connect();
            
            this.db = this.client.db(config.database.name);
            
            // Create indexes
            await this.createIndexes();
            
            logger.info('✅ Connected to database successfully');
            
        } catch (error) {
            logger.error('❌ Failed to connect to database:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            logger.info('Database connection closed');
        }
    }

    async createIndexes() {
        try {
            // Analyses collection indexes
            await this.db.collection('analyses').createIndex({ tokenAddress: 1 });
            await this.db.collection('analyses').createIndex({ timestamp: -1 });
            await this.db.collection('analyses').createIndex({ 'tokenInfo.symbol': 1 });
            
            // Posts collection indexes
            await this.db.collection('posts').createIndex({ tokenAddress: 1 });
            await this.db.collection('posts').createIndex({ postedAt: -1 });
            await this.db.collection('posts').createIndex({ tweetId: 1 });
            
            // Tokens collection indexes
            await this.db.collection('tokens').createIndex({ address: 1 }, { unique: true });
            await this.db.collection('tokens').createIndex({ discoveredAt: -1 });
            await this.db.collection('tokens').createIndex({ 'marketData.marketCap': -1 });
            
            logger.debug('Database indexes created');
            
        } catch (error) {
            logger.error('Error creating database indexes:', error);
            throw error;
        }
    }

    async saveAnalysis(analysis) {
        try {
            const result = await this.db.collection('analyses').insertOne({
                ...analysis,
                createdAt: new Date()
            });
            
            return result.insertedId;
            
        } catch (error) {
            logger.error('Error saving analysis:', error);
            throw error;
        }
    }

    async getAnalysis(tokenAddress) {
        try {
            return await this.db.collection('analyses')
                .findOne({ tokenAddress }, { sort: { timestamp: -1 } });
                
        } catch (error) {
            logger.error('Error getting analysis:', error);
            throw error;
        }
    }

    async updateAnalysisPost(tokenAddress, postData) {
        try {
            const result = await this.db.collection('analyses').updateOne(
                { tokenAddress },
                { $set: { post: postData } }
            );
            
            // Also save to posts collection
            await this.db.collection('posts').insertOne({
                tokenAddress,
                ...postData,
                createdAt: new Date()
            });
            
            return result;
            
        } catch (error) {
            logger.error('Error updating analysis post:', error);
            throw error;
        }
    }

    async saveToken(tokenData) {
        try {
            const result = await this.db.collection('tokens').updateOne(
                { address: tokenData.address },
                { 
                    $set: { 
                        ...tokenData, 
                        updatedAt: new Date() 
                    },
                    $setOnInsert: { 
                        discoveredAt: new Date() 
                    }
                },
                { upsert: true }
            );
            
            return result;
            
        } catch (error) {
            logger.error('Error saving token:', error);
            throw error;
        }
    }

    async getRecentTokens(hours = 24, limit = 100) {
        try {
            const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
            
            return await this.db.collection('tokens')
                .find({ discoveredAt: { $gte: cutoff } })
                .sort({ discoveredAt: -1 })
                .limit(limit)
                .toArray();
                
        } catch (error) {
            logger.error('Error getting recent tokens:', error);
            throw error;
        }
    }

    async getStats() {
        try {
            const [tokensCount, analysesCount, postsCount] = await Promise.all([
                this.db.collection('tokens').countDocuments(),
                this.db.collection('analyses').countDocuments(),
                this.db.collection('posts').countDocuments()
            ]);
            
            return {
                tokens: tokensCount,
                analyses: analysesCount,
                posts: postsCount
            };
            
        } catch (error) {
            logger.error('Error getting stats:', error);
            throw error;
        }
    }
}

module.exports = new Database();
`;

        fs.writeFileSync(path.join(this.projectDir, 'src/database/index.js'), databaseJs);
    }

    installDependencies() {
        console.log('📦 Installing dependencies...');
        
        try {
            process.chdir(this.projectDir);
            execSync('npm install', { stdio: 'inherit' });
            console.log('✅ Dependencies installed successfully');
        } catch (error) {
            console.error('❌ Failed to install dependencies:', error.message);
            throw error;
        }
    }
}

// Run the setup
const setup = new ProjectSetup();
setup.setup().catch(console.error);