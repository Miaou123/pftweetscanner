// src/monitors/migrationMonitor.js - Fixed with proper Twitter metrics display
const EventEmitter = require('events');
const axios = require('axios');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const { getSolanaApi } = require('../integrations/solanaApi');

class MigrationMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            minTwitterViews: config.minTwitterViews || 50000,
            minTwitterLikes: config.minTwitterLikes || 1,
            analysisTimeout: config.analysisTimeout || 10 * 60 * 1000, // 10 minutes
            maxConcurrentAnalyses: config.maxConcurrentAnalyses || 5,
            processingDelay: config.processingDelay || 1000,
            retryAttempts: config.retryAttempts || 3,
            telegram: config.telegram || {},
            enableViewCountExtraction: config.enableViewCountExtraction !== false, // Enable by default
            viewCountTimeout: config.viewCountTimeout || 15000,
            ...config
        };

        logger.info(`📋 MigrationMonitor Config:`);
        logger.info(`   • Min Twitter Views: ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes: ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • Analysis Timeout: ${this.config.analysisTimeout / 1000}s`);
        logger.info(`   • Telegram Channels: ${this.config.telegram.channels ? this.config.telegram.channels.length : 0}`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        // Initialize Twitter validators - same as creation monitor
        this.quickValidator = new TwitterValidator({
            enablePageExtraction: false,
            timeout: 5000 // Fast validation for filtering
        });
        
        this.fullValidator = new TwitterValidator({
            enablePageExtraction: true,
            timeout: this.config.viewCountTimeout // Slower but gets views
        });
        
        // Pass bot type to analysis orchestrator
        this.analysisOrchestrator = new AnalysisOrchestrator({
            ...this.config,
            botType: 'migration' // This monitor handles migration events
        });
        
        this.solanaApi = getSolanaApi();
        
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            viewCountsExtracted: 0,
            errors: 0
        };

        this.processTokenMigration = this.processTokenMigration.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        this.startQueueProcessor();
        this.startMemoryCleanup();
        this.setupShutdownCleanup();
    }

    setupShutdownCleanup() {
        const cleanup = async () => {
            logger.info('🧹 Cleaning up MigrationMonitor resources...');
            try {
                await this.quickValidator.cleanup();
                await this.fullValidator.cleanup();
                logger.info('✅ MigrationMonitor cleanup completed');
            } catch (error) {
                logger.error('❌ Error during cleanup:', error);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
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
            logger.debug(`Failed to fetch metadata from ${uri}:`, error.message);
            return null;
        }
    }

    async processTokenMigration(migrationEvent) {
        const timer = migrationEvent.timer; // Get simple timer from WebSocket
        
        try {
            logger.info(`🔄 Processing token migration: ${migrationEvent.mint}`);
            this.stats.migrationsReceived++;
            
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
                this.stats.migrationsSkipped++;
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
                this.stats.migrationsSkipped++;
                return;
            }
    
            this.processedTokens.add(tokenEvent.mint);
    
            const twitterLink = await this.extractTwitterLink(tokenEvent);
    
            if (!twitterLink) {
                logger.info(`No Twitter link found for migration ${tokenEvent.symbol}, analyzing anyway since it's graduated...`);
                // For migrations without Twitter, still analyze but with empty metrics
                this.processingQueue.push({
                    tokenEvent,
                    twitterLink: null,
                    timestamp: Date.now(),
                    eventType: 'migration',
                    timer: timer
                });
            } else {
                logger.info(`📱 Twitter link found for migration ${tokenEvent.symbol}: ${twitterLink}`);
                this.processingQueue.push({
                    tokenEvent,
                    twitterLink,
                    timestamp: Date.now(),
                    eventType: 'migration',
                    timer: timer
                });
            }
    
            logger.debug(`Added migration ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);
    
        } catch (error) {
            logger.error(`Error processing token migration ${migrationEvent.mint}:`, error);
            this.stats.errors++;
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

        logger.info(`Migration queue processor started with ${this.config.processingDelay}ms interval`);
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.clearProcessedTokens();
        }, 10 * 60 * 1000);
        logger.info('Migration memory cleanup process started');
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            const batchSize = Math.min(3, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing migration batch of ${batch.length} items`);

            const promises = batch.map(item => this.processQueueItem(item));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error('Error processing migration queue:', error);
            this.stats.errors++;
        } finally {
            this.isProcessing = false;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterLink, timestamp, eventType, timer } = item;
        const operationId = timer?.operationId || `${tokenEvent.symbol}_${eventType}_${Date.now()}`;

        try {
            this.stats.migrationsProcessed++;
            logger.info(`🔄 [${operationId}] Processing queued migration: ${tokenEvent.symbol}`);

            if (Date.now() - timestamp > 15 * 60 * 1000) { // 15 minutes for migrations
                logger.warn(`[${operationId}] Migration too old, skipping: ${tokenEvent.symbol}`);
                this.stats.migrationsSkipped++;
                return;
            }

            let finalTwitterMetrics = null;

            // Handle Twitter analysis if link exists
            if (twitterLink) {
                // Step 1: Quick likes check
                logger.debug(`[${operationId}] 🚀 Running quick likes check...`);
                const quickMetrics = await this.quickValidator.quickLikesCheck(twitterLink);

                if (quickMetrics) {
                    logger.info(`[${operationId}] ⚡ Quick check: ${quickMetrics.likes} likes`);

                    // For migrations, we're more lenient with Twitter requirements
                    if (quickMetrics.likes < this.config.minTwitterLikes) {
                        logger.info(`[${operationId}] ${tokenEvent.symbol} has low engagement (${quickMetrics.likes} likes), but analyzing anyway since it graduated`);
                    }

                    // Step 2: Get full metrics if enabled
                    if (this.config.enableViewCountExtraction) {
                        logger.info(`[${operationId}] 🔍 Extracting complete Twitter metrics (including views)...`);
                        try {
                            const fullMetrics = await this.fullValidator.validateEngagement(twitterLink);
                            
                            if (fullMetrics && (fullMetrics.views > 0 || fullMetrics.likes > quickMetrics.likes)) {
                                finalTwitterMetrics = {
                                    link: twitterLink,
                                    views: fullMetrics.views || 0,
                                    likes: Math.max(fullMetrics.likes || 0, quickMetrics.likes || 0),
                                    retweets: fullMetrics.retweets || 0,
                                    replies: fullMetrics.replies || 0,
                                    publishedAt: fullMetrics.publishedAt || quickMetrics.publishedAt
                                };
                                this.stats.viewCountsExtracted++;
                                logger.info(`[${operationId}] ✅ Complete Twitter metrics: ${finalTwitterMetrics.views} views, ${finalTwitterMetrics.likes} likes`);
                            } else {
                                finalTwitterMetrics = {
                                    ...quickMetrics,
                                    link: twitterLink,
                                    views: 0,
                                    retweets: 0,
                                    replies: 0
                                };
                                logger.warn(`[${operationId}] ⚠️ Full metrics extraction failed, using quick metrics only`);
                            }
                        } catch (error) {
                            finalTwitterMetrics = {
                                ...quickMetrics,
                                link: twitterLink,
                                views: 0,
                                retweets: 0,
                                replies: 0
                            };
                            logger.warn(`[${operationId}] ⚠️ View extraction failed: ${error.message}, using quick metrics only`);
                        }
                    } else {
                        finalTwitterMetrics = {
                            ...quickMetrics,
                            link: twitterLink,
                            views: 0,
                            retweets: 0,
                            replies: 0
                        };
                        logger.info(`[${operationId}] 📊 View extraction disabled, using quick metrics: ${finalTwitterMetrics.likes} likes`);
                    }
                } else {
                    logger.info(`[${operationId}] Failed to get Twitter metrics for ${tokenEvent.symbol}, but continuing with migration analysis`);
                    finalTwitterMetrics = {
                        link: twitterLink,
                        views: 0,
                        likes: 0,
                        retweets: 0,
                        replies: 0,
                        publishedAt: null
                    };
                }
            } else {
                // No Twitter link found
                logger.info(`[${operationId}] No Twitter link for migration ${tokenEvent.symbol}, analyzing without social metrics`);
                finalTwitterMetrics = {
                    link: '',
                    views: 0,
                    likes: 0,
                    retweets: 0,
                    replies: 0,
                    publishedAt: null
                };
            }

            // For migrations, analyze regardless of Twitter metrics since token already graduated
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} graduated to Raydium! Starting analysis...`);
            
            await this.triggerAnalysis(tokenEvent, finalTwitterMetrics, operationId, timer);

        } catch (error) {
            logger.error(`[${operationId}] Error processing migration queue item:`, error);
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
                    eventType: 'migration',
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
                    eventType: 'migration'
                },
                twitterMetrics,
                operationId,
                timer: timer
            });

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Migration analysis completed successfully for ${tokenEvent.symbol}`);
                this.stats.analysesCompleted++;
                
                this.emit('analysisCompleted', {
                    tokenEvent,
                    twitterMetrics,
                    analysisResult,
                    operationId
                });
            } else {
                logger.error(`❌ [${operationId}] Migration analysis failed for ${tokenEvent.symbol}:`, analysisResult.error);
                this.stats.errors++;
            }

        } catch (error) {
            logger.error(`[${operationId}] Migration analysis orchestration error:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
        }
    }

    getStatus() {
        return {
            botType: 'migration',
            processedTokensCount: this.processedTokens.size,
            queueLength: this.processingQueue.length,
            currentlyAnalyzing: this.currentlyAnalyzing.size,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses,
            isProcessing: this.isProcessing,
            stats: this.stats,
            config: {
                ...this.config,
                enableViewCountExtraction: this.config.enableViewCountExtraction,
                viewCountTimeout: this.config.viewCountTimeout
            },
            enabledAnalyses: this.analysisOrchestrator.getEnabledAnalyses()
        };
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 1000) {
            logger.info(`Clearing processed migrations cache (${this.processedTokens.size} entries)`);
            this.processedTokens.clear();
        }
    }

    getStatsString() {
        const { migrationsReceived, migrationsProcessed, analysesCompleted, migrationsSkipped, errors, viewCountsExtracted } = this.stats;
        const successRate = migrationsReceived > 0 ? ((analysesCompleted / migrationsReceived) * 100).toFixed(1) : 0;
        const viewExtractionRate = analysesCompleted > 0 ? ((viewCountsExtracted / analysesCompleted) * 100).toFixed(1) : 0;
        
        return `📊 Migration Stats: ${migrationsReceived} received | ${migrationsProcessed} processed | ${analysesCompleted} analyzed | ${migrationsSkipped} skipped | ${viewCountsExtracted} views (${viewExtractionRate}%) | ${errors} errors | ${successRate}% success rate`;
    }

    resetStats() {
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            viewCountsExtracted: 0,
            errors: 0
        };
        logger.info('Migration statistics reset');
    }

    async cleanup() {
        logger.info('🧹 Cleaning up MigrationMonitor...');
        try {
            await this.quickValidator.cleanup();
            await this.fullValidator.cleanup();
            logger.info('✅ MigrationMonitor cleanup completed');
        } catch (error) {
            logger.error('❌ Error during cleanup:', error);
        }
    }
}

module.exports = MigrationMonitor;