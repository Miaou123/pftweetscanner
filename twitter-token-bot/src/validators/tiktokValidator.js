// src/validators/tiktokValidator.js - TikTok-specific validator
const logger = require('../utils/logger');

class TikTokValidator {
    constructor(config = {}) {
        this.config = {
            autoQualificationLikes: config.autoQualificationLikes || 999999,
            autoQualificationViews: config.autoQualificationViews || 10000000,
            ...config
        };
    }

    /**
     * Quick engagement check for TikTok (auto-qualification)
     * @param {string} tiktokUrl - TikTok URL
     * @returns {Object} - Auto-qualified metrics
     */
    async quickEngagementCheck(tiktokUrl) {
        logger.info(`🎵 TikTok URL detected - auto-qualifying: ${tiktokUrl}`);
        
        return this.createAutoQualifiedMetrics(tiktokUrl);
    }

    /**
     * Validate TikTok engagement (auto-qualification for now)
     * @param {string} tiktokUrl - TikTok URL
     * @returns {Object} - Auto-qualified metrics
     */
    async validateEngagement(tiktokUrl) {
        logger.info(`🎵 TikTok validation - auto-qualifying: ${tiktokUrl}`);
        
        return this.createAutoQualifiedMetrics(tiktokUrl);
    }

    /**
     * Create auto-qualified metrics for TikTok
     * @param {string} tiktokUrl - TikTok URL
     * @returns {Object} - Metrics object
     */
    createAutoQualifiedMetrics(tiktokUrl) {
        const urlType = this.classifyTikTokUrl(tiktokUrl);
        
        return {
            link: tiktokUrl,
            platform: 'tiktok',
            likes: this.config.autoQualificationLikes,
            views: this.config.autoQualificationViews,
            shares: 0, // TikTok uses shares instead of retweets
            comments: 0, // TikTok uses comments instead of replies
            retweets: 0, // Keep for compatibility
            replies: 0,  // Keep for compatibility
            publishedAt: null, // We don't extract this yet
            autoQualified: true,
            urlType: urlType,
            qualificationReason: `TikTok ${urlType} detected - auto-qualified for viral potential`
        };
    }

    /**
     * Classify TikTok URL type for better insights
     * @param {string} url - TikTok URL
     * @returns {string} - URL type classification
     */
    classifyTikTokUrl(url) {
        if (!url) return 'unknown';
        
        // TikTok video URL
        if (url.includes('/video/')) {
            return 'video';
        }
        
        // TikTok discover page (hashtags, trends)
        if (url.includes('/discover/')) {
            return 'discover';
        }
        
        // TikTok user profile
        if (url.includes('/@') && !url.includes('/video/')) {
            return 'profile';
        }
        
        // TikTok music/sound page
        if (url.includes('/music/')) {
            return 'music';
        }
        
        // Mobile short URL
        if (url.includes('vm.tiktok.com')) {
            return 'mobile_short';
        }
        
        return 'other';
    }

    /**
     * Extract TikTok video ID from URL (for future viral analysis)
     * @param {string} url - TikTok URL
     * @returns {string|null} - Video ID or null
     */
    extractVideoId(url) {
        if (!url) return null;
        
        const videoMatch = url.match(/\/video\/(\d+)/);
        if (videoMatch) {
            return videoMatch[1];
        }
        
        return null;
    }

    /**
     * Extract TikTok username from URL
     * @param {string} url - TikTok URL
     * @returns {string|null} - Username or null
     */
    extractUsername(url) {
        if (!url) return null;
        
        const usernameMatch = url.match(/@([a-zA-Z0-9._-]+)/);
        if (usernameMatch) {
            return usernameMatch[1];
        }
        
        return null;
    }

    /**
     * Extract hashtag from discover URL
     * @param {string} url - TikTok discover URL
     * @returns {string|null} - Hashtag or null
     */
    extractHashtag(url) {
        if (!url || !url.includes('/discover/')) return null;
        
        const hashtagMatch = url.match(/\/discover\/([a-zA-Z0-9._-]+)/);
        if (hashtagMatch) {
            return hashtagMatch[1];
        }
        
        return null;
    }

    /**
     * Get detailed analysis of TikTok URL
     * @param {string} url - TikTok URL
     * @returns {Object} - Detailed analysis
     */
    analyzeTikTokUrl(url) {
        const urlType = this.classifyTikTokUrl(url);
        const analysis = {
            url,
            type: urlType,
            platform: 'tiktok'
        };

        switch (urlType) {
            case 'video':
                analysis.videoId = this.extractVideoId(url);
                analysis.username = this.extractUsername(url);
                analysis.viralPotential = 'high'; // Individual videos can go viral quickly
                break;
                
            case 'discover':
                analysis.hashtag = this.extractHashtag(url);
                analysis.viralPotential = 'very_high'; // Trending hashtags are already viral
                break;
                
            case 'profile':
                analysis.username = this.extractUsername(url);
                analysis.viralPotential = 'medium'; // Profile links are less viral but indicate creator backing
                break;
                
            case 'music':
                analysis.viralPotential = 'high'; // Trending sounds can explode
                break;
                
            default:
                analysis.viralPotential = 'medium';
        }

        return analysis;
    }

    /**
     * Validate if URL is a TikTok URL
     * @param {string} url - URL to validate
     * @returns {boolean} - Is valid TikTok URL
     */
    isValidTikTokUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const patterns = [
            /https?:\/\/(www\.)?(tiktok\.com)\/@[a-zA-Z0-9._-]+\/video\/\d+/i,
            /https?:\/\/(www\.)?(tiktok\.com)\/discover\/[a-zA-Z0-9._-]+/i,
            /https?:\/\/(www\.)?(tiktok\.com)\/@[a-zA-Z0-9._-]+/i,
            /https?:\/\/(www\.)?(tiktok\.com)\/music\/[a-zA-Z0-9._-]+/i,
            /https?:\/\/(vm\.)?(tiktok\.com)\/[a-zA-Z0-9]+/i
        ];

        return patterns.some(pattern => pattern.test(url));
    }

    /**
     * Future method: Check if TikTok content is viral
     * @param {string} url - TikTok URL
     * @returns {Promise<Object>} - Viral analysis (placeholder for now)
     */
    async checkViralStatus(url) {
        // TODO: Implement viral checking logic
        // This could involve:
        // - Scraping view counts if possible
        // - Checking trending hashtags
        // - Analyzing engagement patterns
        // - Using TikTok API if available
        
        logger.info(`🎵 Viral status check for ${url} - feature coming soon`);
        
        const analysis = this.analyzeTikTokUrl(url);
        
        return {
            url,
            isViral: true, // For now, assume all TikTok links have viral potential
            viralScore: 85, // Placeholder score
            analysis,
            reason: 'TikTok content auto-qualified (viral detection coming soon)',
            lastChecked: new Date().toISOString()
        };
    }

    /**
     * Get statistics about TikTok processing
     * @returns {Object} - Processing statistics
     */
    getStats() {
        return {
            platform: 'tiktok',
            autoQualificationEnabled: true,
            viralDetectionEnabled: false, // Coming soon
            autoQualificationLikes: this.config.autoQualificationLikes,
            autoQualificationViews: this.config.autoQualificationViews
        };
    }

    /**
     * Get configuration
     * @returns {Object} - Current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Clean up resources (nothing to clean for TikTok validator currently)
     */
    async cleanup() {
        // No browser or external resources to clean up
        logger.debug('🎵 TikTok validator cleanup completed');
    }
}

module.exports = TikTokValidator;