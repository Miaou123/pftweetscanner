// Updated AnalysisOrchestrator with JSON logging integration
const path = require('path');
const logger = require('../utils/logger');
const BundleAnalyzer = require('../analysis/bundleAnalyzer');
const TopHoldersAnalyzer = require('../analysis/topHoldersAnalyzer');
const TelegramPublisher = require('../publishers/telegramPublisher');
const JsonLogger = require('../services/jsonLogger');
const analysisConfig = require('../config/analysisConfig');

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

        // Get bot-specific enabled analyses from your analysis config
        const botSpecificConfig = analysisConfig.getConfigForBot(this.botType);
        this.config.enabledAnalyses = botSpecificConfig.enabledAnalyses;
        this.config.maxConcurrentAnalyses = botSpecificConfig.maxConcurrent;

        logger.info(`🔬 AnalysisOrchestrator initialized for ${this.botType} bot`);
        logger.info(`📋 Enabled analyses: ${this.config.enabledAnalyses.join(', ')}`);

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

            // Publish results to Telegram
            if (this.config.publishResults) {
                await this.publishResults(analysisResult);
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
            botType: this.botType
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