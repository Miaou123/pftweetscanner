// src/integrations/pumpfunApi.js - FIXED with Browser Pool Management
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class BrowserPool {
    constructor(maxBrowsers = 3, maxPagesPerBrowser = 5, browserLifetime = 30 * 60 * 1000) {
        this.maxBrowsers = maxBrowsers;
        this.maxPagesPerBrowser = maxPagesPerBrowser;
        this.browserLifetime = browserLifetime; // 30 minutes
        this.browsers = [];
        this.currentBrowserIndex = 0;
        this.isShuttingDown = false;
        
        // Cleanup on process exit
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
        process.on('exit', () => this.cleanup());
    }

    async getBrowser() {
        // Clean up dead browsers first
        await this.cleanupDeadBrowsers();
        
        // If we have healthy browsers, use round-robin
        if (this.browsers.length > 0) {
            const browser = this.browsers[this.currentBrowserIndex];
            
            // Check if browser is still alive and not overloaded
            if (await this.isBrowserHealthy(browser)) {
                this.currentBrowserIndex = (this.currentBrowserIndex + 1) % this.browsers.length;
                return browser;
            } else {
                // Remove unhealthy browser
                await this.removeBrowser(this.currentBrowserIndex);
            }
        }
        
        // Create new browser if we're under the limit
        if (this.browsers.length < this.maxBrowsers) {
            const browser = await this.createBrowser();
            this.browsers.push(browser);
            logger.info(`🚀 Created browser ${this.browsers.length}/${this.maxBrowsers}`);
            return browser;
        }
        
        // If all browsers are at capacity, wait and retry
        logger.warn('⚠️ All browsers at capacity, waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.getBrowser(); // Recursive retry
    }

    async createBrowser() {
        const browser = await puppeteer.launch({
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
                '--memory-pressure-off' // Prevent memory-based shutdowns
            ],
            protocolTimeout: 60000,
            slowMo: 50,
        });

        // Track browser metadata
        browser._createdAt = Date.now();
        browser._pageCount = 0;

        // Schedule automatic restart after lifetime
        setTimeout(async () => {
            if (!this.isShuttingDown) {
                logger.info('⏰ Browser lifetime expired, scheduling restart...');
                await this.restartBrowser(browser);
            }
        }, this.browserLifetime);

        return browser;
    }

    async isBrowserHealthy(browser) {
        try {
            // Check if browser process is alive
            await browser.version();
            
            // Check page count limit
            const pages = await browser.pages();
            if (pages.length > this.maxPagesPerBrowser) {
                logger.warn(`⚠️ Browser has ${pages.length} pages (max ${this.maxPagesPerBrowser})`);
                return false;
            }
            
            // Check age limit
            const age = Date.now() - browser._createdAt;
            if (age > this.browserLifetime) {
                logger.info(`⏰ Browser age ${Math.round(age/1000/60)}min exceeds lifetime`);
                return false;
            }
            
            return true;
        } catch (error) {
            logger.debug(`Browser health check failed: ${error.message}`);
            return false;
        }
    }

    async cleanupDeadBrowsers() {
        const healthyBrowsers = [];
        
        for (let i = 0; i < this.browsers.length; i++) {
            if (await this.isBrowserHealthy(this.browsers[i])) {
                healthyBrowsers.push(this.browsers[i]);
            } else {
                logger.info(`🗑️ Removing unhealthy browser ${i + 1}`);
                try {
                    await this.browsers[i].close();
                } catch (error) {
                    logger.debug(`Error closing browser: ${error.message}`);
                }
            }
        }
        
        this.browsers = healthyBrowsers;
        this.currentBrowserIndex = 0;
    }

    async removeBrowser(index) {
        if (index < this.browsers.length) {
            const browser = this.browsers[index];
            try {
                await browser.close();
            } catch (error) {
                logger.debug(`Error closing browser: ${error.message}`);
            }
            this.browsers.splice(index, 1);
            this.currentBrowserIndex = Math.min(this.currentBrowserIndex, this.browsers.length - 1);
        }
    }

    async restartBrowser(targetBrowser) {
        const index = this.browsers.indexOf(targetBrowser);
        if (index !== -1) {
            logger.info(`🔄 Restarting browser ${index + 1}`);
            await this.removeBrowser(index);
        }
    }

    async getStats() {
        const stats = {
            totalBrowsers: this.browsers.length,
            browsers: []
        };

        for (let i = 0; i < this.browsers.length; i++) {
            const browser = this.browsers[i];
            try {
                const pages = await browser.pages();
                const age = Math.round((Date.now() - browser._createdAt) / 1000 / 60);
                stats.browsers.push({
                    index: i,
                    pages: pages.length,
                    ageMinutes: age,
                    healthy: await this.isBrowserHealthy(browser)
                });
            } catch (error) {
                stats.browsers.push({
                    index: i,
                    pages: 0,
                    ageMinutes: 0,
                    healthy: false,
                    error: error.message
                });
            }
        }

        return stats;
    }

    async cleanup() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        logger.info('🧹 Shutting down browser pool...');
        
        const closePromises = this.browsers.map(async (browser, index) => {
            try {
                await browser.close();
                logger.debug(`✅ Browser ${index + 1} closed`);
            } catch (error) {
                logger.debug(`❌ Error closing browser ${index + 1}: ${error.message}`);
            }
        });
        
        await Promise.allSettled(closePromises);
        this.browsers = [];
        logger.info('✅ Browser pool cleanup completed');
    }
}

