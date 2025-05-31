// Updated AnalysisOrchestrator with ULTRA-FAST webhook integration
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');
const BundleAnalyzer = require('../analysis/bundleAnalyzer');
const TopHoldersAnalyzer = require('../analysis/topHoldersAnalyzer');
const TelegramPublisher = require('../publishers/telegramPublisher');
const JsonLogger = require('../services/jsonLogger');
const config = require('../config'); // FIXED: Use simplified config

class AnalysisOrchestrator {
    constructor(config = {}) {
        // Determine bot type from config
        this.botType = config.botType || 'creation'; // 'creation' or 'migration'
        
        this.config = {
            analysisTimeout: config.analysisTimeout || 5 * 60 * 1000,
            publishResults: config.publishResults !== false,
            saveToJson: config.saveToJson !== false, // Enable JSON logging by default
            ...config
        };

        // Get bot-specific enabled analyses from simplified config
        const botSpecificConfig = require('../config').getConfigForBot(this.botType);
        this.config.enabledAnalyses = botSpecificConfig.enabledAnalyses;
        this.config.maxConcurrentAnalyses = botSpecificConfig.maxConcurrent;

        // 🚀 WEBHOOK CONFIGURATION - Ultra-fast trading bot integration
        this.webhookConfig = {
            enabled: process.env.ENABLE_TRADING_WEBHOOK === 'true',
            url: process.env.TRADING_BOT_WEBHOOK_URL || 'http://localhost:3001/webhook/alert',
            apiKey: process.env.TRADING_BOT_API_KEY || 'your-secret-key',
            timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 3000, // 3 second timeout
            retries: parseInt(process.env.WEBHOOK_RETRIES) || 1, // Quick retry
            fallbackToTelegram: process.env.WEBHOOK_FALLBACK !== 'false'
        };

        logger.info(`🔬 AnalysisOrchestrator initialized for ${this.botType} bot`);
        logger.info(`📋 Enabled analyses: ${this.config.enabledAnalyses.join(', ')}`);
        
        // 🚀 Log webhook status
        if (this.webhookConfig.enabled) {
            logger.info(`⚡ FAST WEBHOOK ENABLED: ${this.webhookConfig.url}`);
            logger.info(`🎯 Trading bot will receive alerts in ~5-20ms!`);
        } else {
            logger.info(`📱 Using Telegram-only integration (slower)`);
        }

        this.bundleAnalyzer = BundleAnalyzer;
        this.topHoldersAnalyzer = new TopHoldersAnalyzer();
        this.telegramPublisher = new TelegramPublisher(config.telegram || {});
        
        // Initialize JSON logger
        this.jsonLogger = new JsonLogger({
            logsDirectory: config.jsonLogsDirectory || path.join(process.cwd(), 'scan_results'),
            rotateDaily: config.rotateDailyLogs !== false
        });
        
        // Analysis state
        this.activeAnalyses = new Map();
        this.completedAnalyses = new Map();
        
        // Webhook statistics
        this.webhookStats = {
            alertsSent: 0,
            alertsSuccessful: 0,
            alertsFailed: 0,
            averageLatency: 0,
            totalLatency: 0,
            fastestAlert: Infinity,
            slowestAlert: 0
        };
    }

