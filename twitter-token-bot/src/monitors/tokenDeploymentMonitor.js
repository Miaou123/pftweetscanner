// src/monitors/tokenDeploymentMonitor.js
const EventEmitter = require('events');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const { DeploymentService } = require('../database');

class TokenDeploymentMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            minTwitterViews: config.minTwitterViews || 100000,
            analysisTimeout: config.analysisTimeout || 5 * 60 * 1000, // 5 minutes
            maxConcurrentAnalyses: config.maxConcurrentAnalyses || 3,
            processingDelay: config.processingDelay || 2000, // 2 second delay
            retryAttempts: config.retryAttempts || 3,
            ...config
        };

        this.twitterValidator = new TwitterValidator();
        this.analysisOrchestrator = new AnalysisOrchestrator(this.config);
        this.deploymentService = new DeploymentService();
        
        // Processing state
        this.processedTokens = new Set();
        this.processingQueue = [];
        this.currentlyAnalyzing = new Set();
        this.isProcessing = false;

        // Bind methods
        this.processNewToken = this.processNewToken.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        // Start queue processing
        this.startQueueProcessor();
    }

    async processNewToken(tokenEvent) {
        try {
            logger.info(`🔍 Processing new token: ${tokenEvent.name} (${tokenEvent.symbol}) - ${tokenEvent.mint}`);
            
            // Validate required fields
            if (!this.validateTokenEvent(tokenEvent)) {
                logger.warn(`Invalid token event structure for ${tokenEvent.mint}`);
                return;
            }

            // Check for duplicates
            if (this.processedTokens.has(tokenEvent.mint)) {
                logger.debug(`Token ${tokenEvent.mint} already processed, skipping`);
                return;
            }

            // Mark as processed to prevent duplicates
            this.processedTokens.add(tokenEvent.mint);

            // Extract and validate Twitter link
            const twitterLink = this.extractTwitterLink(tokenEvent);
            if (!twitterLink) {
                logger.debug(`No Twitter link found for ${tokenEvent.symbol} (${tokenEvent.mint})`);
                
                // Save deployment without Twitter info
                await this.saveDeployment(tokenEvent, null, 'no_twitter_link');
                return;
            }

            logger.info(`📱 Twitter link found for ${tokenEvent.symbol}: ${twitterLink}`);

            // Add to processing queue
            this.processingQueue.push({
                tokenEvent,
                twitterLink,
                timestamp: Date.now()
            });

            logger.debug(`Added ${tokenEvent.symbol} to processing queue. Queue size: ${this.processingQueue.length}`);

        } catch (error) {
            logger.error(`Error processing new token ${tokenEvent.mint}:`, error);
            
            // Save deployment with error status
            try {
                await this.saveDeployment(tokenEvent, null, 'processing_error', error.message);
            } catch (saveError) {
                logger.error(`Failed to save deployment with error status:`, saveError);
            }
        }
    }

    validateTokenEvent(tokenEvent) {
        const requiredFields = ['mint', 'name', 'symbol'];
        return requiredFields.every(field => 
            tokenEvent[field] && typeof tokenEvent[field] === 'string' && tokenEvent[field].trim().length > 0
        );
    }

    extractTwitterLink(tokenEvent) {
        // Check multiple possible fields for Twitter links
        const possibleFields = [
            'twitter',
            'social',
            'socials', 
            'uri',
            'metadata',
            'description'
        ];

        for (const field of possibleFields) {
            if (tokenEvent[field]) {
                const twitterLink = this.findTwitterUrl(tokenEvent[field]);
                if (twitterLink) return twitterLink;
            }
        }

        // If uri field exists, try to fetch metadata
        if (tokenEvent.uri) {
            return this.extractTwitterFromUri(tokenEvent.uri);
        }

        return null;
    }

    findTwitterUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Twitter URL patterns
        const twitterPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+/gi
        ];

        for (const pattern of twitterPatterns) {
            const match = text.match(pattern);
            if (match) return match[0];
        }

        return null;
    }

    async extractTwitterFromUri(uri) {
        try {
            // This would fetch metadata from IPFS/Arweave URIs
            // Implementation depends on your metadata fetching logic
            logger.debug(`Attempting to extract Twitter from URI: ${uri}`);
            
            // For now, return null - implement based on your metadata structure
            return null;
        } catch (error) {
            logger.debug(`Failed to extract Twitter from URI ${uri}:`, error.message);
            return null;
        }
    }

    startQueueProcessor() {
        setInterval(async () => {
            if (!this.isProcessing && this.processingQueue.length > 0) {
                await this.processQueue();
            }
        }, this.config.processingDelay);

        logger.info(`Queue processor started with ${this.config.processingDelay}ms interval`);
    }

    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            // Process items in batches to avoid overwhelming the system
            const batchSize = Math.min(3, this.processingQueue.length);
            const batch = this.processingQueue.splice(0, batchSize);

            logger.info(`Processing batch of ${batch.length} tokens`);

            // Process each item in the batch
            const promises = batch.map(item => this.processQueueItem(item));
            await Promise.allSettled(promises);

        } catch (error) {
            logger.error('Error processing queue:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterLink, timestamp } = item;
        const operationId = `${tokenEvent.symbol}_${Date.now()}`;

        try {
            logger.info(`🔄 [${operationId}] Processing queued token: ${tokenEvent.symbol}`);

            // Check if too much time has passed
            if (Date.now() - timestamp > 10 * 60 * 1000) { // 10 minutes
                logger.warn(`[${operationId}] Item too old, skipping: ${tokenEvent.symbol}`);
                await this.saveDeployment(tokenEvent, null, 'expired');
                return;
            }

            // Validate Twitter engagement
            const twitterMetrics = await this.twitterValidator.validateEngagement(twitterLink);
            
            if (!twitterMetrics) {
                logger.info(`[${operationId}] Failed to get Twitter metrics for ${tokenEvent.symbol}`);
                await this.saveDeployment(tokenEvent, { link: twitterLink }, 'twitter_validation_failed');
                return;
            }

            logger.info(`[${operationId}] Twitter metrics for ${tokenEvent.symbol}: ${twitterMetrics.views} views, ${twitterMetrics.likes} likes`);

            // Save deployment with Twitter metrics
            await this.saveDeployment(tokenEvent, {
                link: twitterLink,
                ...twitterMetrics
            }, 'twitter_validated');

            // Check if meets engagement threshold
            if (twitterMetrics.views < this.config.minTwitterViews) {
                logger.info(`[${operationId}] ${tokenEvent.symbol} has ${twitterMetrics.views} views (< ${this.config.minTwitterViews}), skipping analysis`);
                await this.updateDeploymentStatus(tokenEvent.mint, 'below_threshold');
                return;
            }

            // Token meets criteria - trigger analysis
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} meets criteria (${twitterMetrics.views} views)! Starting comprehensive analysis...`);
            
            await this.triggerAnalysis(tokenEvent, twitterMetrics, operationId);

        } catch (error) {
            logger.error(`[${operationId}] Error processing queue item:`, error);
            
            try {
                await this.saveDeployment(tokenEvent, { link: twitterLink }, 'processing_error', error.message);
            } catch (saveError) {
                logger.error(`Failed to save error status for ${tokenEvent.symbol}:`, saveError);
            }
        }
    }

    async triggerAnalysis(tokenEvent, twitterMetrics, operationId) {
        // Check concurrent analysis limit
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Maximum concurrent analyses reached, queuing for later`);
            // Re-queue for later processing
            setTimeout(() => {
                this.processingQueue.unshift({ tokenEvent, twitterLink: twitterMetrics.link, timestamp: Date.now() });
            }, 30000); // Retry in 30 seconds
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            // Update status to analyzing
            await this.updateDeploymentStatus(tokenEvent.mint, 'analyzing');

            // Start comprehensive analysis
            const analysisResult = await this.analysisOrchestrator.analyzeToken({
                tokenAddress: tokenEvent.mint,
                tokenInfo: {
                    name: tokenEvent.name,
                    symbol: tokenEvent.symbol,
                    creator: tokenEvent.traderPublicKey || tokenEvent.creator
                },
                twitterMetrics,
                operationId
            });

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Analysis completed successfully for ${tokenEvent.symbol}`);
                await this.updateDeploymentStatus(tokenEvent.mint, 'analysis_completed', null, analysisResult);
                
                // Emit success event for external listeners
                this.emit('analysisCompleted', {
                    tokenEvent,
                    twitterMetrics,
                    analysisResult,
                    operationId
                });
            } else {
                logger.error(`❌ [${operationId}] Analysis failed for ${tokenEvent.symbol}:`, analysisResult.error);
                await this.updateDeploymentStatus(tokenEvent.mint, 'analysis_failed', analysisResult.error);
            }

        } catch (error) {
            logger.error(`[${operationId}] Analysis orchestration error:`, error);
            await this.updateDeploymentStatus(tokenEvent.mint, 'analysis_error', error.message);
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
        }
    }

    async saveDeployment(tokenEvent, twitterData, status, errorMessage = null) {
        try {
            const deployment = {
                mint: tokenEvent.mint,
                name: tokenEvent.name,
                symbol: tokenEvent.symbol,
                creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                timestamp: new Date(tokenEvent.timestamp || Date.now()),
                twitterLink: twitterData?.link || null,
                twitterViews: twitterData?.views || null,
                twitterLikes: twitterData?.likes || null,
                twitterRetweets: twitterData?.retweets || null,
                status,
                errorMessage,
                metadata: {
                    uri: tokenEvent.uri,
                    marketCapSOL: tokenEvent.marketCapSol,
                    virtualTokenReserves: tokenEvent.virtualTokenReserves,
                    virtualSolReserves: tokenEvent.virtualSolReserves
                }
            };

            await this.deploymentService.saveDeployment(deployment);
            logger.debug(`Saved deployment for ${tokenEvent.symbol} with status: ${status}`);

        } catch (error) {
            logger.error(`Failed to save deployment for ${tokenEvent.symbol}:`, error);
        }
    }

    async updateDeploymentStatus(mint, status, errorMessage = null, analysisResult = null) {
        try {
            await this.deploymentService.updateDeploymentStatus(mint, status, errorMessage, analysisResult);
        } catch (error) {
            logger.error(`Failed to update deployment status for ${mint}:`, error);
        }
    }

    getStatus() {
        return {
            processedTokensCount: this.processedTokens.size,
            queueLength: this.processingQueue.length,
            currentlyAnalyzing: this.currentlyAnalyzing.size,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses,
            isProcessing: this.isProcessing,
            config: this.config
        };
    }

    clearProcessedTokens() {
        // Clear old entries to prevent memory issues
        if (this.processedTokens.size > 10000) {
            logger.info('Clearing processed tokens cache to prevent memory issues');
            this.processedTokens.clear();
        }
    }
}

module.exports = TokenDeploymentMonitor;