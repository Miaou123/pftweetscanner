// src/validators/socialUrlExtractor.js - Detects and extracts social media URLs
const axios = require('axios');
const logger = require('../utils/logger');

class SocialUrlExtractor {
    constructor() {
        this.supportedPlatforms = ['tiktok', 'twitter'];
    }

    /**
     * Main method: Extract social URL and determine platform
     * @param {Object} tokenEvent - Token metadata
     * @returns {Object|null} - { url, platform } or null
     */
    async extractSocialUrl(tokenEvent) {
        // Priority order: TikTok first (viral potential), then Twitter
        for (const platform of ['tiktok', 'twitter']) {
            const url = await this.extractUrlForPlatform(tokenEvent, platform);
            if (url) {
                logger.info(`🔍 ${platform.toUpperCase()} URL detected: ${url}`);
                return { url, platform };
            }
        }

        logger.debug('No supported social URLs found in token metadata');
        return null;
    }

    /**
     * Extract URL for specific platform
     * @param {Object} tokenEvent - Token metadata
     * @param {string} platform - 'tiktok' or 'twitter'
     * @returns {string|null} - URL or null
     */
    async extractUrlForPlatform(tokenEvent, platform) {
        // Check direct fields first
        const url = this.findUrlInDirectFields(tokenEvent, platform);
        if (url) return url;

        // Check metadata URI if available
        if (tokenEvent.uri || tokenEvent.metadata_uri) {
            return await this.extractFromMetadataUri(tokenEvent.uri || tokenEvent.metadata_uri, platform);
        }

        return null;
    }

    /**
     * Search for URLs in direct token fields
     * @param {Object} tokenEvent - Token metadata
     * @param {string} platform - Platform to search for
     * @returns {string|null} - URL or null
     */
    findUrlInDirectFields(tokenEvent, platform) {
        const fieldsToCheck = this.getFieldsForPlatform(platform);
        
        for (const field of fieldsToCheck) {
            if (tokenEvent[field]) {
                const url = this.findUrlInText(tokenEvent[field], platform);
                if (url) return url;
            }
        }
        
        return null;
    }

    /**
     * Get relevant fields to check for each platform
     * @param {string} platform - Platform name
     * @returns {Array} - Field names to check
     */
    getFieldsForPlatform(platform) {
        const commonFields = ['website', 'social', 'socials', 'links', 'external_url', 'description'];
        
        switch (platform) {
            case 'tiktok':
                return ['tiktok', 'website', ...commonFields]; // Website is common for TikTok
            case 'twitter':
                return ['twitter', ...commonFields];
            default:
                return commonFields;
        }
    }

    /**
     * Find URL patterns in text for specific platform
     * @param {string} text - Text to search in
     * @param {string} platform - Platform to search for
     * @returns {string|null} - URL or null
     */
    findUrlInText(text, platform) {
        if (!text || typeof text !== 'string') return null;
        
        const patterns = this.getPlatformPatterns(platform);
        
        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                const url = matches[0];
                logger.debug(`Found ${platform} URL: ${url}`);
                return url;
            }
        }
        
        return null;
    }

    /**
     * Get regex patterns for each platform
     * @param {string} platform - Platform name
     * @returns {Array} - Array of regex patterns
     */
    getPlatformPatterns(platform) {
        switch (platform) {
            case 'tiktok':
                return [
                    // Standard TikTok video URLs
                    /https?:\/\/(www\.)?(tiktok\.com)\/@[a-zA-Z0-9._-]+\/video\/\d+/gi,
                    // TikTok discover pages (hashtags, trends)
                    /https?:\/\/(www\.)?(tiktok\.com)\/discover\/[a-zA-Z0-9._-]+/gi,
                    // TikTok user profiles
                    /https?:\/\/(www\.)?(tiktok\.com)\/@[a-zA-Z0-9._-]+/gi,
                    // TikTok sound/music pages
                    /https?:\/\/(www\.)?(tiktok\.com)\/music\/[a-zA-Z0-9._-]+/gi,
                    // Mobile TikTok URLs (vm.tiktok.com)
                    /https?:\/\/(vm\.)?(tiktok\.com)\/[a-zA-Z0-9]+/gi
                ];

            case 'twitter':
                return [
                    // Twitter status URLs
                    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
                    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/statuses\/\d+/gi
                ];

            default:
                return [];
        }
    }

    /**
     * Extract URL from metadata URI (IPFS, Arweave, etc.)
     * @param {string} uri - Metadata URI
     * @param {string} platform - Platform to search for
     * @returns {string|null} - URL or null
     */
    async extractFromMetadataUri(uri, platform) {
        try {
            let fetchUrl = uri;
            if (uri.startsWith('ipfs://')) {
                fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (uri.startsWith('ar://')) {
                fetchUrl = uri.replace('ar://', 'https://arweave.net/');
            }
            
            const response = await axios.get(fetchUrl, { 
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TokenScanner/1.0)' }
            });
            
            if (response.data) {
                return this.findUrlInMetadata(response.data, platform);
            }
            return null;
            
        } catch (error) {
            logger.debug(`Failed to fetch metadata from ${uri}: ${error.message}`);
            return null;
        }
    }

    /**
     * Find URL in metadata object
     * @param {Object} metadata - Parsed metadata
     * @param {string} platform - Platform to search for
     * @returns {string|null} - URL or null
     */
    findUrlInMetadata(metadata, platform) {
        const patterns = this.getPlatformPatterns(platform);
        const fieldsToCheck = this.getFieldsForPlatform(platform);
        
        // Check specific fields first
        for (const field of fieldsToCheck) {
            if (metadata[field]) {
                const fieldStr = JSON.stringify(metadata[field]);
                for (const pattern of patterns) {
                    const matches = fieldStr.match(pattern);
                    if (matches) return matches[0];
                }
            }
        }
        
        // Check entire metadata as fallback
        const metadataStr = JSON.stringify(metadata);
        for (const pattern of patterns) {
            const matches = metadataStr.match(pattern);
            if (matches) return matches[0];
        }
        
        return null;
    }

    /**
     * Validate URL format for platform
     * @param {string} url - URL to validate
     * @param {string} platform - Expected platform
     * @returns {boolean} - Is valid URL for platform
     */
    isValidUrlForPlatform(url, platform) {
        if (!url || typeof url !== 'string') return false;
        
        const patterns = this.getPlatformPatterns(platform);
        return patterns.some(pattern => pattern.test(url));
    }

    /**
     * Extract platform from URL
     * @param {string} url - URL to analyze
     * @returns {string|null} - Platform name or null
     */
    detectPlatformFromUrl(url) {
        if (!url || typeof url !== 'string') return null;
        
        for (const platform of this.supportedPlatforms) {
            if (this.isValidUrlForPlatform(url, platform)) {
                return platform;
            }
        }
        
        return null;
    }

    /**
     * Get supported platforms
     * @returns {Array} - List of supported platform names
     */
    getSupportedPlatforms() {
        return [...this.supportedPlatforms];
    }
}

module.exports = SocialUrlExtractor;