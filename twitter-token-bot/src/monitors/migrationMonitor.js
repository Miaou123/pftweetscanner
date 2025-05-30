// src/monitors/migrationMonitor.js - REFACTORED for true parallelization
const EventEmitter = require('events');
const logger = require('../utils/logger');
const TwitterValidator = require('../validators/twitterValidator');
const AnalysisOrchestrator = require('../orchestrators/analysisOrchestrator');
const TelegramPublisher = require('../publishers/telegramPublisher');
const pumpfunApi = require('../integrations/pumpfunApi');

class MigrationMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            minTwitterViews: config.minTwitterViews || 50000,
            minTwitterLikes: config.minTwitterLikes || 1,
            analysisTimeout: config.analysisTimeout || 10 * 60 * 1000,
            maxConcurrentAnalyses: config.maxConcurrentAnalyses || 5,
            processingDelay: config.processingDelay || 1000,
            enableViewCountExtraction: config.enableViewCountExtraction !== false,
            viewCountTimeout: config.viewCountTimeout || 15000,
            telegram: config.telegram || {},
            ...config
        };

        logger.info(`📋 MigrationMonitor Config:`);
        logger.info(`   • Min Twitter Views: ${this.config.minTwitterViews.toLocaleString()}`);
        logger.info(`   • Min Twitter Likes: ${this.config.minTwitterLikes.toLocaleString()}`);
        logger.info(`   • Analysis Timeout: ${this.config.analysisTimeout / 1000}s`);
        logger.info(`   • View Count Extraction: ${this.config.enableViewCountExtraction ? 'Enabled' : 'Disabled'}`);

        this.twitterValidator = new TwitterValidator({
            enablePageExtraction: this.config.enableViewCountExtraction,
            timeout: this.config.viewCountTimeout,
            quickTimeout: 5000
        });
        
        // ✅ AnalysisOrchestrator configured to NOT publish (we handle publishing here)
        this.analysisOrchestrator = new AnalysisOrchestrator({
            ...this.config,
            botType: 'migration',
            publishResults: false, // 🔥 KEY CHANGE: Disable auto-publishing
            saveToJson: true       // Keep JSON logging
        });
        
        // ✅ MigrationMonitor handles Telegram publishing directly
        this.telegramPublisher = new TelegramPublisher(this.config.telegram);
        
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
            metadataFetchFailures: 0,
            errors: 0,
            avgMetadataFetchTime: 0,
            avgTwitterValidationTime: 0,
            avgViewExtractionTime: 0,
            avgAnalysisTime: 0,
            avgBundleAnalysisTime: 0,
            avgTopHoldersAnalysisTime: 0,
            slowestAnalysis: { time: 0, token: '' },
            fastestAnalysis: { time: Infinity, token: '' }
        };

        this.processTokenMigration = this.processTokenMigration.bind(this);
        this.processQueue = this.processQueue.bind(this);
        
        this.startQueueProcessor();
        this.startMemoryCleanup();
        this.setupShutdownCleanup();
    }

    async processTokenMigration(migrationEvent) {
        const timer = migrationEvent.timer;
        const startTime = Date.now();
        
        try {
            logger.info(`🔄 Processing token migration: ${migrationEvent.mint}`);
            this.stats.migrationsReceived++;
            
            if (this.processedTokens.has(migrationEvent.mint)) {
                logger.debug(`Migration token ${migrationEvent.mint} already processed, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            this.processedTokens.add(migrationEvent.mint);

            // STEP 1: Fetch token metadata
            logger.info(`⏱️ [${timer.operationId}] Step 1: Fetching token metadata...`);
            const metadataStart = Date.now();
            
            let tokenInfo;
            try {
                tokenInfo = await pumpfunApi.getTokenInfo(migrationEvent.mint);
                const metadataTime = Date.now() - metadataStart;
                logger.info(`✅ [${timer.operationId}] Metadata fetched in ${metadataTime}ms`);
                this.updateTimingStats('metadata', metadataTime);
            } catch (error) {
                const metadataTime = Date.now() - metadataStart;
                logger.warn(`❌ [${timer.operationId}] Metadata fetch failed in ${metadataTime}ms: ${error.message}`);
                this.stats.metadataFetchFailures++;
                this.stats.migrationsSkipped++;
                return;
            }

            if (!tokenInfo) {
                logger.warn(`No token info found for migration ${migrationEvent.mint}, skipping`);
                this.stats.metadataFetchFailures++;
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ Token metadata: ${tokenInfo.name} (${tokenInfo.symbol})`);

            // STEP 2: Extract Twitter URL
            logger.info(`⏱️ [${timer.operationId}] Step 2: Extracting Twitter URL...`);
            const twitterExtractStart = Date.now();
            
            const twitterUrl = await this.extractTwitterUrlFromTokenInfo(tokenInfo);
            const twitterExtractTime = Date.now() - twitterExtractStart;
            
            if (!twitterUrl) {
                logger.info(`❌ [${timer.operationId}] No Twitter URL found in ${twitterExtractTime}ms, skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ [${timer.operationId}] Twitter URL found in ${twitterExtractTime}ms: ${twitterUrl}`);

            // Add to queue with timing info
            const completeTokenEvent = {
                ...migrationEvent,
                eventType: 'migration',
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                timer: timer,
                tokenInfo: tokenInfo,
                processingTimes: {
                    metadataFetch: Date.now() - metadataStart,
                    twitterExtract: twitterExtractTime,
                    queuedAt: Date.now()
                }
            };

            this.processingQueue.push({
                tokenEvent: completeTokenEvent,
                twitterUrl,
                timestamp: Date.now(),
                eventType: 'migration',
                timer: timer
            });

            const totalPreProcessTime = Date.now() - startTime;
            logger.info(`📊 [${timer.operationId}] Pre-processing completed in ${totalPreProcessTime}ms, added to queue (size: ${this.processingQueue.length})`);

        } catch (error) {
            const totalTime = Date.now() - startTime;
            logger.error(`❌ [${timer.operationId}] Error processing migration in ${totalTime}ms:`, error);
            this.stats.errors++;
        }
    }

    async processQueueItem(item) {
        const { tokenEvent, twitterUrl, timestamp, eventType, timer } = item;
        const operationId = timer?.operationId || `${tokenEvent.symbol}_${eventType}_${Date.now()}`;
        const processingStart = Date.now();

        try {
            this.stats.migrationsProcessed++;
            logger.info(`🔄 [${operationId}] Processing queued migration: ${tokenEvent.symbol}`);

            // Check if item is too old
            const queueAge = Date.now() - timestamp;
            if (queueAge > 15 * 60 * 1000) {
                logger.warn(`[${operationId}] Migration too old (${Math.round(queueAge/1000)}s), skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`📊 [${operationId}] Queue wait time: ${queueAge}ms`);

            // STEP 3: Quick likes check
            logger.info(`⏱️ [${operationId}] Step 3: Quick likes validation...`);
            const likesStart = Date.now();
            
            const quickMetrics = await this.twitterValidator.quickLikesCheck(twitterUrl);
            const likesTime = Date.now() - likesStart;

            if (!quickMetrics || !quickMetrics.likes) {
                logger.warn(`❌ [${operationId}] Twitter validation failed in ${likesTime}ms`);
                this.updateTimingStats('twitterValidation', likesTime);
                this.stats.migrationsSkipped++;
                return;
            }

            logger.info(`✅ [${operationId}] Found ${quickMetrics.likes} likes in ${likesTime}ms`);
            this.updateTimingStats('twitterValidation', likesTime);

            // Check engagement threshold
            if (quickMetrics.likes < this.config.minTwitterLikes) {
                logger.info(`❌ [${operationId}] ${tokenEvent.symbol} has ${quickMetrics.likes} likes (< ${this.config.minTwitterLikes}), skipping`);
                this.stats.migrationsSkipped++;
                return;
            }

            // QUALIFIED! Run true parallel analysis
            logger.info(`🚀 [${operationId}] ${tokenEvent.symbol} qualified with ${quickMetrics.likes} likes! Starting parallel analysis...`);
            await this.runTrulyParallelAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer, processingStart, likesTime);

        } catch (error) {
            const processingTime = Date.now() - processingStart;
            logger.error(`❌ [${operationId}] Error processing migration queue item in ${processingTime}ms:`, error);
            this.stats.errors++;
        }
    }

    async runTrulyParallelAnalysis(tokenEvent, twitterUrl, quickMetrics, operationId, timer, processingStart, likesTime) {
        // Check concurrent limit
        if (this.currentlyAnalyzing.size >= this.config.maxConcurrentAnalyses) {
            logger.warn(`[${operationId}] Max concurrent analyses reached (${this.currentlyAnalyzing.size}/${this.config.maxConcurrentAnalyses}), requeuing`);
            setTimeout(() => {
                this.processingQueue.unshift({ 
                    tokenEvent, 
                    twitterUrl, 
                    timestamp: Date.now(),
                    eventType: 'migration',
                    timer 
                });
            }, 30000);
            return;
        }

        this.currentlyAnalyzing.add(tokenEvent.mint);

        try {
            // 🚀 STEP 4 & 5: TRUE PARALLELIZATION - Views + Analysis run independently
            logger.info(`⚡ [${operationId}] Step 4 & 5: Running TRUE parallel operations (views + analysis)...`);
            
            const parallelStart = Date.now();
            let viewExtractionTime = 0;
            let analysisTime = 0;
            
            // Prepare parallel promises
            const promises = [];
            
            // Promise 1: View extraction (if enabled)
            let viewPromise = null;
            if (this.config.enableViewCountExtraction) {
                viewPromise = this.extractViewsWithTiming(twitterUrl, operationId);
                promises.push(viewPromise);
            }
            
            // Promise 2: Analysis (always runs)
            const analysisPromise = this.runAnalysisWithTiming(tokenEvent, quickMetrics, operationId, timer);
            promises.push(analysisPromise);
            
            // 🔥 Execute in TRUE parallel
            logger.info(`🔥 [${operationId}] Executing ${promises.length} operations in parallel...`);
            const results = await Promise.allSettled(promises);
            
            const parallelExecutionTime = Date.now() - parallelStart;
            logger.info(`⚡ [${operationId}] Parallel execution completed in ${parallelExecutionTime}ms`);
            
            // Process results
            let viewMetrics = null;
            let analysisResult = null;
            
            if (this.config.enableViewCountExtraction) {
                // Extract view results
                const viewResult = results[0];
                if (viewResult.status === 'fulfilled') {
                    viewMetrics = viewResult.value.viewMetrics;
                    viewExtractionTime = viewResult.value.duration;
                    logger.info(`✅ [${operationId}] View extraction: ${viewMetrics ? viewMetrics.views + ' views' : 'failed'} (${viewExtractionTime}ms)`);
                } else {
                    viewExtractionTime = parallelExecutionTime;
                    logger.warn(`❌ [${operationId}] View extraction failed: ${viewResult.reason.message}`);
                }
                
                // Extract analysis results
                const analysisResultData = results[1];
                if (analysisResultData.status === 'fulfilled') {
                    analysisResult = analysisResultData.value.analysisResult;
                    analysisTime = analysisResultData.value.duration;
                    logger.info(`✅ [${operationId}] Analysis: ${analysisResult.success ? 'success' : 'failed'} (${analysisTime}ms)`);
                } else {
                    analysisTime = parallelExecutionTime;
                    logger.error(`❌ [${operationId}] Analysis failed: ${analysisResultData.reason.message}`);
                    this.stats.errors++;
                    return;
                }
            } else {
                // Only analysis ran
                const analysisResultData = results[0];
                if (analysisResultData.status === 'fulfilled') {
                    analysisResult = analysisResultData.value.analysisResult;
                    analysisTime = analysisResultData.value.duration;
                    logger.info(`✅ [${operationId}] Analysis: ${analysisResult.success ? 'success' : 'failed'} (${analysisTime}ms)`);
                } else {
                    analysisTime = parallelExecutionTime;
                    logger.error(`❌ [${operationId}] Analysis failed: ${analysisResultData.reason.message}`);
                    this.stats.errors++;
                    return;
                }
            }
            
            // 🎯 STEP 6: Combine results and create final Twitter metrics
            const finalTwitterMetrics = this.createFinalTwitterMetrics(
                quickMetrics, 
                viewMetrics, 
                twitterUrl, 
                operationId
            );
            
            // 🎯 STEP 7: Calculate time savings from parallelization
            const timeSaved = this.calculateTimeSavings(viewExtractionTime, analysisTime, parallelExecutionTime);
            
            // Update timing stats
            this.updateTimingStats('analysis', analysisTime);
            if (viewExtractionTime > 0) {
                this.updateTimingStats('viewExtraction', viewExtractionTime);
            }
            
            // Extract individual analysis timings
            const { bundleAnalysisTime, topHoldersAnalysisTime } = this.extractAnalysisTimings(
                analysisResult, 
                analysisTime, 
                operationId
            );
            
            this.updateTimingStats('bundleAnalysis', bundleAnalysisTime);
            this.updateTimingStats('topHoldersAnalysis', topHoldersAnalysisTime);
            
            const totalProcessingTime = Date.now() - processingStart;
            this.updateAnalysisTimingStats(totalProcessingTime, tokenEvent.symbol);
            
            // 🎯 STEP 8: Publish to Telegram with COMPLETE metrics
            logger.info(`📤 [${operationId}] Publishing results with complete metrics...`);
            logger.info(`📊 [${operationId}] Final metrics: Views=${finalTwitterMetrics.views}, Likes=${finalTwitterMetrics.likes}`);
            
            await this.publishCompletedAnalysis(
                tokenEvent,
                finalTwitterMetrics,
                analysisResult,
                operationId,
                timer,
                {
                    metadataFetch: tokenEvent.processingTimes?.metadataFetch || 0,
                    twitterExtract: tokenEvent.processingTimes?.twitterExtract || 0,
                    queueWait: processingStart - (tokenEvent.processingTimes?.queuedAt || 0),
                    likesValidation: likesTime,
                    viewExtraction: viewExtractionTime,
                    analysis: analysisTime,
                    bundleAnalysis: bundleAnalysisTime,
                    topHoldersAnalysis: topHoldersAnalysisTime,
                    totalProcessing: totalProcessingTime,
                    endToEnd: timer ? timer.getElapsedMs() : totalProcessingTime,
                    timeSavedByParallelization: timeSaved
                }
            );
            
            // Log detailed timing breakdown
            this.logDetailedTiming(operationId, tokenEvent, finalTwitterMetrics, {
                metadata: tokenEvent.processingTimes?.metadataFetch || 0,
                twitterExtract: tokenEvent.processingTimes?.twitterExtract || 0,
                queueWait: processingStart - (tokenEvent.processingTimes?.queuedAt || 0),
                likes: likesTime,
                viewExtraction: viewExtractionTime,
                analysis: analysisTime,
                bundleAnalysis: bundleAnalysisTime,
                topHoldersAnalysis: topHoldersAnalysisTime,
                timeSaved: timeSaved
            });
            
            this.stats.analysesCompleted++;

        } catch (error) {
            const totalTime = Date.now() - processingStart;
            logger.error(`❌ [${operationId}] True parallel analysis error in ${totalTime}ms:`, error);
            this.stats.errors++;
        } finally {
            this.currentlyAnalyzing.delete(tokenEvent.mint);
        }
    }

    // 🔥 NEW: Extract views with timing
    async extractViewsWithTiming(twitterUrl, operationId) {
        const viewStart = Date.now();
        try {
            const tweetId = this.twitterValidator.extractTweetId(twitterUrl);
            const viewMetrics = await this.twitterValidator.getViewsFromPage(tweetId);
            const duration = Date.now() - viewStart;
            
            if (viewMetrics && viewMetrics.views > 0) {
                this.stats.viewCountsExtracted++;
            }
            
            return { viewMetrics, duration };
        } catch (error) {
            const duration = Date.now() - viewStart;
            logger.warn(`⚠️ [${operationId}] View extraction error (${duration}ms): ${error.message}`);
            return { viewMetrics: null, duration };
        }
    }

    // 🔥 NEW: Run analysis with timing
    async runAnalysisWithTiming(tokenEvent, quickMetrics, operationId, timer) {
        const analysisStart = Date.now();
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
                twitterMetrics: quickMetrics, // Use basic metrics for analysis
                operationId,
                timer
            });
            
            const duration = Date.now() - analysisStart;
            return { analysisResult, duration };
        } catch (error) {
            const duration = Date.now() - analysisStart;
            logger.error(`❌ [${operationId}] Analysis execution error (${duration}ms): ${error.message}`);
            throw error;
        }
    }

    // 🔥 NEW: Create final Twitter metrics combining likes + views
    createFinalTwitterMetrics(quickMetrics, viewMetrics, twitterUrl, operationId) {
        const finalMetrics = {
            link: twitterUrl,
            likes: quickMetrics.likes,
            views: 0,
            retweets: 0,
            replies: 0,
            publishedAt: quickMetrics.publishedAt
        };

        if (viewMetrics && viewMetrics.views > 0) {
            finalMetrics.views = viewMetrics.views;
            logger.info(`🎯 [${operationId}] Enhanced metrics: ${viewMetrics.views} views + ${quickMetrics.likes} likes`);
        } else {
            logger.info(`🎯 [${operationId}] Basic metrics: ${quickMetrics.likes} likes only`);
        }

        return finalMetrics;
    }

    // 🔥 NEW: Calculate time saved by parallelization
    calculateTimeSavings(viewTime, analysisTime, parallelTime) {
        if (viewTime <= 0) return 0;
        
        const sequentialTime = viewTime + analysisTime;
        const actualTime = parallelTime;
        return Math.max(0, sequentialTime - actualTime);
    }

    // 🔥 NEW: Extract individual analysis timings
    extractAnalysisTimings(analysisResult, totalAnalysisTime, operationId) {
        let bundleAnalysisTime = 0;
        let topHoldersAnalysisTime = 0;
        
        // Try to get actual timings from result
        if (analysisResult.analyses?.bundle?.duration) {
            bundleAnalysisTime = analysisResult.analyses.bundle.duration;
        }
        if (analysisResult.analyses?.topHolders?.duration) {
            topHoldersAnalysisTime = analysisResult.analyses.topHolders.duration;
        }
        
        // If no individual timings, estimate based on complexity
        if (bundleAnalysisTime === 0 && topHoldersAnalysisTime === 0) {
            const bundleResult = analysisResult.analyses?.bundle?.result;
            if (bundleResult) {
                const bundleCount = (bundleResult.bundles && bundleResult.bundles.length) || 0;
                if (bundleCount <= 20) {
                    bundleAnalysisTime = Math.round(totalAnalysisTime * 0.25);
                    topHoldersAnalysisTime = totalAnalysisTime - bundleAnalysisTime;
                } else if (bundleCount <= 100) {
                    bundleAnalysisTime = Math.round(totalAnalysisTime * 0.4);
                    topHoldersAnalysisTime = totalAnalysisTime - bundleAnalysisTime;
                } else {
                    bundleAnalysisTime = Math.round(totalAnalysisTime * 0.7);
                    topHoldersAnalysisTime = totalAnalysisTime - bundleAnalysisTime;
                }
            } else {
                bundleAnalysisTime = Math.round(totalAnalysisTime * 0.25);
                topHoldersAnalysisTime = totalAnalysisTime - bundleAnalysisTime;
            }
        }
        
        return { bundleAnalysisTime, topHoldersAnalysisTime };
    }

    // 🔥 NEW: Publish completed analysis with complete metrics
    async publishCompletedAnalysis(tokenEvent, finalTwitterMetrics, analysisResult, operationId, timer, timingBreakdown) {
        try {
            // Create the complete analysis result for publishing
            const completeAnalysisResult = {
                ...analysisResult,
                tokenInfo: {
                    name: tokenEvent.name,
                    symbol: tokenEvent.symbol,
                    creator: tokenEvent.traderPublicKey || tokenEvent.creator,
                    address: tokenEvent.mint,
                    eventType: 'migration'
                },
                twitterMetrics: finalTwitterMetrics, // 🔥 COMPLETE metrics with views
                operationId,
                timer
            };

            // Publish to Telegram
            await this.telegramPublisher.publishAnalysis(completeAnalysisResult);
            logger.info(`📤 [${operationId}] Published to Telegram with ${finalTwitterMetrics.views} views, ${finalTwitterMetrics.likes} likes`);

            // Emit analysisCompleted event for monitoring
            this.emit('analysisCompleted', {
                tokenEvent,
                twitterMetrics: finalTwitterMetrics,
                analysisResult,
                operationId,
                timingBreakdown
            });

        } catch (error) {
            logger.error(`❌ [${operationId}] Failed to publish analysis: ${error.message}`);
            this.stats.errors++;
        }
    }

    // 🔥 NEW: Log detailed timing breakdown
    logDetailedTiming(operationId, tokenEvent, finalTwitterMetrics, timings) {
        logger.info(`✅ [${operationId}] Analysis completed successfully!`);
        logger.info(`📊 [${operationId}] Timing Breakdown:`);
        logger.info(`   • Metadata fetch: ${timings.metadata}ms`);
        logger.info(`   • Twitter extract: ${timings.twitterExtract}ms`);
        logger.info(`   • Queue wait: ${timings.queueWait}ms`);
        logger.info(`   • Likes validation: ${timings.likes}ms`);
        if (timings.viewExtraction > 0) {
            logger.info(`   • View extraction: ${timings.viewExtraction}ms (parallel)`);
        }
        logger.info(`   • Analysis execution: ${timings.analysis}ms (parallel)`);
        if (timings.bundleAnalysis > 0) {
            logger.info(`     ↳ Bundle analysis: ${timings.bundleAnalysis}ms`);
        }
        if (timings.topHoldersAnalysis > 0) {
            logger.info(`     ↳ Top holders analysis: ${timings.topHoldersAnalysis}ms`);
        }
        if (timings.timeSaved > 0) {
            logger.info(`   • Time saved by parallelization: ~${timings.timeSaved}ms`);
        }
        logger.info(`📊 [${operationId}] Final result: ${finalTwitterMetrics.views} views, ${finalTwitterMetrics.likes} likes`);
    }

    // Enhanced timing statistics methods
    updateTimingStats(operation, time) {
        const avgKey = `avg${operation.charAt(0).toUpperCase() + operation.slice(1)}Time`;
        if (this.stats[avgKey] === 0) {
            this.stats[avgKey] = time;
        } else {
            this.stats[avgKey] = Math.round((this.stats[avgKey] + time) / 2);
        }
    }

    updateAnalysisTimingStats(totalTime, tokenSymbol) {
        // Track slowest and fastest
        if (totalTime > this.stats.slowestAnalysis.time) {
            this.stats.slowestAnalysis = { time: totalTime, token: tokenSymbol };
        }
        if (totalTime < this.stats.fastestAnalysis.time) {
            this.stats.fastestAnalysis = { time: totalTime, token: tokenSymbol };
        }
    }

    // [All other helper methods remain the same...]
    async extractTwitterUrlFromTokenInfo(tokenInfo) {
        if (tokenInfo.twitter) {
            const directTwitterUrl = this.findTwitterStatusUrl(tokenInfo.twitter);
            if (directTwitterUrl) {
                return directTwitterUrl;
            }
        }

        const fieldsToCheck = ['website', 'telegram', 'description'];
        for (const field of fieldsToCheck) {
            if (tokenInfo[field]) {
                const twitterUrl = this.findTwitterStatusUrl(tokenInfo[field]);
                if (twitterUrl) {
                    return twitterUrl;
                }
            }
        }

        if (tokenInfo.metadata_uri) {
            try {
                const metadataTwitterUrl = await this.extractFromMetadataUri(tokenInfo.metadata_uri);
                if (metadataTwitterUrl) {
                    return metadataTwitterUrl;
                }
            } catch (error) {
                logger.debug(`Failed to fetch metadata from URI: ${error.message}`);
            }
        }

        return null;
    }

    findTwitterStatusUrl(text) {
        if (!text || typeof text !== 'string') return null;
        
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];

        for (const pattern of statusPatterns) {
            const matches = text.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
    }

    async extractFromMetadataUri(uri) {
        try {
            let fetchUrl = uri;
            if (uri.startsWith('ipfs://')) {
                fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (uri.startsWith('ar://')) {
                fetchUrl = uri.replace('ar://', 'https://arweave.net/');
            }
            
            const axios = require('axios');
            const response = await axios.get(fetchUrl, { 
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)' }
            });
            
            if (response.data) {
                return this.findTwitterStatusInMetadata(response.data);
            }
            return null;
            
        } catch (error) {
            logger.debug(`Failed to fetch metadata from ${uri}: ${error.message}`);
            return null;
        }
    }

    findTwitterStatusInMetadata(metadata) {
        const statusPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
        ];
        
        const fieldsToCheck = ['twitter', 'social', 'socials', 'links', 'external_url', 'description'];
        
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of statusPatterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) return matches[0];
                }
            }
        }
        
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of statusPatterns) {
            const matches = metadataStr.match(pattern);
            if (matches) return matches[0];
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

    setupShutdownCleanup() {
        const cleanup = async () => {
            logger.info('🧹 Cleaning up MigrationMonitor resources...');
            try {
                await this.twitterValidator.cleanup();
                logger.info('✅ MigrationMonitor cleanup completed');
            } catch (error) {
                logger.error('❌ Error during cleanup:', error);
            }
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
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
            enabledAnalyses: this.analysisOrchestrator.getEnabledAnalyses(),
            timingAverages: {
                metadata: `${this.stats.avgMetadataFetchTime}ms`,
                twitter: `${this.stats.avgTwitterValidationTime}ms`,
                views: `${this.stats.avgViewExtractionTime}ms`,
                analysis: `${this.stats.avgAnalysisTime}ms`,
                bundleAnalysis: `${this.stats.avgBundleAnalysisTime}ms`,
                topHoldersAnalysis: `${this.stats.avgTopHoldersAnalysisTime}ms`
            },
            timingExtremes: {
                slowest: `${Math.round(this.stats.slowestAnalysis.time/1000)}s (${this.stats.slowestAnalysis.token})`,
                fastest: this.stats.fastestAnalysis.time < Infinity ? 
                    `${Math.round(this.stats.fastestAnalysis.time/1000)}s (${this.stats.fastestAnalysis.token})` : 'N/A'
            }
        };
    }

    clearProcessedTokens() {
        if (this.processedTokens.size > 1000) {
            logger.info(`Clearing processed migrations cache (${this.processedTokens.size} entries)`);
            this.processedTokens.clear();
        }
    }

    getStatsString() {
        const { migrationsReceived, migrationsProcessed, analysesCompleted, migrationsSkipped, errors, viewCountsExtracted, metadataFetchFailures } = this.stats;
        const successRate = migrationsReceived > 0 ? ((analysesCompleted / migrationsReceived) * 100).toFixed(1) : 0;
        const viewExtractionRate = analysesCompleted > 0 ? ((viewCountsExtracted / analysesCompleted) * 100).toFixed(1) : 0;
        
        return `📊 Migration Stats: ${migrationsReceived} received | ${migrationsProcessed} processed | ${analysesCompleted} analyzed | ${migrationsSkipped} skipped | ${metadataFetchFailures} metadata failures | ${viewCountsExtracted} views (${viewExtractionRate}%) | Avg times: Meta ${this.stats.avgMetadataFetchTime}ms, Views ${this.stats.avgViewExtractionTime}ms, Bundle ${this.stats.avgBundleAnalysisTime}ms, Holders ${this.stats.avgTopHoldersAnalysisTime}ms | ${errors} errors | ${successRate}% success`;
    }

    resetStats() {
        this.stats = {
            migrationsReceived: 0,
            migrationsProcessed: 0,
            analysesCompleted: 0,
            migrationsSkipped: 0,
            viewCountsExtracted: 0,
            metadataFetchFailures: 0,
            errors: 0,
            avgMetadataFetchTime: 0,
            avgTwitterValidationTime: 0,
            avgViewExtractionTime: 0,
            avgAnalysisTime: 0,
            avgBundleAnalysisTime: 0,
            avgTopHoldersAnalysisTime: 0,
            slowestAnalysis: { time: 0, token: '' },
            fastestAnalysis: { time: Infinity, token: '' }
        };
        logger.info('Migration statistics reset');
    }

    async cleanup() {
        logger.info('🧹 Cleaning up MigrationMonitor...');
        try {
            await this.twitterValidator.cleanup();
            logger.info('✅ MigrationMonitor cleanup completed');
        } catch (error) {
            logger.error('❌ Error during cleanup:', error);
        }
    }
}

module.exports = MigrationMonitor;