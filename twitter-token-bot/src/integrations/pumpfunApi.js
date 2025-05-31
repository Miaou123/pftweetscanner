// src/integrations/pumpfunApi.js - Enhanced with robust error handling and browser management
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class PumpFunApi {
    constructor() {
        this.baseUrl = 'https://frontend-api-v3.pump.fun';
        this.browser = null;
        this.maxRetries = 3;
        this.retryDelay = 2000;
        this.browserInitializing = false;
        this.maxConcurrentPages = 2; // Limit concurrent pages
        this.activePagesCount = 0;
        this.browserRestartCount = 0;
        this.maxBrowserRestarts = 5;
    }

    async initializeBrowser() {
        // Prevent multiple concurrent initialization attempts
        if (this.browserInitializing) {
            while (this.browserInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return this.browser;
        }

        if (this.browser) {
            try {
                // Test if browser is still alive
                await this.browser.version();
                return this.browser;
            } catch (error) {
                logger.warn('Browser appears to be dead, restarting...');
                this.browser = null;
            }
        }

        this.browserInitializing = true;

        try {
            logger.info('🚀 Initializing Puppeteer browser...');
            
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
                    '--disable-plugins',
                    '--disable-default-apps',
                    '--disable-background-networking',
                    '--disable-sync',
                    '--disable-translate',
                    '--hide-scrollbars',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--no-default-browser-check',
                    '--safebrowsing-disable-auto-update',
                    '--disable-client-side-phishing-detection',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off',
                    '--single-process', // Use single process to avoid crashes
                    '--max_old_space_size=512' // Limit memory usage
                ],
                timeout: 60000, // 60 second timeout for browser launch
                defaultViewport: { width: 1024, height: 768 }
            });

            // Set up browser event handlers
            this.browser.on('disconnected', () => {
                logger.warn('🔥 Browser disconnected unexpectedly');
                this.browser = null;
                this.activePagesCount = 0;
                this.browserRestartCount++;
            });

            this.activePagesCount = 0;
            logger.info('✅ Puppeteer browser initialized successfully');
            
        } catch (error) {
            logger.error('❌ Failed to initialize Puppeteer browser:', error);
            this.browser = null;
            throw error;
        } finally {
            this.browserInitializing = false;
        }

        return this.browser;
    }

    async configurePage(page) {
        try {
            // Set a random but realistic user agent
            const userAgent = new UserAgent({ deviceCategory: 'desktop' });
            await page.setUserAgent(userAgent.toString());
            
            // Set extra headers to appear more like a real browser
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://pump.fun/',
                'Origin': 'https://pump.fun',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            });

            // Set up request interception to block unnecessary resources
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                const url = req.url();
                
                // Block images, stylesheets, fonts, and tracking scripts
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    req.abort();
                } else if (url.includes('google-analytics') || 
                          url.includes('googletagmanager') || 
                          url.includes('facebook') || 
                          url.includes('twitter') ||
                          url.includes('analytics')) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            // Set reasonable timeouts
            page.setDefaultTimeout(30000);
            page.setDefaultNavigationTimeout(30000);
            
        } catch (error) {
            logger.error('Failed to configure page:', error);
            throw error;
        }
    }

    async fetchData(url, retryCount = 0) {
        // Check if we should limit concurrent requests
        if (this.activePagesCount >= this.maxConcurrentPages) {
            logger.warn(`Too many concurrent pages (${this.activePagesCount}), waiting...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check if we've restarted the browser too many times
        if (this.browserRestartCount >= this.maxBrowserRestarts) {
            logger.error(`Browser restarted too many times (${this.browserRestartCount}), returning empty result`);
            return [];
        }

        let page = null;

        try {
            await this.initializeBrowser();
            
            if (!this.browser) {
                throw new Error('Browser initialization failed');
            }

            this.activePagesCount++;
            page = await this.browser.newPage();
            await this.configurePage(page);
            
            logger.debug(`📄 Fetching data from: ${url}`);
            
            // Navigate to the page
            const response = await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            // Check if the response was successful
            if (!response.ok()) {
                throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
            }

            // Get the page content
            const bodyText = await page.evaluate(() => document.body.innerText);

            // Handle empty responses
            if (!bodyText || bodyText.trim() === '') {
                logger.debug(`Empty response body from ${url}`);
                return [];
            }

            const trimmedBody = bodyText.trim();
            
            // Handle empty JSON arrays
            if (trimmedBody === '[]') {
                logger.debug(`Empty array response from ${url}`);
                return [];
            }

            // Handle error messages from the server
            if (trimmedBody.toLowerCase().includes('error') || 
                trimmedBody.toLowerCase().includes('not found') ||
                trimmedBody.toLowerCase().includes('invalid')) {
                logger.warn(`Server error response from ${url}: ${trimmedBody.substring(0, 100)}`);
                return [];
            }

            try {
                const data = JSON.parse(trimmedBody);
                logger.debug(`✅ Successfully parsed JSON from ${url}: ${Array.isArray(data) ? data.length + ' items' : 'object'}`);
                return data;
            } catch (parseError) {
                logger.error(`JSON parsing error for URL: ${url}`);
                logger.debug(`Response body (first 500 chars): ${trimmedBody.substring(0, 500)}`);
                
                // If the response is very short, treat it as empty
                if (trimmedBody.length <= 10) {
                    logger.debug(`Very short response (${trimmedBody.length} chars), treating as empty: "${trimmedBody}"`);
                    return [];
                }
                
                throw new Error(`JSON parsing failed: ${parseError.message}`);
            }

        } catch (error) {
            logger.error(`Error fetching data from ${url}:`, error.message);
            
            // Handle specific error types
            if (error.message.includes('Protocol error') || 
                error.message.includes('Connection closed') ||
                error.message.includes('Browser closed')) {
                
                logger.warn('🔥 Browser connection lost, marking for restart');
                this.browser = null;
                this.activePagesCount = 0;
                this.browserRestartCount++;
                
                // Retry with new browser instance
                if (retryCount < this.maxRetries) {
                    logger.info(`🔄 Retrying with new browser instance (${retryCount + 1}/${this.maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * (retryCount + 1)));
                    return this.fetchData(url, retryCount + 1);
                }
            }
            
            // Handle timeout errors
            if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
                if (retryCount < this.maxRetries) {
                    logger.info(`⏰ Timeout occurred, retrying (${retryCount + 1}/${this.maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    return this.fetchData(url, retryCount + 1);
                }
            }
            
            // For parsing errors or other recoverable errors, return empty array
            if (error.message.includes('JSON parsing failed') || 
                error.message.includes('HTTP 4') ||
                error.message.includes('Empty response')) {
                logger.warn(`Recoverable error, returning empty array: ${error.message}`);
                return [];
            }
            
            // For unrecoverable errors, still return empty array to prevent crashes
            logger.error(`Unrecoverable error, returning empty array: ${error.message}`);
            return [];
            
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (closeError) {
                    logger.debug('Error closing page:', closeError.message);
                }
                this.activePagesCount = Math.max(0, this.activePagesCount - 1);
            }
        }
    }

    async getAllTrades(tokenAddress, limit = 200, offset = 0, minimumSize = 0) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        const url = `${this.baseUrl}/trades/all/${tokenAddress}?limit=${limit}&offset=${offset}&minimumSize=${minimumSize}`;
        
        try {
            const data = await this.fetchData(url);
            
            // Ensure we always return an array
            if (!Array.isArray(data)) {
                logger.warn(`Unexpected response format for trades: ${typeof data}`);
                return [];
            }

            logger.debug(`📊 Fetched ${data.length} trades for token ${tokenAddress} (offset: ${offset})`);
            return data;

        } catch (error) {
            logger.error(`Failed to fetch trades for token ${tokenAddress}:`, error);
            return []; // Always return empty array instead of throwing
        }
    }

    async getTokenInfo(tokenAddress) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        const url = `${this.baseUrl}/coins/${tokenAddress}`;
        
        try {
            const data = await this.fetchData(url);
            return data;
        } catch (error) {
            logger.error(`Failed to fetch token info for ${tokenAddress}:`, error);
            return null; // Return null for token info failures
        }
    }

    async getUserTrades(userAddress, limit = 50, offset = 0) {
        if (!userAddress) {
            throw new Error("User address is required");
        }

        const url = `${this.baseUrl}/trades/user/${userAddress}?limit=${limit}&offset=${offset}`;
        
        try {
            const data = await this.fetchData(url);
            return Array.isArray(data) ? data : [];
        } catch (error) {
            logger.error(`Failed to fetch user trades for ${userAddress}:`, error);
            return [];
        }
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                logger.info('🔥 PumpFun browser closed successfully');
            } catch (error) {
                logger.error('Error closing browser:', error);
            } finally {
                this.browser = null;
                this.activePagesCount = 0;
                this.browserInitializing = false;
            }
        }
    }

    // Enhanced cleanup method
    async cleanup() {
        logger.info('🧹 Cleaning up PumpFunApi...');
        await this.closeBrowser();
        logger.info('✅ PumpFunApi cleanup completed');
    }

    // Status method for monitoring
    getStatus() {
        return {
            browserActive: !!this.browser,
            activePagesCount: this.activePagesCount,
            maxConcurrentPages: this.maxConcurrentPages,
            browserRestartCount: this.browserRestartCount,
            maxBrowserRestarts: this.maxBrowserRestarts,
            browserInitializing: this.browserInitializing
        };
    }

    // Health check method
    async healthCheck() {
        try {
            if (!this.browser) {
                return false;
            }
            
            await this.browser.version();
            return true;
        } catch (error) {
            return false;
        }
    }
}

// Export singleton instance
module.exports = new PumpFunApi();