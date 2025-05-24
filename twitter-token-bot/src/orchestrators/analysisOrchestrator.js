// src/orchestrators/analysisOrchestrator.js
const logger = require('../utils/logger');
const BundleAnalyzer = require('../analysis/bundleAnalyzer');
const TelegramPublisher = require('../publishers/telegramPublisher');

class AnalysisOrchestrator {
    constructor(config = {}) {
        this.config = {
            analysisTimeout: config.analysisTimeout || 5 * 60 * 1000, // 5 minutes
            enabledAnalyses: ['bundle'], // Only bundle analysis
            publishResults: config.publishResults !== false,
            ...config
        };

        this.bundleAnalyzer = BundleAnalyzer;
        this.telegramPublisher = new TelegramPublisher(config.telegram || {});
        
        // Analysis state
        this.activeAnalyses = new Map();
        this.completedAnalyses = new Map();
    }

    async analyzeToken(tokenData) {
        const { tokenAddress, tokenInfo, twitterMetrics, operationId } = tokenData;
        
        logger.info(`🔬 [${operationId}] Starting bundle analysis for ${tokenInfo.symbol} (${tokenAddress})`);
        
        const analysisResult = {
            tokenAddress,
            tokenInfo,
            twitterMetrics,
            operationId,
            startTime: Date.now(),
            success: false,
            analyses: {},
            errors: [],
            summary: {}
        };

        // Create cancellation token for timeout handling
        const cancellationToken = this.createCancellationToken(this.config.analysisTimeout);
        this.activeAnalyses.set(operationId, cancellationToken);

        try {
            // Run bundle analysis only
            const bundleAnalysis = await this.runAnalysisWithTimeout(
                'bundle',
                () => this.bundleAnalyzer.analyzeBundle(tokenAddress, 50000),
                operationId,
                cancellationToken
            );

            // Process results
            analysisResult.analyses.bundle = bundleAnalysis;
            
            if (!bundleAnalysis.success) {
                analysisResult.errors.push(`bundle: ${bundleAnalysis.error}`);
            }
            
            // Generate summary
            this.generateAnalysisSummary(analysisResult);
            
            // Determine if analysis was successful
            analysisResult.success = bundleAnalysis.success;
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;

            if (analysisResult.success) {
                logger.info(`✅ [${operationId}] Bundle analysis completed successfully in ${analysisResult.duration}ms`);
                
                // Publish results if enabled
                if (this.config.publishResults) {
                    await this.publishResults(analysisResult);
                }
            } else {
                logger.warn(`⚠️ [${operationId}] Bundle analysis failed`);
            }

            return analysisResult;

        } catch (error) {
            logger.error(`❌ [${operationId}] Analysis failed:`, error);
            analysisResult.error = error.message;
            analysisResult.endTime = Date.now();
            analysisResult.duration = analysisResult.endTime - analysisResult.startTime;
            
            return analysisResult;
        } finally {
            this.activeAnalyses.delete(operationId);
            this.completedAnalyses.set(operationId, analysisResult);
            
            // Clean up old completed analyses
            this.cleanupCompletedAnalyses();
        }
    }

    async runAnalysisWithTimeout(analysisType, analysisFunction, operationId, cancellationToken) {
        const startTime = Date.now();
        logger.debug(`[${operationId}] Starting ${analysisType} analysis`);

        try {
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`${analysisType} analysis timed out`));
                }, this.config.analysisTimeout);

                // Clear timeout if cancellation token is triggered
                cancellationToken.onCancel(() => {
                    clearTimeout(timeoutId);
                    reject(new Error(`${analysisType} analysis cancelled`));
                });
            });

            // Race between analysis and timeout
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

    generateAnalysisSummary(analysisResult) {
        const bundleAnalysis = analysisResult.analyses.bundle;
        
        const summary = {
            totalAnalyses: 1,
            successfulAnalyses: bundleAnalysis.success ? 1 : 0,
            failedAnalyses: bundleAnalysis.success ? 0 : 1,
            flags: [],
            scores: {}
        };

        // Add bundle-specific flags and scores
        if (bundleAnalysis.success && bundleAnalysis.result) {
            const result = bundleAnalysis.result;
            
            // Add flags
            if (result.bundleDetected) {
                summary.flags.push(`🔴 Bundle detected: ${result.percentageBundled?.toFixed(2)}% of supply`);
            }
            
            // Calculate score
            summary.scores.bundle = result.bundleDetected ? 0 : 100;
            summary.overallScore = summary.scores.bundle;
            summary.riskLevel = this.determineRiskLevel(summary.overallScore);
        } else {
            summary.overallScore = 0;
            summary.riskLevel = 'UNKNOWN';
        }

        analysisResult.summary = summary;
    }

    determineRiskLevel(score) {
        if (score >= 80) return 'LOW';
        if (score >= 60) return 'MEDIUM';
        if (score >= 40) return 'HIGH';
        return 'VERY_HIGH';
    }

    async publishResults(analysisResult) {
        try {
            logger.info(`📤 [${analysisResult.operationId}] Publishing bundle analysis results`);
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

        // Auto-cancel after timeout
        setTimeout(() => {
            if (!token.cancelled) {
                logger.warn(`Analysis timed out after ${timeout}ms`);
                token.cancel();
            }
        }, timeout);

        return token;
    }

    cleanupCompletedAnalyses() {
        // Keep only last 100 completed analyses
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
            activeAnalyses: this.activeAnalyses.size,
            completedAnalyses: this.completedAnalyses.size,
            enabledAnalyses: this.config.enabledAnalyses,
            config: {
                analysisTimeout: this.config.analysisTimeout,
                publishResults: this.config.publishResults
            }
        };
    }

    // Get analysis result by operation ID
    getAnalysisResult(operationId) {
        return this.completedAnalyses.get(operationId);
    }

    // Cancel active analysis
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