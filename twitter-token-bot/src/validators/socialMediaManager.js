// src/validators/socialMediaManager.js - Orchestrates all social media validators
const SocialUrlExtractor = require('./socialUrlExtractor');
const TwitterValidator = require('./twitterValidator');
const TikTokValidator = require('./tiktokValidator');
const logger = require('../utils/logger');

class SocialMediaManager {
    constructor(config = {}) {
        this.config = {
            enableViewCountExtraction: config.enableViewCountExtraction !== false,
            viewCountTimeout: config.viewCountTimeout || 15000,
            quickTimeout: config.quickTimeout || 5000,
            ...config
        };

        // Initialize components
        this.urlExtractor = new SocialUrlExtractor();
        this.twitterValidator = new TwitterValidator({
            enablePageExtraction: this.config.enableViewCountExtraction,
            timeout: this.config.viewCountTimeout,
            quickTimeout: this.config.quickTimeout
        });
        this.tiktokValidator = new TikTokValidator(this.config);

        logger.info('🌐 SocialMediaManager initialized with Twitter and TikTok support');
    }

    /**
     * Main method: Extract social URL and validate engagement
     * @param {Object} tokenEvent - Token metadata
     * @returns {Object|null} - { url, platform, metrics, autoQualified } or null
     */
    async extractAndValidate(tokenEvent) {
        try {
            // Step 1: Extract social URL and determine platform
            const urlResult = await this.urlExtractor.extractSocialUrl(tokenEvent);
            
            if (!urlResult) {
                logger.debug('No social media URLs found in token metadata');
                return null;
            }

            const { url, platform } = urlResult;
            
            // Step 2: Validate engagement based on platform
            const metrics = await this.validateEngagementForPlatform(url, platform);
            
            if (!metrics) {
                logger.warn(`Failed to validate engagement for ${platform} URL: ${url}`);
                return null;
            }

            return {
                url,
                platform,
                metrics,
                autoQualified: metrics.autoQualified || false
            };

        } catch (error) {
            logger.error('Error in social media extraction and validation:', error);
            return null;
        }
    }

    /**
     * Quick engagement check (for initial filtering)
     * @param {Object} tokenEvent - Token metadata
     * @returns {Object|null} - Quick validation result or null
     */
    async quickEngagementCheck(tokenEvent) {
        try {
            // Step 1: Extract URL
            const urlResult = await this.urlExtractor.extractSocialUrl(tokenEvent);
            
            if (!urlResult) {
                return null;
            }

            const { url, platform } = urlResult;
            
            // Step 2: Quick validation
            const validator = this.getValidatorForPlatform(platform);
            if (!validator) {
                logger.warn(`No validator available for platform: ${platform}`);
                return null;
            }

            const metrics = await validator.quickEngagementCheck(url);
            
            if (metrics) {
                return {
                    url,
                    platform,
                    metrics,
                    autoQualified: metrics.autoQualified || false
                };
            }

            return null;

        } catch (error) {
            logger.error('Error in quick engagement check:', error);
            return null;
        }
    }

    /**
     * Full engagement validation for specific platform
     * @param {string} url - Social media URL
     * @param {string} platform - Platform name
     * @returns {Object|null} - Engagement metrics or null
     */
    async validateEngagementForPlatform(url, platform) {
        const validator = this.getValidatorForPlatform(platform);
        
        if (!validator) {
            logger.warn(`No validator available for platform: ${platform}`);
            return null;
        }

        try {
            return await validator.validateEngagement(url);
        } catch (error) {
            logger.error(`Error validating ${platform} engagement:`, error);
            return null;
        }
    }

    /**
     * Get validator instance for platform
     * @param {string} platform - Platform name
     * @returns {Object|null} - Validator instance or null
     */
    getValidatorForPlatform(platform) {
        switch (platform) {
            case 'twitter':
                return this.twitterValidator;
            case 'tiktok':
                return this.tiktokValidator;
            default:
                return null;
        }
    }

    /**
     * Check if platform supports auto-qualification
     * @param {string} platform - Platform name
     * @returns {boolean} - Supports auto-qualification
     */
    supportsAutoQualification(platform) {
        switch (platform) {
            case 'tiktok':
                return true;
            case 'twitter':
                return false;
            default:
                return false;
        }
    }

    /**
     * Get list of supported platforms
     * @returns {Array} - Array of platform names
     */
    getSupportedPlatforms() {
        return this.urlExtractor.getSupportedPlatforms();
    }

    /**
     * Validate URL format for any supported platform
     * @param {string} url - URL to validate
     * @returns {string|null} - Detected platform or null
     */
    detectPlatform(url) {
        return this.urlExtractor.detectPlatformFromUrl(url);
    }

    /**
     * Get comprehensive stats from all validators
     * @returns {Object} - Combined statistics
     */
    getStats() {
        return {
            supportedPlatforms: this.getSupportedPlatforms(),
            twitter: this.twitterValidator.getConfig(),
            tiktok: this.tiktokValidator.getStats(),
            config: {
                enableViewCountExtraction: this.config.enableViewCountExtraction,
                viewCountTimeout: this.config.viewCountTimeout,
                quickTimeout: this.config.quickTimeout
            }
        };
    }

    /**
     * Get status for monitoring
     * @returns {Object} - Status information
     */
    getStatus() {
        return {
            initialized: true,
            supportedPlatforms: this.getSupportedPlatforms(),
            autoQualificationPlatforms: ['tiktok'],
            engagementCheckPlatforms: ['twitter'],
            viewExtractionEnabled: this.config.enableViewCountExtraction
        };
    }

    /**
     * Test social media detection and validation
     * @param {Object} tokenEvent - Token metadata
     * @returns {Object} - Test results
     */
    async testSocialMediaDetection(tokenEvent) {
        const results = {
            urlExtraction: null,
            platformDetection: null,
            validationResults: {},
            errors: []
        };

        try {
            // Test URL extraction
            const urlResult = await this.urlExtractor.extractSocialUrl(tokenEvent);
            results.urlExtraction = urlResult;

            if (urlResult) {
                const { url, platform } = urlResult;
                results.platformDetection = platform;

                // Test validation for detected platform
                try {
                    const metrics = await this.validateEngagementForPlatform(url, platform);
                    results.validationResults[platform] = {
                        success: !!metrics,
                        metrics: metrics,
                        autoQualified: metrics?.autoQualified || false
                    };
                } catch (error) {
                    results.validationResults[platform] = {
                        success: false,
                        error: error.message
                    };
                    results.errors.push(`${platform} validation error: ${error.message}`);
                }
            }

        } catch (error) {
            results.errors.push(`URL extraction error: ${error.message}`);
        }

        return results;
    }

    /**
     * Clean up all validators
     */
    async cleanup() {
        logger.info('🧹 Cleaning up SocialMediaManager...');
        
        try {
            await Promise.all([
                this.twitterValidator.cleanup(),
                this.tiktokValidator.cleanup()
            ]);
            
            logger.info('✅ SocialMediaManager cleanup completed');
        } catch (error) {
            logger.error('❌ Error during SocialMediaManager cleanup:', error);
        }
    }
}

module.exports = SocialMediaManager;