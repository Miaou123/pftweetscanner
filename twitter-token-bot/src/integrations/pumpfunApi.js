// src/integrations/pumpfunApi.js - Updated for Modern Puppeteer
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
        this.browserRestartCount = 0;
        this.maxBrowserRestarts = 5;
        this.lastBrowserRestart = 0;
        this.minRestartInterval = 60000; // 1 minute between restarts
    }

    async initializeBrowser() {
        // Check if we need to restart browser due to age or errors
        const now = Date.now();
        const shouldRestart = this.browserRestartCount > 0 && 
                             (now - this.lastBrowserRestart) > this.minRestartInterval;

        if (this.browser && !shouldRestart) {
            // Check if browser is still connected
            try {
                await this.browser.version();
                return; // Browser is still working
            } catch (error) {
                logger.warn('Browser connection lost, reinitializing...');
                await this.closeBrowser();
            }
        }

        if (shouldRestart) {
            logger.info('Proactively restarting browser due to previous errors');
            await this.closeBrowser();
        }

        try {
            logger.debug('Launching new Puppeteer browser...');
            
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-accelerated-2d-canvas',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-extensions',
                    '--disable-plugins',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096'
                ],
                // Updated timeouts for modern Puppeteer
                protocolTimeout: 60000, // 60 seconds
                slowMo: 50, // Small delay between actions
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            });
            
            this.browserRestartCount = 0;
            this.lastBrowserRestart = now;
            logger.debug('✅ PumpFun browser initialized successfully');

            // Handle browser disconnection
            this.browser.on('disconnected', () => {
                logger.warn('⚠️ Browser disconnected unexpectedly');
                this.browser = null;
            });

        } catch (error) {
            logger.error('❌ Failed to initialize browser:', error);
            throw error;
        }
    }

    async configurePage(page) {
        try {
            // Modern Puppeteer page configuration
            const userAgent = new UserAgent();
            await page.setUserAgent(userAgent.toString());
            
            // Set timeouts (modern Puppeteer syntax)
            page.setDefaultTimeout(30000);
            page.setDefaultNavigationTimeout(30000);
            
            // Set headers
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://pump.fun/',
                'Origin': 'https://pump.fun',
                'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Linux"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'cross-site'
            });

            // Request interception for performance
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
            logger.error('❌ Failed to configure page:', error);
            throw error;
        }
    }

    async fetchData(url, retryCount = 0) {
        let page = null;

        try {
            await this.initializeBrowser();
            
            page = await this.browser.newPage();
            await this.configurePage(page);
            
            logger.debug(`🌐 Fetching data from: ${url}`);
            
            // Navigate with better error handling
            await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            // FIXED: Use modern Puppeteer delay method
            await this.waitForDelay(page, 1000);

            // Extract content
            const bodyText = await page.evaluate(() => document.body.innerText);

            // Validate and parse response
            if (!bodyText || bodyText.trim() === '') {
                throw new Error('Empty response body');
            }

            try {
                const data = JSON.parse(bodyText);
                
                // Check for error responses that still return 200
                if (data.error || data.message || (typeof data === 'object' && Object.keys(data).length === 0)) {
                    throw new Error(`API Error: ${data.error || data.message || 'Empty response object'}`);
                }
                
                return data;
            } catch (parseError) {
                logger.error(`JSON parsing error for URL: ${url}`);
                logger.debug(`Response body (first 200 chars): ${bodyText.substring(0, 200)}...`);
                
                // Check if response is HTML (error page)
                if (bodyText.includes('<html>') || bodyText.includes('<!DOCTYPE')) {
                    throw new Error('Received HTML error page instead of JSON');
                }
                
                throw new Error(`JSON parsing failed: ${parseError.message}`);
            }

        } catch (error) {
            logger.error(`❌ Error fetching data from ${url}:`, error.message);
            
            // Handle browser-specific errors
            if (this.isBrowserError(error)) {
                logger.warn('🔄 Browser error detected, will restart browser');
                await this.closeBrowser();
                this.browserRestartCount++;
                
                if (this.browserRestartCount < this.maxBrowserRestarts) {
                    logger.info(`🔄 Restarting browser (attempt ${this.browserRestartCount}/${this.maxBrowserRestarts})`);
                    await this.waitForDelay(null, 2000); // Wait before restart
                }
            }
            
            // Retry logic
            if (retryCount < this.maxRetries) {
                const delay = this.retryDelay * (retryCount + 1);
                logger.info(`🔄 Retrying request (${retryCount + 1}/${this.maxRetries}) after ${delay}ms`);
                await this.waitForDelay(null, delay);
                return this.fetchData(url, retryCount + 1);
            }
            
            throw error;
        } finally {
            // Always close the page
            if (page) {
                try {
                    await page.close();
                } catch (closeError) {
                    logger.debug('Error closing page:', closeError.message);
                }
            }
        }
    }

    // FIXED: Universal delay method that works with all Puppeteer versions
    async waitForDelay(page, ms) {
        try {
            if (page && typeof page.waitForTimeout === 'function') {
                // Modern Puppeteer (v1.12+)
                await page.waitForTimeout(ms);
            } else if (page && typeof page.waitFor === 'function') {
                // Legacy Puppeteer (v1.0-1.11)
                await page.waitFor(ms);
            } else {
                // Universal fallback
                await new Promise(resolve => setTimeout(resolve, ms));
            }
        } catch (error) {
            // If page methods fail, use universal fallback
            await new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    isBrowserError(error) {
        const browserErrorPatterns = [
            /Protocol error/i,
            /Connection closed/i,
            /Target closed/i,
            /Session closed/i,
            /Browser has been closed/i,
            /Navigation failed/i,
            /Frame was detached/i
        ];
        
        return browserErrorPatterns.some(pattern => pattern.test(error.message));
    }

    async getAllTrades(tokenAddress, limit = 200, offset = 0, minimumSize = 0) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        const url = `${this.baseUrl}/trades/all/${tokenAddress}?limit=${limit}&offset=${offset}&minimumSize=${minimumSize}`;
        
        try {
            const data = await this.fetchData(url);
            
            if (!Array.isArray(data)) {
                logger.warn(`Unexpected response format for trades: ${typeof data}`);
                return [];
            }

            logger.debug(`📊 Fetched ${data.length} trades for token ${tokenAddress}`);
            return data;

        } catch (error) {
            logger.error(`❌ Failed to fetch trades for token ${tokenAddress}:`, error);
            throw error;
        }
    }

    async getTokenInfo(tokenAddress) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        const url = `${this.baseUrl}/coins/${tokenAddress}`;
        
        try {
            const data = await this.fetchData(url);
            
            // Additional validation for token info
            if (data && typeof data === 'object') {
                // Check if it has expected token fields
                const hasTokenFields = data.name || data.symbol || data.description || data.created_timestamp;
                if (!hasTokenFields) {
                    logger.warn(`Token info response missing expected fields for ${tokenAddress}`);
                    throw new Error('Invalid token info structure');
                }
                
                logger.debug(`✅ Token info fetched: ${data.name || 'Unknown'} (${data.symbol || 'Unknown'})`);
            }
            
            return data;
        } catch (error) {
            logger.error(`❌ Failed to fetch token info for ${tokenAddress}:`, error);
            throw error;
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
            logger.error(`❌ Failed to fetch user trades for ${userAddress}:`, error);
            throw error;
        }
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                this.browser = null;
                logger.debug('🔒 PumpFun browser closed');
            } catch (error) {
                logger.error('❌ Error closing browser:', error);
                this.browser = null; // Force null even if close failed
            }
        }
    }

    // Enhanced cleanup method
    async cleanup() {
        logger.info('🧹 Cleaning up PumpFun API resources...');
        await this.closeBrowser();
        logger.info('✅ PumpFun API cleanup completed');
    }

    // Health check method
    async healthCheck() {
        try {
            if (!this.browser) {
                return { healthy: false, reason: 'No browser instance' };
            }
            
            await this.browser.version();
            return { 
                healthy: true, 
                browserRestarts: this.browserRestartCount,
                lastRestart: this.lastBrowserRestart 
            };
        } catch (error) {
            return { 
                healthy: false, 
                reason: error.message,
                browserRestarts: this.browserRestartCount 
            };
        }
    }

    // Test method for debugging
    async testFetch(tokenAddress) {
        logger.info(`🧪 Testing fetch for token: ${tokenAddress}`);
        
        try {
            const startTime = Date.now();
            const data = await this.getTokenInfo(tokenAddress);
            const duration = Date.now() - startTime;
            
            logger.info(`✅ Test successful in ${duration}ms:`);
            logger.info(`   Name: ${data.name || 'N/A'}`);
            logger.info(`   Symbol: ${data.symbol || 'N/A'}`);
            logger.info(`   Created: ${data.created_timestamp || 'N/A'}`);
            
            return { success: true, data, duration };
            
        } catch (error) {
            logger.error(`❌ Test failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

// Export singleton instance
module.exports = new PumpFunApi();