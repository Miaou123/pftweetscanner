// Enhanced TwitterValidator with quick likes check and puppeteer view extraction
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const logger = require('../utils/logger');
const { retryWithBackoff } = require('../utils/retryUtils');

puppeteer.use(StealthPlugin());

class TwitterValidator {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 15000,
            maxRetries: config.maxRetries || 3,
            quickTimeout: config.quickTimeout || 5000, // Fast timeout for likes check
            enablePageExtraction: config.enablePageExtraction !== false, // Enable by default
            userAgents: [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            ...config
        };

        this.rateLimitedUntil = 0;
        this.requestCount = 0;
        this.browser = null;
        
        this.httpClient = axios.create({
            timeout: this.config.timeout,
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            }
        });

        this.httpClient.interceptors.request.use((config) => {
            const randomUA = this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];
            config.headers['User-Agent'] = randomUA;
            return config;
        });
    }

    async initializeBrowser() {
        if (!this.browser) {
            try {
                this.browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-extensions',
                        '--disable-plugins'
                    ],
                });
                logger.debug('Twitter validator browser initialized');
            } catch (error) {
                logger.error('Failed to initialize browser:', error);
                throw error;
            }
        }
    }

    async configurePage(page) {
        try {
            const userAgent = new UserAgent();
            await page.setUserAgent(userAgent.toString());
            
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://twitter.com/',
                'Origin': 'https://twitter.com',
            });

            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        } catch (error) {
            logger.error('Failed to configure page:', error);
            throw error;
        }
    }

    /**
     * Quick likes check using syndication API only (fast ~100-200ms)
     * Used for initial filtering before expensive operations
     */
    async quickLikesCheck(twitterUrl) {
        if (!twitterUrl) {
            return null;
        }

        try {
            const tweetId = this.extractTweetId(twitterUrl);
            if (!tweetId) {
                return null;
            }

            if (this.isRateLimited()) {
                logger.warn(`Rate limited until ${new Date(this.rateLimitedUntil)}`);
                return null;
            }

            logger.debug(`🚀 Quick likes check for tweet ${tweetId}`);
            const startTime = Date.now();

            // Fast syndication API call with short timeout
            const metrics = await this.getQuickMetricsFromSyndication(tweetId);
            
            const duration = Date.now() - startTime;
            logger.debug(`⚡ Quick likes check completed in ${duration}ms: ${metrics?.likes || 0} likes`);

            if (metrics && metrics.likes > 0) {
                return {
                    link: twitterUrl,
                    likes: metrics.likes,
                    publishedAt: metrics.publishedAt,
                    isQuickCheck: true // Flag to indicate this is incomplete data
                };
            }

            return null;

        } catch (error) {
            logger.error(`Error in quick likes check for ${twitterUrl}:`, error.message);
            return null;
        }
    }

    /**
     * Backwards compatible method that matches your test file
     * This includes puppeteer page extraction for views
     */
    async validateEngagement(twitterUrl) {
        if (!twitterUrl) {
            return null;
        }

        try {
            const tweetId = this.extractTweetId(twitterUrl);
            if (!tweetId) {
                return null;
            }

            if (this.isRateLimited()) {
                logger.warn(`Rate limited until ${new Date(this.rateLimitedUntil)}`);
                return null;
            }

            // Try syndication API first (fast)
            const syndicationMetrics = await this.getMetricsFromSyndication(tweetId);
            
            // If page extraction is enabled and we need views, use puppeteer
            if (this.config.enablePageExtraction && (!syndicationMetrics || syndicationMetrics.views === 0)) {
                logger.debug(`🔍 Using puppeteer for view extraction...`);
                const pageMetrics = await this.getMetricsFromPuppeteer(tweetId);
                
                if (pageMetrics) {
                    // Merge results - take highest likes count and views from puppeteer
                    return {
                        link: twitterUrl,
                        views: pageMetrics.views || 0,
                        likes: Math.max(pageMetrics.likes || 0, syndicationMetrics?.likes || 0),
                        retweets: 0, // Not needed
                        replies: 0,  // Not needed
                        publishedAt: pageMetrics.publishedAt || syndicationMetrics?.publishedAt
                    };
                }
            }

            // Fallback to syndication only
            if (syndicationMetrics) {
                return {
                    link: twitterUrl,
                    views: syndicationMetrics.views || 0,
                    likes: syndicationMetrics.likes || 0,
                    retweets: 0,
                    replies: 0,
                    publishedAt: syndicationMetrics.publishedAt
                };
            }

            // Return minimal data if everything fails
            return {
                link: twitterUrl,
                views: 0,
                likes: 0,
                retweets: 0,
                replies: 0,
                publishedAt: null
            };

        } catch (error) {
            logger.error(`Error validating Twitter engagement for ${twitterUrl}:`, error.message);
            return null;
        }
    }

    async getQuickMetricsFromSyndication(tweetId) {
        try {
            const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(url, {
                    headers: {
                        'Referer': 'https://platform.twitter.com/',
                        'Origin': 'https://platform.twitter.com'
                    },
                    timeout: this.config.quickTimeout // Short timeout for speed
                }),
                2 // Only 2 retries for speed
            );

            if (response.data) {
                const data = response.data;
                
                const metrics = {
                    likes: parseInt(data.favorite_count) || parseInt(data.favoriteCount) || parseInt(data.like_count) || 0,
                    publishedAt: this.parseTwitterDate(data.created_at || data.created_time || data.time)
                };
                
                return metrics;
            }
            return null;
        } catch (error) {
            logger.debug(`Quick syndication API failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    async getMetricsFromSyndication(tweetId) {
        try {
            const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`;
            
            const response = await retryWithBackoff(
                () => this.httpClient.get(url, {
                    headers: {
                        'Referer': 'https://platform.twitter.com/',
                        'Origin': 'https://platform.twitter.com'
                    }
                }),
                this.config.maxRetries
            );

            if (response.data) {
                const data = response.data;
                
                const metrics = {
                    views: parseInt(data.view_count) || parseInt(data.viewCount) || 0,
                    likes: parseInt(data.favorite_count) || parseInt(data.favoriteCount) || parseInt(data.like_count) || 0,
                    publishedAt: this.parseTwitterDate(data.created_at || data.created_time || data.time)
                };
                
                logger.debug(`Syndication API results for ${tweetId}: V:${metrics.views} L:${metrics.likes}`);
                return metrics;
            }
            return null;
        } catch (error) {
            logger.debug(`Syndication API failed for tweet ${tweetId}:`, error.message);
            return null;
        }
    }

    async getMetricsFromPuppeteer(tweetId, retryCount = 0) {
        await this.initializeBrowser();
        let page = null;

        try {
            page = await this.browser.newPage();
            await this.configurePage(page);
            
            const tweetUrl = `https://twitter.com/i/status/${tweetId}`;
            logger.debug(`Fetching tweet with puppeteer: ${tweetUrl}`);
            
            await page.goto(tweetUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            // Wait a bit for dynamic content to load
            await page.waitForTimeout(3000);

            // Extract the full page content
            const pageContent = await page.content();

            // Parse metrics from the page content
            const metrics = this.parseTwitterMetricsFromHtml(pageContent);
            
            logger.debug(`Puppeteer extraction results for ${tweetId}: V:${metrics.views} L:${metrics.likes}`);
            
            return metrics;

        } catch (error) {
            logger.error(`Puppeteer extraction error for tweet ${tweetId}:`, error.message);
            
            // Retry logic
            if (retryCount < this.config.maxRetries) {
                logger.info(`Retrying puppeteer extraction (${retryCount + 1}/${this.config.maxRetries}) after ${this.config.retryDelay || 2000}ms`);
                await new Promise(resolve => setTimeout(resolve, (this.config.retryDelay || 2000) * (retryCount + 1)));
                return this.getMetricsFromPuppeteer(tweetId, retryCount + 1);
            }
            
            return null;
        } finally {
            if (page) {
                await page.close();
            }
        }
    }

    parseTwitterMetricsFromHtml(html) {
        const metrics = {
            views: 0,
            likes: 0,
            publishedAt: null
        };

        try {
            // Extract views using multiple patterns
            const viewPatterns = [
                /"viewCount":"(\d+)"/g,
                /"view_count":"(\d+)"/g,
                /(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*(?:Views?|views?)/gi,
                /"viewCount":\s*"?(\d+)"?/g,
                /view_count['"]\s*:\s*['"]\s*(\d+)/gi
            ];

            for (const pattern of viewPatterns) {
                const matches = [...html.matchAll(pattern)];
                for (const match of matches) {
                    if (match[1]) {
                        const viewCount = this.parseNumberWithSuffix(match[1]);
                        if (viewCount > metrics.views) {
                            metrics.views = viewCount;
                        }
                    }
                }
            }

            // Extract likes using multiple patterns  
            const likePatterns = [
                /"favorite_count":"(\d+)"/g,
                /"favoriteCount":"(\d+)"/g,
                /"like_count":"(\d+)"/g,
                /(\d+(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*(?:Likes?|likes?)/gi,
                /"favoriteCount":\s*"?(\d+)"?/g
            ];

            for (const pattern of likePatterns) {
                const matches = [...html.matchAll(pattern)];
                for (const match of matches) {
                    if (match[1]) {
                        const likeCount = this.parseNumberWithSuffix(match[1]);
                        if (likeCount > metrics.likes) {
                            metrics.likes = likeCount;
                        }
                    }
                }
            }

            // Extract published date
            const datePatterns = [
                /"created_at":"([^"]+)"/,
                /"time":"([^"]+)"/,
                /"timestamp":"([^"]+)"/,
                /datetime="([^"]+)"/
            ];

            for (const pattern of datePatterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    const date = this.parseTwitterDate(match[1]);
                    if (date) {
                        metrics.publishedAt = date;
                        break;
                    }
                }
            }

        } catch (error) {
            logger.debug('Error parsing Twitter metrics from HTML:', error);
        }

        return metrics;
    }

    parseNumberWithSuffix(numberStr) {
        if (!numberStr) return 0;
        
        const cleanStr = numberStr.replace(/,/g, '').trim();
        
        if (cleanStr.includes('K') || cleanStr.includes('k')) {
            return Math.round(parseFloat(cleanStr) * 1000);
        } else if (cleanStr.includes('M') || cleanStr.includes('m')) {
            return Math.round(parseFloat(cleanStr) * 1000000);
        } else if (cleanStr.includes('B') || cleanStr.includes('b')) {
            return Math.round(parseFloat(cleanStr) * 1000000000);
        } else {
            const num = parseInt(cleanStr);
            return isNaN(num) ? 0 : num;
        }
    }

    extractTweetId(url) {
        const patterns = [
            /(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/,
            /(?:twitter\.com|x\.com)\/[\w]+\/statuses\/(\d+)/,
            /\/status\/(\d+)/,
            /\/statuses\/(\d+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    parseTwitterDate(dateString) {
        if (!dateString) return null;
        
        try {
            let date;
            if (typeof dateString === 'number') {
                date = new Date(dateString * 1000);
            } else {
                date = new Date(dateString);
            }
            
            if (isNaN(date.getTime())) {
                logger.debug('Invalid date parsed:', dateString);
                return null;
            }
            
            return date.toISOString();
        } catch (error) {
            logger.debug('Error parsing Twitter date:', error);
            return null;
        }
    }

    isRateLimited() {
        return Date.now() < this.rateLimitedUntil;
    }

    handleRateLimit(error) {
        if (error.response?.status === 429 || error.message.includes('rate limit')) {
            this.rateLimitedUntil = Date.now() + (5 * 60 * 1000);
            logger.warn('Rate limited for 5 minutes');
        }
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                this.browser = null;
                logger.debug('Twitter validator browser closed');
            } catch (error) {
                logger.error('Error closing browser:', error);
            }
        }
    }

    async cleanup() {
        await this.closeBrowser();
    }

    getStatus() {
        return {
            rateLimitedUntil: this.rateLimitedUntil,
            isRateLimited: this.isRateLimited(),
            requestCount: this.requestCount,
            method: 'parallel-likes-and-puppeteer-views',
            browserInitialized: !!this.browser,
            pageExtractionEnabled: this.config.enablePageExtraction
        };
    }
}

module.exports = TwitterValidator;