    async analyzeToken(tokenData) {
        const { tokenAddress, tokenInfo, twitterMetrics, operationId, timer } = tokenData;
        
        logger.info(`🔬 [${operationId}] Starting comprehensive analysis for ${tokenInfo.symbol} (${tokenAddress})`);
        logger.info(`🔬 [${operationId}] Bot type: ${this.botType}, Enabled analyses: ${this.config.enabledAnalyses.join(', ')}`);
        
        const analysisResult = {
            tokenAddress,
            tokenInfo,
            twitterMetrics,
            operationId,
            startTime: Date.now(),
            success: false,
            analyses: {},
            errors: [],
            summary: {},
            timer: timer
        };

        // Create cancellation token for timeout handling
        const cancellationToken = this.createCancellationToken(this.config.analysisTimeout);
        this.activeAnalyses.set(operationId, cancellationToken);

        try {
            const analysisPromises = [];

            // Run analyses based on what's enabled for this bot type
            if (this.config.enabledAnalyses.includes('bundle')) {
                logger.info(`🔬 [${operationId}] Starting bundle analysis (parallel)`);
                analysisPromises.push(
                    this.runAnalysisWithTimeout(
                        'bundle',
                        () => this.bundleAnalyzer.analyzeBundle(tokenAddress, 50000),
                        operationId,
                        cancellationToken
                    )
                );
            } else {
                logger.debug(`🔬 [${operationId}] Bundle analysis disabled for ${this.botType} bot`);
            }

            if (this.config.enabledAnalyses.includes('topHolders')) {
                logger.info(`🔬 [${operationId}] Starting top holders analysis (parallel)`);
                analysisPromises.push(
                    this.runAnalysisWithTimeout(
                        'topHolders',
                        () => this.topHoldersAnalyzer.analyzeTopHolders(tokenAddress, 20),
                        operationId,
                        cancellationToken
                    )
                );
            } else {
                logger.debug(`🔬 [${operationId}] Top holders analysis disabled for ${this.botType} bot`);
            }

            if (analysisPromises.length === 0) {
                logger.warn(`🔬 [${operationId}] No analyses enabled for ${this.botType} bot!`);
                throw new Error(`No analyses enabled for ${this.botType} bot`);
            }

            // Wait for ALL analyses to complete in parallel
            logger.info(`🔬 [${operationId}] Running ${analysisPromises.length} analyses in parallel...`);
            const analysisResults = await Promise.allSettled(analysisPromises);
            logger.info(`🔬 [${operationId}] All parallel analyses completed`);

            // Process results
            analysisResults.forEach((result, index) => {
                const analysisType = this.config.enabledAnalyses.filter(type => 
                    ['bundle', 'topHolders', 'devAnalysis'].includes(type)
                )[index];
                
                if (result.status === 'fulfilled') {
                    analysisResult.analyses[analysisType] = result.value;
                    if (!result.value.success) {
                        analysisResult.errors.push(`${analysisType}: ${result.value.error}`);
                    }
                } else {
                    analysisResult.analyses[analysisType] = {
                        success: false,
                        error: result.reason.message || 'Unknown error',
                        type: analysisType
                    };
                    analysisResult.errors.push(`${analysisType}: ${result.reason.message || 'Unknown error'}`);
                }
            });
            
            // Generate comprehensive summary
            this.generateComprehensiveSummary(analysisResult);

            // Determine overall success
            const successfulAnalyses = Object.values(analysisResult.analyses)
                .filter(analysis => analysis.success).length;

            analysisResult.success = successfulAnalyses > 0;
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;

            // Save to JSON file before publishing
            if (this.config.saveToJson) {
                await this.saveToJsonLog(analysisResult);
            }

            // 🚀 PUBLISH RESULTS WITH WEBHOOK-FIRST STRATEGY
            if (this.config.publishResults) {
                await this.publishResultsWithWebhook(analysisResult);
            }

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Comprehensive analysis completed successfully in ${analysisResult.duration}ms`);
                logger.info(`📊 [${operationId}] Results: ${successfulAnalyses}/${Object.keys(analysisResult.analyses).length} analyses successful`);
            } else {
                logger.warn(`⚠️ [${operationId}] All analyses failed - but notification sent`);
            }

            return analysisResult;

        } catch (error) {
            logger.error(`❌ [${operationId}] Analysis orchestration failed:`, error);
            analysisResult.error = error.message;
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;
            
            // Save failed analysis to JSON as well
            if (this.config.saveToJson) {
                await this.saveToJsonLog(analysisResult);
            }
            
            return analysisResult;
        } finally {
            this.activeAnalyses.delete(operationId);
            this.completedAnalyses.set(operationId, analysisResult);
            
            // Clean up old completed analyses
            this.cleanupCompletedAnalyses();
        }
    }

    // 🚀 NEW: Webhook-first publishing strategy for ultra-fast trading
    async publishResultsWithWebhook(analysisResult) {
        const { operationId } = analysisResult;
        const publishStart = Date.now();
        
        try {
            // STEP 1: 🚀 SEND WEBHOOK FIRST (5-20ms) - Critical for trading speed
            let webhookSuccess = false;
            if (this.webhookConfig.enabled) {
                webhookSuccess = await this.sendWebhookAlert(analysisResult);
            }
            
            // STEP 2: 📱 SEND TELEGRAM (500-2000ms) - Backup/monitoring
            const telegramPromise = this.telegramPublisher.publishAnalysis(analysisResult);
            
            // Don't wait for Telegram if webhook succeeded and we want speed
            if (webhookSuccess && !this.webhookConfig.fallbackToTelegram) {
                // Fire and forget Telegram for monitoring
                telegramPromise.catch(error => {
                    logger.warn(`[${operationId}] Telegram backup failed:`, error.message);
                });
                
                const totalTime = Date.now() - publishStart;
                logger.info(`⚡ [${operationId}] Fast webhook-only publish completed in ${totalTime}ms`);
            } else {
                // Wait for Telegram as backup or primary
                try {
                    await telegramPromise;
                    const totalTime = Date.now() - publishStart;
                    logger.info(`📤 [${operationId}] Full publish completed in ${totalTime}ms`);
                } catch (telegramError) {
                    logger.error(`[${operationId}] Telegram publish failed:`, telegramError.message);
                    if (!webhookSuccess) {
                        throw new Error('Both webhook and Telegram publishing failed');
                    }
                }
            }
            
        } catch (error) {
            logger.error(`❌ [${operationId}] Publishing failed:`, error);
            throw error;
        }
    }

    // 🚀 NEW: Ultra-fast webhook alert sender
    async sendWebhookAlert(analysisResult) {
        if (!this.webhookConfig.enabled) {
            return false;
        }

        const { operationId, timer } = analysisResult;
        const webhookStart = Date.now();
        
        try {
            // Format alert for trading bot
            const alert = this.formatWebhookAlert(analysisResult);
            
            // Calculate processing time for trading bot decision making
            const processingTime = timer ? timer.getElapsedMs() : 0;
            
            // Enhanced alert with timing data
            const enhancedAlert = {
                ...alert,
                metadata: {
                    processingTime,
                    webhookSentAt: Date.now(),
                    analysisDuration: analysisResult.duration,
                    botType: this.botType,
                    priority: this.calculateAlertPriority(alert)
                }
            };
            
            // Send webhook with timeout and retry
            const response = await this.sendWebhookRequest(enhancedAlert, this.webhookConfig.retries);
            
            const webhookTime = Date.now() - webhookStart;
            
            // Update webhook statistics
            this.updateWebhookStats(webhookTime, true);
            
            logger.info(`⚡ [${operationId}] WEBHOOK SUCCESS: Trading bot notified in ${webhookTime}ms`);
            logger.info(`🎯 [${operationId}] Alert priority: ${enhancedAlert.metadata.priority} | Total processing: ${processingTime}ms`);
            
            return true;
            
        } catch (error) {
            const webhookTime = Date.now() - webhookStart;
            this.updateWebhookStats(webhookTime, false);
            
            logger.error(`❌ [${operationId}] WEBHOOK FAILED (${webhookTime}ms): ${error.message}`);
            
            // Log webhook failure but don't throw - let Telegram be the backup
            return false;
        }
    }

    // 🚀 NEW: Format alert optimized for trading bot consumption
    formatWebhookAlert(analysisResult) {
        const { tokenInfo, twitterMetrics, analyses, operationId, timer } = analysisResult;
        
        return {
            // Alert metadata
            source: 'scanner_bot',
            version: '1.0',
            timestamp: Date.now(),
            operationId,
            
            // Token data (essential for trading)
            token: {
                address: tokenInfo.address || tokenInfo.mint,
                symbol: tokenInfo.symbol,
                name: tokenInfo.name,
                eventType: tokenInfo.eventType || 'creation',
                creator: tokenInfo.creator
            },
            
            // Twitter engagement (critical for qualification)
            twitter: {
                likes: twitterMetrics.likes || 0,
                views: twitterMetrics.views || 0,
                url: twitterMetrics.link,
                publishedAt: twitterMetrics.publishedAt
            },
            
            // Analysis results (risk assessment)
            analysis: {
                // Bundle analysis
                bundleDetected: analyses.bundle?.result?.bundleDetected || false,
                bundlePercentage: analyses.bundle?.result?.percentageBundled || 0,
                bundleHoldingPercentage: analyses.bundle?.result?.totalHoldingAmountPercentage || 0,
                bundleCount: analyses.bundle?.result?.bundles?.length || 0,
                
                // Top holders analysis
                whaleCount: analyses.topHolders?.result?.summary?.whaleCount || 0,
                freshWalletCount: analyses.topHolders?.result?.summary?.freshWalletCount || 0,
                top5Concentration: parseFloat(analyses.topHolders?.result?.summary?.concentration?.top5Percentage) || 0,
                top10Concentration: parseFloat(analyses.topHolders?.result?.summary?.concentration?.top10Percentage) || 0,
                
                // Risk assessment
                riskLevel: this.calculateRiskLevel(analyses),
                riskScore: this.calculateRiskScore(analyses),
                confidence: this.calculateConfidence(twitterMetrics, analyses)
            },
            
            // Performance data
            performance: {
                analysisSuccess: analysisResult.success,
                analysisErrors: analysisResult.errors || [],
                successfulAnalyses: Object.values(analysisResult.analyses).filter(a => a.success).length,
                totalAnalyses: Object.keys(analysisResult.analyses).length
            }
        };
    }

    // 🚀 NEW: Send webhook request with retry logic
    async sendWebhookRequest(alert, retries = 1) {
        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            try {
                const response = await axios.post(this.webhookConfig.url, alert, {
                    timeout: this.webhookConfig.timeout,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': this.webhookConfig.apiKey,
                        'X-Source': 'scanner-bot',
                        'X-Version': '1.0'
                    },
                    // Aggressive timeouts for speed
                    validateStatus: (status) => status < 400
                });
                
                // Success on first try or retry
                if (attempt > 1) {
                    logger.info(`⚡ Webhook succeeded on attempt ${attempt}`);
                }
                
                return response;
                
            } catch (error) {
                if (attempt <= retries) {
                    logger.warn(`⚠️ Webhook attempt ${attempt} failed, retrying: ${error.message}`);
                    // Quick retry delay (100ms)
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    throw error;
                }
            }
        }
    }

    // 🚀 NEW: Calculate alert priority for trading bot
    calculateAlertPriority(alert) {
        let score = 0;
        
        // High engagement = high priority
        if (alert.twitter.likes >= 1000) score += 3;
        else if (alert.twitter.likes >= 500) score += 2;
        else if (alert.twitter.likes >= 200) score += 1;
        
        if (alert.twitter.views >= 1000000) score += 3;
        else if (alert.twitter.views >= 500000) score += 2;
        else if (alert.twitter.views >= 100000) score += 1;
        
        // Migration events get priority
        if (alert.token.eventType === 'migration') score += 2;
        
        // Risk penalties
        if (alert.analysis.bundleDetected) score -= 2;
        if (alert.analysis.whaleCount > 8) score -= 1;
        if (alert.analysis.freshWalletCount > 10) score -= 1;
        
        if (score >= 6) return 'CRITICAL';
        if (score >= 4) return 'HIGH';
        if (score >= 2) return 'MEDIUM';
        return 'LOW';
    }

    // 🚀 NEW: Update webhook performance statistics
    updateWebhookStats(latency, success) {
        this.webhookStats.alertsSent++;
        
        if (success) {
            this.webhookStats.alertsSuccessful++;
            this.webhookStats.totalLatency += latency;
            this.webhookStats.averageLatency = this.webhookStats.totalLatency / this.webhookStats.alertsSuccessful;
            this.webhookStats.fastestAlert = Math.min(this.webhookStats.fastestAlert, latency);
            this.webhookStats.slowestAlert = Math.max(this.webhookStats.slowestAlert, latency);
        } else {
            this.webhookStats.alertsFailed++;
        }
    }

    // Updated risk calculation methods
    calculateRiskLevel(analyses) {
        const bundleDetected = analyses.bundle?.result?.bundleDetected || false;
        const whaleCount = analyses.topHolders?.result?.summary?.whaleCount || 0;
        const freshWalletCount = analyses.topHolders?.result?.summary?.freshWalletCount || 0;
        const bundlePercentage = analyses.bundle?.result?.percentageBundled || 0;
        
        // High risk conditions
        if (bundleDetected && bundlePercentage > 30) return 'VERY_HIGH';
        if (whaleCount > 12 || freshWalletCount > 15) return 'VERY_HIGH';
        
        // Medium-high risk
        if (bundleDetected || whaleCount > 8 || freshWalletCount > 10) return 'HIGH';
        
        // Medium risk
        if (whaleCount > 5 || freshWalletCount > 5) return 'MEDIUM';
        
        return 'LOW';
    }

    calculateRiskScore(analyses) {
        let score = 100; // Start with perfect score
        
        // Bundle penalties
        if (analyses.bundle?.result?.bundleDetected) {
            const bundlePercentage = analyses.bundle.result.percentageBundled || 0;
            score -= Math.min(bundlePercentage * 2, 40); // Up to -40 for extreme bundling
        }
        
        // Whale penalties
        const whaleCount = analyses.topHolders?.result?.summary?.whaleCount || 0;
        if (whaleCount > 8) score -= (whaleCount - 8) * 5;
        
        // Fresh wallet penalties
        const freshWalletCount = analyses.topHolders?.result?.summary?.freshWalletCount || 0;
        if (freshWalletCount > 10) score -= (freshWalletCount - 10) * 3;
        
        // Concentration penalties
        const top5Concentration = parseFloat(analyses.topHolders?.result?.summary?.concentration?.top5Percentage) || 0;
        if (top5Concentration > 80) score -= (top5Concentration - 80) * 2;
        
        return Math.max(0, Math.min(100, score));
    }

    calculateConfidence(twitterMetrics, analyses) {
        let score = 0;
        
        // Twitter engagement scoring
        if (twitterMetrics.likes >= 1000) score += 3;
        else if (twitterMetrics.likes >= 500) score += 2;
        else if (twitterMetrics.likes >= 100) score += 1;
        
        if (twitterMetrics.views >= 1000000) score += 3;
        else if (twitterMetrics.views >= 500000) score += 2;
        else if (twitterMetrics.views >= 100000) score += 1;
        
        // Risk penalties
        if (analyses.bundle?.result?.bundleDetected) score -= 2;
        if ((analyses.topHolders?.result?.summary?.whaleCount || 0) > 8) score -= 1;
        if ((analyses.topHolders?.result?.summary?.freshWalletCount || 0) > 10) score -= 1;
        
        if (score >= 5) return 'HIGH';
        if (score >= 3) return 'MEDIUM';
        if (score >= 1) return 'LOW';
        return 'VERY_LOW';
    }

    // 🚀 NEW: Get webhook statistics
    getWebhookStats() {
        const successRate = this.webhookStats.alertsSent > 0 ? 
            (this.webhookStats.alertsSuccessful / this.webhookStats.alertsSent * 100).toFixed(1) : '0';
        
        return {
            ...this.webhookStats,
            successRate: successRate + '%',
            fastestAlert: this.webhookStats.fastestAlert === Infinity ? 0 : this.webhookStats.fastestAlert,
            config: {
                enabled: this.webhookConfig.enabled,
                url: this.webhookConfig.url,
                timeout: this.webhookConfig.timeout,
                retries: this.webhookConfig.retries
            }
        };
    }

    /**
     * Save analysis result to JSON log - only basics
     */
    async saveToJsonLog(analysisResult) {
        try {
            await this.jsonLogger.saveScanResult(analysisResult);
        } catch (error) {
            // Silent fail to avoid log spam
        }
    }

    /**
     * Get JSON logging statistics
     */
    async getJsonLogStats() {
        try {
            return await this.jsonLogger.getStats();
        } catch (error) {
            logger.error('Error getting JSON log stats:', error);
            return { totalFiles: 0, creationFiles: 0, migrationFiles: 0, files: [] };
        }
    }

    /**
     * Read scan results from JSON logs
     */
    async readScanResults(eventType, date = null) {
        try {
            return await this.jsonLogger.readScanResults(eventType, date);
        } catch (error) {
            logger.error('Error reading scan results:', error);
            return [];
        }
    }

    // Keep all your existing methods unchanged...
    getEnabledAnalyses() {
        return this.config.enabledAnalyses || [];
    }

    getConfig() {
        return {
            enabledAnalyses: this.config.enabledAnalyses,
            analysisTimeout: this.config.analysisTimeout,
            publishResults: this.config.publishResults,
            saveToJson: this.config.saveToJson,
            maxConcurrentAnalyses: this.config.maxConcurrentAnalyses || 3,
            botType: this.botType,
            webhook: this.webhookConfig
        };
    }

    async runAnalysisWithTimeout(analysisType, analysisFunction, operationId, cancellationToken) {
        const startTime = Date.now();
        logger.debug(`[${operationId}] Starting ${analysisType} analysis`);

        try {
            const timeoutPromise = new Promise((_, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`${analysisType} analysis timed out`));
                }, this.config.analysisTimeout);

                cancellationToken.onCancel(() => {
                    clearTimeout(timeoutId);
                    reject(new Error(`${analysisType} analysis cancelled`));
                });
            });

            const result = await Promise.race([
                analysisFunction(),
                timeoutPromise
            ]);

            const duration = Date.now() - startTime;
            logger.debug(`[${operationId}] ${analysisType} analysis completed in ${duration}ms`);

            return {
                type: analysisType,
                success: true,
                result,
                duration,
                error: null
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.warn(`[${operationId}] ${analysisType} analysis failed after ${duration}ms:`, error.message);

            return {
                type: analysisType,
                success: false,
                result: null,
                duration,
                error: error.message
            };
        }
    }

    generateComprehensiveSummary(analysisResult) {
        const bundleAnalysis = analysisResult.analyses.bundle;
        const topHoldersAnalysis = analysisResult.analyses.topHolders;
        
        const summary = {
            totalAnalyses: Object.keys(analysisResult.analyses).length,
            successfulAnalyses: Object.values(analysisResult.analyses).filter(a => a.success).length,
            failedAnalyses: Object.values(analysisResult.analyses).filter(a => !a.success).length,
            flags: [],
            scores: {},
            alerts: [],
            analysisError: false
        };

        if (summary.successfulAnalyses === 0) {
            summary.analysisError = true;
            summary.flags.push('⚠️ Analysis failed - Token too new for indexing');
            summary.riskLevel = 'UNKNOWN';
            summary.overallScore = 0;
            analysisResult.summary = summary;
            return;
        }

        // Process Bundle Analysis Results
        if (bundleAnalysis?.success && bundleAnalysis.result) {
            const bundleResult = bundleAnalysis.result;
            
            if (bundleResult.bundleDetected) {
                summary.flags.push(`🔴 Bundle detected: ${bundleResult.percentageBundled?.toFixed(2)}% of supply`);
                summary.alerts.push({
                    type: 'bundle',
                    severity: 'high',
                    message: `Bundle activity detected (${bundleResult.percentageBundled?.toFixed(2)}%)`
                });
            }
            
            summary.scores.bundle = bundleResult.bundleDetected ? 20 : 100;
            summary.bundleData = {
                detected: bundleResult.bundleDetected,
                percentage: bundleResult.percentageBundled,
                holdingPercentage: bundleResult.totalHoldingAmountPercentage,
                bundleCount: bundleResult.bundles?.length || 0
            };
        } else if (bundleAnalysis && !bundleAnalysis.success) {
            summary.flags.push('⚠️ Bundle analysis failed');
        }

        // Process Top Holders Analysis Results
        if (topHoldersAnalysis?.success && topHoldersAnalysis.result && topHoldersAnalysis.result.summary) {
            const holdersResult = topHoldersAnalysis.result;
            const holdersSummary = holdersResult.summary;
            
            if (holdersSummary.whaleCount > 8) {
                summary.flags.push(`🔴 High whale concentration: ${holdersSummary.whaleCount}/20 holders`);
                summary.alerts.push({
                    type: 'whales',
                    severity: 'high',
                    message: `High whale concentration (${holdersSummary.whaleCount}/20)`
                });
            } else if (holdersSummary.whaleCount > 5) {
                summary.flags.push(`🟡 Moderate whale presence: ${holdersSummary.whaleCount}/20 holders`);
            }

            if (holdersSummary.freshWalletCount > 10) {
                summary.flags.push(`🔴 High fresh wallet count: ${holdersSummary.freshWalletCount}/20 holders`);
                summary.alerts.push({
                    type: 'fresh_wallets',
                    severity: 'high',
                    message: `High fresh wallet count (${holdersSummary.freshWalletCount}/20)`
                });
            } else if (holdersSummary.freshWalletCount > 5) {
                summary.flags.push(`🟡 Moderate fresh wallet count: ${holdersSummary.freshWalletCount}/20 holders`);
            }

            const top5Concentration = parseFloat(holdersSummary.concentration.top5Percentage);
            if (top5Concentration > 80) {
                summary.flags.push(`🔴 Very high concentration: Top 5 hold ${top5Concentration.toFixed(1)}%`);
                summary.alerts.push({
                    type: 'concentration',
                    severity: 'high',
                    message: `Very high concentration (${top5Concentration.toFixed(1)}%)`
                });
            } else if (top5Concentration > 60) {
                summary.flags.push(`🟡 High concentration: Top 5 hold ${top5Concentration.toFixed(1)}%`);
            }

            summary.scores.topHolders = holdersSummary.riskScore;
            summary.holdersData = {
                whaleCount: holdersSummary.whaleCount,
                freshWalletCount: holdersSummary.freshWalletCount,
                regularWalletCount: holdersSummary.regularWalletCount,
                concentration: holdersSummary.concentration,
                riskLevel: holdersSummary.riskLevel
            };
        } else if (topHoldersAnalysis && !topHoldersAnalysis.success) {
            summary.flags.push('⚠️ Top holders analysis failed');
        }

        // Calculate overall score and risk level
        const scores = Object.values(summary.scores).filter(score => typeof score === 'number');
        summary.overallScore = scores.length > 0 ? 
            Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
        
        summary.riskLevel = this.determineOverallRiskLevel(summary.overallScore, summary.alerts);

        if (summary.flags.length === 0 && summary.successfulAnalyses > 0) {
            summary.flags.push('✅ No major red flags detected');
        }

        analysisResult.summary = summary;
    }

    determineOverallRiskLevel(score, alerts) {
        const highSeverityAlerts = alerts.filter(alert => alert.severity === 'high').length;
        
        if (highSeverityAlerts >= 2 || score < 40) return 'VERY_HIGH';
        if (highSeverityAlerts >= 1 || score < 60) return 'HIGH';
        if (score < 80) return 'MEDIUM';
        return 'LOW';
    }

    async publishResults(analysisResult) {
        try {
            logger.info(`📤 [${analysisResult.operationId}] Publishing comprehensive analysis results`);
            await this.telegramPublisher.publishAnalysis(analysisResult);
        } catch (error) {
            logger.error(`Failed to publish results for ${analysisResult.operationId}:`, error);
        }
    }

    createCancellationToken(timeout) {
        const token = {
            cancelled: false,
            callbacks: []
        };

        token.cancel = () => {
            token.cancelled = true;
            token.callbacks.forEach(callback => callback());
        };

        token.isCancelled = () => token.cancelled;

        token.onCancel = (callback) => {
            if (token.cancelled) {
                callback();
            } else {
                token.callbacks.push(callback);
            }
        };

        setTimeout(() => {
            if (!token.cancelled) {
                logger.warn(`Analysis timed out after ${timeout}ms`);
                token.cancel();
            }
        }, timeout);

        return token;
    }

    cleanupCompletedAnalyses() {
        if (this.completedAnalyses.size > 100) {
            const entries = Array.from(this.completedAnalyses.entries());
            const toDelete = entries.slice(0, entries.length - 100);
            
            toDelete.forEach(([operationId]) => {
                this.completedAnalyses.delete(operationId);
            });

            logger.debug(`Cleaned up ${toDelete.length} old analysis results`);
        }
    }

    getStatus() {
        return {
            botType: this.botType,
            activeAnalyses: this.activeAnalyses.size,
            completedAnalyses: this.completedAnalyses.size,
            enabledAnalyses: this.config.enabledAnalyses,
            jsonLogging: this.config.saveToJson,
            webhook: this.getWebhookStats(),
            config: {
                analysisTimeout: this.config.analysisTimeout,
                publishResults: this.config.publishResults,
                maxConcurrentAnalyses: this.config.maxConcurrentAnalyses
            }
        };
    }

    getAnalysisResult(operationId) {
        return this.completedAnalyses.get(operationId);
    }

    cancelAnalysis(operationId) {
        const cancellationToken = this.activeAnalyses.get(operationId);
        if (cancellationToken) {
            cancellationToken.cancel();
            logger.info(`Cancelled analysis ${operationId}`);
            return true;
        }
        return false;
    }
}

module.exports = AnalysisOrchestrator;