class PumpFunApi {
    constructor() {
        this.baseUrl = 'https://frontend-api-v3.pump.fun';
        this.maxRetries = 3;
        this.retryDelay = 2000;
        
        // Create browser pool with 3 browsers max
        this.browserPool = new BrowserPool(3, 5, 20 * 60 * 1000); // 3 browsers, 5 pages each, 20min lifetime
    }

    async configurePage(page) {
        try {
            const userAgent = new UserAgent();
            await page.setUserAgent(userAgent.toString());
            
            await page.setDefaultTimeout(30000);
            await page.setDefaultNavigationTimeout(30000);
            
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://pump.fun/',
                'Origin': 'https://pump.fun',
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

    async fetchData(url, retryCount = 0) {
        let page = null;
        let browser = null;

        try {
            // Get browser from pool (reuses existing browsers!)
            browser = await this.browserPool.getBrowser();
            page = await browser.newPage();
            await this.configurePage(page);
            
            logger.debug(`Fetching data from: ${url}`);
            
            await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000 
            });

            await page.waitForTimeout(1000);
            const bodyText = await page.evaluate(() => document.body.innerText);

            try {
                const data = JSON.parse(bodyText);
                return data;
            } catch (parseError) {
                logger.error(`JSON parsing error for URL: ${url}`);
                logger.debug(`Response body: ${bodyText.substring(0, 200)}...`);
                throw new Error(`JSON parsing failed: ${parseError.message}`);
            }

        } catch (error) {
            logger.error(`Error fetching data from ${url}:`, error.message);
            
            // Retry logic
            if (retryCount < this.maxRetries) {
                const delay = this.retryDelay * (retryCount + 1);
                logger.info(`Retrying request (${retryCount + 1}/${this.maxRetries}) after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchData(url, retryCount + 1);
            }
            
            throw error;
        } finally {
            // CRITICAL: Always close the page (tab) but NOT the browser
            if (page) {
                try {
                    await page.close(); // ✅ Close tab
                    // ❌ DO NOT call browser.close() - browser stays in pool!
                } catch (closeError) {
                    logger.debug('Error closing page:', closeError.message);
                }
            }
        }
    }

    // Rest of your methods stay the same
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

            logger.debug(`Fetched ${data.length} trades for token ${tokenAddress}`);
            return data;

        } catch (error) {
            logger.error(`Failed to fetch trades for token ${tokenAddress}:`, error);
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
            return data;
        } catch (error) {
            logger.error(`Failed to fetch token info for ${tokenAddress}:`, error);
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
            logger.error(`Failed to fetch user trades for ${userAddress}:`, error);
            throw error;
        }
    }

    // Updated cleanup - uses browser pool
    async cleanup() {
        logger.info('🧹 Cleaning up PumpFun API...');
        await this.browserPool.cleanup();
        logger.info('✅ PumpFun API cleanup completed');
    }

    // Health check with pool stats
    async getStats() {
        return await this.browserPool.getStats();
    }
}

// Export singleton instance
module.exports = new PumpFunApi();