// src/monitors/tokenDeploymentMonitor.js - Updated with Simple Timing
const EventEmitter = require('events');
const axios = require('axios');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const { getSolanaApi } = require('../integrations/solanaApi');

class TokenDeploymentMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            minTwitterViews: parseInt(process.env.MIN_TWITTER_VIEWS) || config.minTwitterViews || 100000,
            minTwitterLikes: parseInt(process.env.MIN_TWITTER_LIKES) || config.minTwitterLikes || 1,
            minMigrationTwitterViews: parseInt(process.env.MIN_MIGRATION_TWITTER_VIEWS) || config.minMigrationTwitterViews || 50000,
            minMigrationTwitterLikes: parseInt(process.env.MIN_MIGRATION_TWITTER_LIKES) || config.minMigrationTwitterLikes || 1,
            analysisTimeout: parseInt(process.env.ANALYSIS_TIMEOUT) || config.analysisTimeout || 5 * 60 * 1000,
            maxConcurrentAnalyses: parseInt(process.env.MAX_CONCURRENT_ANALYSES) || config.maxConcurrentAnalyses || 3,
            processingDelay: parseInt(process.env.PROCESSING_DELAY) || config.processingDelay || 2000,
            retryAttempts: config.retryAttempts || 3,
            ...config
        };

        logger.info(`📋 TokenDeploymentMonitor Config:`);
        logger.info(`   • Min Twitter Views (Creation): ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes (Creation): ${this.config.minTwitterLikes.toLocaleString()}`);

        this.twitterValidator = new TwitterValidator();
        this.analysisOrchestrator = new AnalysisOrchestrator(this.config);
        this.solanaApi = getSolanaApi();
        
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        this.stats = {
            tokensProcessed: 0,
            migrationsProcessed: 0,
            tokensAnalyzed: 0,
            tokensSkipped: 0,
            errors: 0
        };

        this.processNewToken = this.processNewToken.bind(this);
        this.processTokenMigration = this.processTokenMigration.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        this.startQueueProcessor();
        this.startMemoryCleanup();
    }

    async processNewToken(tokenEvent) {
        const timer = tokenEvent.timer; // Get simple timer from WebSocket
        
        try {
            logger.info(`🔍 Processing new token: ${tokenEvent.name} (${tokenEvent.symbol}) - ${tokenEvent.mint}`);
            this.stats.tokensProcessed++;
            
            if (!this.validateTokenEvent(tokenEvent)) {
                logger.warn(`Invalid token event structure for ${tokenEvent.mint}`);
                this.stats.tokensSkipped++;
                return;
            }

            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Token ${tokenEvent.mint} already processed, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            this.processedTokens.add(tokenEvent.mint);

            const twitterLink = await this.extractTwitterLink(tokenEvent);

            if (!twitterLink) {
                logger.debug(`No Twitter link found for ${tokenEvent.symbol} (${tokenEvent.mint})`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Twitter link found for ${tokenEvent.symbol}: ${twitterLink}`);

            this.processingQueue.push({
                tokenEvent,
                twitterLink,
                timestamp: Date.now(),
                eventType: 'creation',
                timer // Pass simple timer along
            });

            logger.debug(`Added ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing new token ${tokenEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    async processTokenMigration(migrationEvent) {
        const timer = migrationEvent.timer; // Get simple timer from WebSocket
        
        try {
            logger.info(`🔄 Processing token migration: ${migrationEvent.mint}`);
            this.stats.migrationsProcessed++;
            
            // For migrations, we might not have token metadata immediately
            let tokenInfo = {
                mint: migrationEvent.mint,
                name: migrationEvent.name,
                symbol: migrationEvent.symbol,
                uri: migrationEvent.uri
            };

            // If we don't have name/symbol, try to fetch from Solana
            if (!tokenInfo.name || !tokenInfo.symbol) {
                logger.info(`Fetching token metadata for migration: ${migrationEvent.mint}`);
                try {
                    const solanaTokenData = await this.solanaApi.getAsset(migrationEvent.mint);
                    if (solanaTokenData) {
                        tokenInfo.name = solanaTokenData.name;
                        tokenInfo.symbol = solanaTokenData.symbol;
                        logger.info(`Retrieved token info: ${tokenInfo.name} (${tokenInfo.symbol})`);
                    }
                } catch (error) {
                    logger.warn(`Failed to fetch Solana metadata for ${migrationEvent.mint}:`, error.message);
                }
            }

            if (!tokenInfo.name || !tokenInfo.symbol) {
                logger.warn(`Could not retrieve token metadata for migration ${migrationEvent.mint}, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            // Create a token event structure
            const tokenEvent = {
                ...migrationEvent,
                eventType: 'migration',
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                uri: tokenInfo.uri,
                timer: timer // Keep timer reference
            };

            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Migration token ${tokenEvent.mint} already processed, skipping`);
                this.stats.tokensSkipped++;
                return;
            }

            this.processedTokens.add(tokenEvent.mint);

            const twitterLink = await this.extractTwitterLink(tokenEvent);

            if (!twitterLink) {
                logger.debug(`No Twitter link found for migration ${tokenEvent.symbol} (${tokenEvent.mint})`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`📱 Twitter link found for migration ${tokenEvent.symbol}: ${twitterLink}`);

            this.processingQueue.push({
                tokenEvent,
                twitterLink,
                timestamp: Date.now(),
                eventType: 'migration',
                timer // Pass simple timer along
            });

            logger.debug(`Added migration ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing token migration ${migrationEvent.mint}:`, error);
            this.stats.errors++;
        }
    }

    validateTokenEvent(tokenEvent) {
        const requiredFields = ['mint'];
        return requiredFields.every(field => 
            tokenEvent[field] && typeof tokenEvent[field] === 'string' && tokenEvent[field].trim().length > 0
        );
    }

    async extractTwitterLink(tokenEvent) {
        const possibleFields = ['twitter', 'social', 'socials'];
    
        for (const field of possibleFields) {
            if (tokenEvent[field]) {
                const twitterLink = this.findTwitterUrl(tokenEvent[field]);
                if (twitterLink) {
                    return twitterLink;
                }
            }
        }
    
        if (tokenEvent.uri) {
            const result = await this.extractTwitterFromUri(tokenEvent.uri);
            if (result) {
                return result;
            }
        }
    
        return null;
    }

    async extractTwitterFromUri(uri) {
        try {
            let fetchUrl = uri;
            if (uri.startsWith('ipfs://')) {
                fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (uri.startsWith('ar://')) {
                fetchUrl = uri.replace('ar://', 'https://arweave.net/');
            }
            
            const response = await axios.get(fetchUrl, { 
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)'
                }
            });
            
            if (response.data) {
                return this.findTwitterInMetadata(response.data);
            }
            return null;
            
        } catch (error) {
            return null;
        }
    }

    findTwitterInMetadata(metadata) {
        const twitterPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi
        ];
        
        const fieldsToCheck = ['twitter', 'social', 'socials', 'links', 'external_url', 'description', 'attributes'];
        
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of twitterPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) {
                        return matches[0];
                    }
                }
            }
        }
        
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of twitterPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches) {
                return matches[0];
            }
        }
        
        return null;
    }
    
    findTwitterUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        const twitterPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi,
            /\/status\/\d+/gi,
            /\/statuses\/\d+/gi
        ];

        for (const pattern of twitterPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                const statusUrls = matches.filter(url => url.includes('/status/') || url.includes('/statuses/'));
                if (statusUrls.length > 0) {
                    return statusUrls[0];
                }
                return matches[0];
            }
        }
        return null;
    }

    startQueueProcessor() {
        setInterval(async () => {
            if (!this.isProcessing && this.processingQueue.length > 0) {
                await this.processQueue();
            }
        }, this.config.processingDelay);

        logger.info(`Queue processor started with ${this.config.processingDelay}ms interval`);
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.clearProcessedTokens();
        }, 10 * 60 * 1000);
        logger.info('Memory cleanup process started');
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            const batchSize = Math.min(3, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing batch of ${batch.length} items`);

            const promises = batch.map(item => this.processQueueItem(item));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error('Error processing queue:', error);
            this.stats.errors++;
        } finally {
            this.isProcessing = false;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterLink, timestamp, eventType, timer } = item;
        const operationId = timer.operationId;

        try {
            logger.info(`🔄 [${operationId}] Processing queued ${eventType}: ${tokenEvent.symbol}`);

            if (Date.now() - timestamp > 10 * 60 * 1000) {
                logger.warn(`[${operationId}] Item too old, skipping: ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            const twitterMetrics = await this.twitterValidator.validateEngagement(twitterLink);

            if (!twitterMetrics) {
                logger.info(`[${operationId}] Failed to get Twitter metrics for ${tokenEvent.symbol}`);
                this.stats.tokensSkipped++;
                return;
            }

            logger.info(`[${operationId}] Twitter metrics for ${tokenEvent.symbol}: ${twitterMetrics.likes} likes, ${twitterMetrics.retweets} retweets, ${twitterMetrics.replies} replies, ${twitterMetrics.views} views`);

            // Use different thresholds for creations vs migrations
            const minViews = eventType === 'migration' ? this.config.minMigrationTwitterViews : this.config.minTwitterViews;
            const minLikes = eventType === 'migration' ? this.config.minMigrationTwitterLikes : this.config.minTwitterLikes;

            if (twitterMetrics.likes < minLikes && twitterMetrics.views < minViews) {
                logger.info(`[${operationId}] ${tokenEvent.symbol} (${eventType}) has ${twitterMetrics.likes} likes and ${twitterMetrics.views} views (< ${minLikes} likes or ${minViews} views), skipping analysis`);
                this.stats.tokensSkipped++;
                return;
            }

            if (twitterMetrics.likes >= minLikes) {
                logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} (${eventType}) meets criteria (${twitterMetrics.likes} likes >= ${minLikes})! Starting analysis...`);
            } else {
                logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} (${eventType}) meets criteria (${twitterMetrics.views} views >= ${minViews})! Starting analysis...`);
            }
            
            await this.triggerAnalysis(tokenEvent, twitterMetrics, operationId, timer);

        } catch (error) {
            logger.error(`[${operationId}] Error processing queue item:`, error);
            this.stats.errors++;
        }
    }

    async triggerAnalysis(tokenEvent, twitterMetrics, operationId, timer) {
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Maximum concurrent analyses reached, queuing for later`);
            setTimeout(() => {
                this.processingQueue.unshift({ 
                    tokenEvent, 
                    twitterLink: twitterMetrics.link, 
                    timestamp: Date.now(),
                    eventType: tokenEvent.eventType || 'creation',
                    timer: timer
                });
            }, 30000);
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            const analysisResult = await this.analysisOrchestrator.analyzeToken({
                tokenAddress: tokenEvent.mint,
                tokenInfo: {
                    name: tokenEvent.name,
                    symbol: tokenEvent.symbol,
                    creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                    address: tokenEvent.mint,
                    eventType: tokenEvent.eventType || 'creation'
                },
                twitterMetrics,
                operationId,
                timer: timer // Pass simple timer to orchestrator
            });

            if (analysisResult.success) {
                const eventType = tokenEvent.eventType === 'migration' ? 'migration' : 'creation';
                logger.info(`✅ [${operationId}] Analysis completed successfully for ${tokenEvent.symbol} (${eventType})`);
                this.stats.tokensAnalyzed++;
                
                this.emit('analysisCompleted', {
                    tokenEvent,
                    twitterMetrics,
                    analysisResult,
                    operationId
                });
            } else {
                logger.error(`❌ [${operationId}] Analysis failed for ${tokenEvent.symbol}:`, analysisResult.error);
                this.stats.errors++;
            }

        } catch (error) {
            logger.error(`[${operationId}] Analysis orchestration error:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
        }
    }

    getStatus() {
        return {
            processedTokensCount: this.processedTokens.size,
            queueLength: this.processingQueue.length,
            currentlyAnalyzing: this.currentlyAnalyzing.size,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses,
            isProcessing: this.isProcessing,
            stats: this.stats,
            config: this.config
        };
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 5000) {
            logger.info(`Clearing processed tokens cache (${this.processedTokens.size} entries) to prevent memory issues`);
            this.processedTokens.clear();
        }
    }

    getStatsString() {
        const { tokensProcessed, migrationsProcessed, tokensAnalyzed, tokensSkipped, errors } = this.stats;
        const totalProcessed = tokensProcessed + migrationsProcessed;
        const successRate = totalProcessed > 0 ? ((tokensAnalyzed / totalProcessed) * 100).toFixed(1) : 0;
        
        return `📊 Stats: ${tokensProcessed} tokens | ${migrationsProcessed} migrations | ${tokensAnalyzed} analyzed | ${tokensSkipped} skipped | ${errors} errors | ${successRate}% success rate`;
    }

    resetStats() {
        this.stats = {
            tokensProcessed: 0,
            migrationsProcessed: 0,
            tokensAnalyzed: 0,
            tokensSkipped: 0,
            errors: 0
        };
        logger.info('Statistics reset');
    }
}

module.exports = TokenDeploymentMonitor;