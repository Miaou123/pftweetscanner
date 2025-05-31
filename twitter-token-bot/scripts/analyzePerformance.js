// Enhanced ATH Performance Analyzer with CORRECTED Trading Simulation
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class EnhancedATHAnalyzer {
    constructor() {
        this.scanResultsDir = path.join(process.cwd(), 'scan_results');
        this.codexApiUrl = 'https://graph.codex.io/graphql';
        this.codexApiKey = process.env.CODEX_API_KEY;
        
        // Trading strategy configuration
        this.FIXED_ENTRY_PRICE = 0.00008;
        this.INVESTMENT_SIZE = 1; // 1 SOL per trade
        
        // Trading rules
        this.FIRST_TAKE_PROFIT_MULTIPLIER = 2; // 2x = +100%
        this.SECOND_TAKE_PROFIT_MULTIPLIER = 4; // 4x = +300%
        this.FIRST_SELL_PERCENTAGE = 0.5; // Sell 50% at 2x
        this.SECOND_SELL_PERCENTAGE = 0.5; // Sell 50% of remaining (25% total) at 4x
        this.STOP_LOSS_MULTIPLIER = 0.5; // -50% stop loss
        this.TRAILING_STOP_PRICE = this.FIXED_ENTRY_PRICE; // Moonbag sold at breakeven
        
        this.results = {
            analyzed: 0,
            successful: 0,
            failed: 0,
            tokens: [],
            tradingResults: {
                totalInvested: 0,
                totalReceived: 0,
                totalProfit: 0,
                totalLoss: 0,
                netProfit: 0,
                profitableTradesCount: 0,
                lossTradesCount: 0,
                winRate: 0,
                roi: 0
            }
        };
    }

    calculateTradingProfit(athPrice) {
        const entryPrice = this.FIXED_ENTRY_PRICE;
        const investmentSize = this.INVESTMENT_SIZE;
        
        // Calculate how many tokens we can buy
        const totalTokens = investmentSize / entryPrice; // e.g., 1 SOL / 0.0001 = 10,000 tokens
        
        // Calculate price multiples
        const athMultiple = athPrice / entryPrice;
        
        // Initialize tracking
        let totalReceived = 0;
        let remainingTokens = totalTokens; // Track actual token quantity
        let tradeDetails = [];
        
        // Check if we hit stop loss first (never reached 2x)
        if (athMultiple < this.FIRST_TAKE_PROFIT_MULTIPLIER) {
            // Sell everything at stop loss (-50%)
            const stopLossPrice = entryPrice * this.STOP_LOSS_MULTIPLIER;
            const totalReceived = remainingTokens * stopLossPrice;
            const netProfit = totalReceived - investmentSize;
            
            tradeDetails.push({
                action: 'STOP_LOSS',
                tokensSOld: remainingTokens,
                percentage: 100,
                sellPrice: stopLossPrice,
                solReceived: totalReceived,
                remainingTokens: 0
            });
            
            return {
                totalReceived,
                netProfit,
                tradeDetails,
                outcome: 'STOP_LOSS'
            };
        }
        
        // First take profit at 2x
        const firstTakeProfitPrice = entryPrice * this.FIRST_TAKE_PROFIT_MULTIPLIER;
        const firstSellTokens = remainingTokens * this.FIRST_SELL_PERCENTAGE;
        const firstSaleReceived = firstSellTokens * firstTakeProfitPrice;
        totalReceived += firstSaleReceived;
        remainingTokens -= firstSellTokens;
        
        tradeDetails.push({
            action: 'TAKE_PROFIT_1',
            tokensSold: firstSellTokens,
            percentage: this.FIRST_SELL_PERCENTAGE * 100,
            sellPrice: firstTakeProfitPrice,
            solReceived: firstSaleReceived,
            remainingTokens: remainingTokens
        });
        
        // Check if we hit second take profit at 4x
        if (athMultiple >= this.SECOND_TAKE_PROFIT_MULTIPLIER) {
            const secondTakeProfitPrice = entryPrice * this.SECOND_TAKE_PROFIT_MULTIPLIER;
            const secondSellTokens = remainingTokens * this.SECOND_SELL_PERCENTAGE;
            const secondSaleReceived = secondSellTokens * secondTakeProfitPrice;
            totalReceived += secondSaleReceived;
            remainingTokens -= secondSellTokens;
            
            tradeDetails.push({
                action: 'TAKE_PROFIT_2',
                tokensSold: secondSellTokens,
                percentage: this.SECOND_SELL_PERCENTAGE * 100,
                sellPrice: secondTakeProfitPrice,
                solReceived: secondSaleReceived,
                remainingTokens: remainingTokens
            });
        }
        
        // Sell remaining moonbag at trailing stop (breakeven)
        if (remainingTokens > 0) {
            const moonbagReceived = remainingTokens * this.TRAILING_STOP_PRICE;
            totalReceived += moonbagReceived;
            
            tradeDetails.push({
                action: 'MOONBAG_TRAILING_STOP',
                tokensSold: remainingTokens,
                percentage: (remainingTokens / totalTokens) * 100,
                sellPrice: this.TRAILING_STOP_PRICE,
                solReceived: moonbagReceived,
                remainingTokens: 0
            });
        }
        
        const netProfit = totalReceived - investmentSize;
        const outcome = athMultiple >= this.SECOND_TAKE_PROFIT_MULTIPLIER ? 'DOUBLE_TAKE_PROFIT' : 'SINGLE_TAKE_PROFIT';
        
        return {
            totalReceived,
            netProfit,
            tradeDetails,
            outcome
        };
    }

    async analyzeScanResults() {
        console.log('🔍 Enhanced ATH Analysis with CORRECTED Trading Simulation...');
        console.log('📋 Trading Strategy:');
        console.log(`   • Entry: ${this.INVESTMENT_SIZE} SOL at $${this.FIXED_ENTRY_PRICE}`);
        console.log(`   • Take Profit 1: Sell ${this.FIRST_SELL_PERCENTAGE * 100}% of tokens at ${this.FIRST_TAKE_PROFIT_MULTIPLIER}x ($${(this.FIXED_ENTRY_PRICE * this.FIRST_TAKE_PROFIT_MULTIPLIER).toFixed(6)})`);
        console.log(`   • Take Profit 2: Sell ${this.SECOND_SELL_PERCENTAGE * 100}% of remaining tokens at ${this.SECOND_TAKE_PROFIT_MULTIPLIER}x ($${(this.FIXED_ENTRY_PRICE * this.SECOND_TAKE_PROFIT_MULTIPLIER).toFixed(6)})`);
        console.log(`   • Moonbag: Sell remaining tokens at breakeven ($${this.TRAILING_STOP_PRICE.toFixed(6)})`);
        console.log(`   • Stop Loss: Sell all tokens at ${this.STOP_LOSS_MULTIPLIER}x ($${(this.FIXED_ENTRY_PRICE * this.STOP_LOSS_MULTIPLIER).toFixed(6)}) if never hits 2x\n`);
        
        try {
            const files = await fs.readdir(this.scanResultsDir);
            const jsonFiles = files.filter(file => file.endsWith('.json'));
            
            console.log(`📁 Found ${jsonFiles.length} scan result files`);
            
            for (const file of jsonFiles) {
                await this.analyzeFile(file);
            }
            
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Error analyzing scan results:', error);
        }
    }

    async analyzeFile(filename) {
        const filepath = path.join(this.scanResultsDir, filename);
        
        try {
            const content = await fs.readFile(filepath, 'utf8');
            const data = JSON.parse(content);
            
            const records = Array.isArray(data) ? data : [data];
            console.log(`📊 Analyzing ${records.length} records from ${filename}`);
            
            for (const record of records) {
                await this.analyzeTokenRecord(record);
            }
            
        } catch (error) {
            console.error(`❌ Error processing ${filename}:`, error.message);
        }
    }

    async analyzeTokenRecord(record) {
        try {
            const tokenData = {
                address: record.address,
                symbol: record.symbol,
                name: record.name,
                scanTimestamp: new Date(record.timestamp),
                eventType: record.eventType,
                twitterMetrics: {
                    likes: record.likes || 0,
                    views: record.views || 0
                },
                tweetLink: record.tweetLink
            };

            console.log(`\n🔍 Analyzing ${tokenData.symbol} (${tokenData.address})`);
            console.log(`   Scanned: ${tokenData.scanTimestamp.toLocaleString()}`);
            console.log(`   Twitter: ${tokenData.twitterMetrics.likes} likes, ${tokenData.twitterMetrics.views} views`);

            // Get ATH using Codex recommended approach
            const athPrice = await this.getATHSimple(tokenData.address);
            
            if (athPrice !== null) {
                // Calculate performance metrics
                const performanceMetrics = this.calculatePerformanceMetrics(athPrice);
                
                // Calculate trading simulation
                const tradingSimulation = this.calculateTradingProfit(athPrice);
                
                const performance = {
                    ...tokenData,
                    entryPrice: this.FIXED_ENTRY_PRICE,
                    ath: athPrice,
                    performanceMetrics,
                    tradingSimulation
                };
                
                this.results.tokens.push(performance);
                this.results.successful++;
                
                // Update trading results
                this.updateTradingResults(tradingSimulation);
                
                console.log(`✅ Analysis complete:`);
                console.log(`   Entry price: $${this.FIXED_ENTRY_PRICE} (fixed)`);
                console.log(`   ATH: $${performance.ath?.toFixed(8) || 'N/A'}`);
                console.log(`   Max Gain: ${performance.performanceMetrics.maxGainPercent?.toFixed(2) || 'N/A'}%`);
                console.log(`   💰 Trading Result: ${tradingSimulation.outcome}`);
                console.log(`   💰 Total Received: ${tradingSimulation.totalReceived.toFixed(4)} SOL`);
                console.log(`   💰 Net Profit: ${tradingSimulation.netProfit >= 0 ? '+' : ''}${tradingSimulation.netProfit.toFixed(4)} SOL (${((tradingSimulation.netProfit / this.INVESTMENT_SIZE) * 100).toFixed(1)}%)`);
                
                // Show trade breakdown
                tradingSimulation.tradeDetails.forEach((trade, i) => {
                    const tokensFormatted = trade.tokensSold.toLocaleString(undefined, { maximumFractionDigits: 0 });
                    console.log(`      ${i + 1}. ${trade.action}: ${tokensFormatted} tokens (${trade.percentage.toFixed(1)}%) at $${trade.sellPrice.toFixed(6)} = ${trade.solReceived.toFixed(4)} SOL`);
                });
                
            } else {
                console.log(`❌ Failed to get ATH data`);
                this.results.failed++;
            }
            
            this.results.analyzed++;
            
        } catch (error) {
            console.error(`❌ Error analyzing token record:`, error.message);
            this.results.failed++;
        }
    }

    updateTradingResults(tradingSimulation) {
        this.results.tradingResults.totalInvested += this.INVESTMENT_SIZE;
        this.results.tradingResults.totalReceived += tradingSimulation.totalReceived;
        
        if (tradingSimulation.netProfit > 0) {
            this.results.tradingResults.totalProfit += tradingSimulation.netProfit;
            this.results.tradingResults.profitableTradesCount++;
        } else {
            this.results.tradingResults.totalLoss += Math.abs(tradingSimulation.netProfit);
            this.results.tradingResults.lossTradesCount++;
        }
        
        this.results.tradingResults.netProfit = this.results.tradingResults.totalProfit - this.results.tradingResults.totalLoss;
        
        const totalTrades = this.results.tradingResults.profitableTradesCount + this.results.tradingResults.lossTradesCount;
        this.results.tradingResults.winRate = totalTrades > 0 ? 
            (this.results.tradingResults.profitableTradesCount / totalTrades * 100) : 0;
            
        this.results.tradingResults.roi = this.results.tradingResults.totalInvested > 0 ?
            (this.results.tradingResults.netProfit / this.results.tradingResults.totalInvested * 100) : 0;
    }

    async getDailyATHOverview(tokenAddress) {
        try {
            const query = `
                query GetDailyATH($symbol: String!, $from: Int!, $to: Int!) {
                    getBars(
                        symbol: $symbol
                        from: $from
                        to: $to
                        resolution: "1D"
                        removeLeadingNullValues: true
                        currencyCode: "USD"
                    ) {
                        t
                        h
                    }
                }
            `;

            const currentTime = Math.floor(Date.now() / 1000);
            const fromTime = currentTime - (1095 * 24 * 60 * 60);

            const variables = {
                symbol: `${tokenAddress}:1399811149`,
                from: fromTime,
                to: currentTime
            };

            const response = await axios.post(this.codexApiUrl, {
                query,
                variables
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.codexApiKey,
                },
                timeout: 30000
            });

            if (response.data.errors) {
                console.log(`   ❌ Daily overview errors:`, response.data.errors);
                return null;
            }

            const bars = response.data.data?.getBars;
            if (!bars || !bars.h || bars.h.length === 0) {
                console.log(`   ❌ No daily data available`);
                return null;
            }

            let maxPrice = 0;
            let maxIndex = -1;
            
            for (let i = 0; i < bars.h.length; i++) {
                if (bars.h[i] > maxPrice) {
                    maxPrice = bars.h[i];
                    maxIndex = i;
                }
            }

            console.log(`   📊 Daily overview: ATH ~${maxPrice.toFixed(8)} (${bars.h.length} days analyzed)`);

            return {
                price: maxPrice,
                athTimestamp: bars.t[maxIndex]
            };

        } catch (error) {
            console.log(`   ❌ Error in daily overview: ${error.message}`);
            return null;
        }
    }

    async getPreciseATHAround(tokenAddress, athTimestamp) {
        try {
            const bufferHours = 12;
            const fromTime = athTimestamp - (bufferHours * 60 * 60);
            const toTime = athTimestamp + (bufferHours * 60 * 60);

            console.log(`   🎯 Getting precise 1-minute data around ATH period...`);

            const query = `
                query GetPreciseATH($symbol: String!, $from: Int!, $to: Int!) {
                    getBars(
                        symbol: $symbol
                        from: $from
                        to: $to
                        resolution: "1"
                        removeLeadingNullValues: true
                        currencyCode: "USD"
                    ) {
                        h
                    }
                }
            `;

            const variables = {
                symbol: `${tokenAddress}:1399811149`,
                from: fromTime,
                to: toTime
            };

            const response = await axios.post(this.codexApiUrl, {
                query,
                variables
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.codexApiKey,
                },
                timeout: 30000
            });

            if (response.data.errors) {
                console.log(`   ⚠️ Precision data not available, using daily ATH`);
                return null;
            }

            const bars = response.data.data?.getBars;
            if (!bars || !bars.h || bars.h.length === 0) {
                console.log(`   ⚠️ No 1-minute data, using daily ATH`);
                return null;
            }

            const preciseATH = Math.max(...bars.h.filter(price => price > 0));
            
            console.log(`   ✅ Precise ATH: ${preciseATH.toFixed(8)} (from ${bars.h.length} 1-minute bars)`);
            
            return preciseATH;

        } catch (error) {
            console.log(`   ⚠️ Precision lookup failed, using daily ATH: ${error.message}`);
            return null;
        }
    }

    async getATHSimple(tokenAddress) {
        try {
            if (!this.codexApiKey) {
                throw new Error('CODEX_API_KEY not found in environment variables');
            }

            console.log(`   📈 Fetching ATH with smart pagination for precision...`);

            const dailyATH = await this.getDailyATHOverview(tokenAddress);
            if (!dailyATH) {
                return null;
            }

            const preciseATH = await this.getPreciseATHAround(tokenAddress, dailyATH.athTimestamp);
            
            return preciseATH || dailyATH.price;

        } catch (error) {
            console.log(`   ❌ Error getting ATH: ${error.message}`);
            return null;
        }
    }

    calculatePerformanceMetrics(ath) {
        if (!ath || ath === 0) {
            return {
                maxGainPercent: null,
                signalQuality: 'unknown'
            };
        }

        const maxGainPercent = ((ath - this.FIXED_ENTRY_PRICE) / this.FIXED_ENTRY_PRICE) * 100;
        
        let signalQuality = 'poor';
        if (maxGainPercent > 1000) signalQuality = 'excellent';
        else if (maxGainPercent > 500) signalQuality = 'great';
        else if (maxGainPercent > 100) signalQuality = 'good';
        else if (maxGainPercent > 50) signalQuality = 'fair';

        return {
            maxGainPercent,
            signalQuality
        };
    }

    generateReport() {
        console.log('\n📊 ENHANCED ATH PERFORMANCE REPORT WITH CORRECTED TRADING SIMULATION');
        console.log('='.repeat(80));
        
        console.log(`\n📈 Overall Statistics:`);
        console.log(`   Total tokens analyzed: ${this.results.analyzed}`);
        console.log(`   Successful analyses: ${this.results.successful}`);
        console.log(`   Failed analyses: ${this.results.failed}`);
        console.log(`   Fixed entry price: $${this.FIXED_ENTRY_PRICE}`);
        console.log(`   Investment per token: ${this.INVESTMENT_SIZE} SOL`);
        
        if (this.results.tokens.length === 0) {
            console.log('\n❌ No successful analyses to report');
            return;
        }

        // Trading Results Summary
        const tr = this.results.tradingResults;
        console.log(`\n💰 CORRECTED TRADING SIMULATION RESULTS:`);
        console.log(`   Total Invested: ${tr.totalInvested.toFixed(2)} SOL`);
        console.log(`   Total Received: ${tr.totalReceived.toFixed(4)} SOL`);
        console.log(`   Gross Profit: ${tr.totalProfit.toFixed(4)} SOL`);
        console.log(`   Total Losses: ${tr.totalLoss.toFixed(4)} SOL`);
        console.log(`   Net Profit: ${tr.netProfit >= 0 ? '+' : ''}${tr.netProfit.toFixed(4)} SOL`);
        console.log(`   ROI: ${tr.roi >= 0 ? '+' : ''}${tr.roi.toFixed(2)}%`);
        console.log(`   Win Rate: ${tr.winRate.toFixed(1)}% (${tr.profitableTradesCount}/${tr.profitableTradesCount + tr.lossTradesCount})`);
        
        // Calculate additional metrics
        const avgProfitPerWin = tr.profitableTradesCount > 0 ? tr.totalProfit / tr.profitableTradesCount : 0;
        const avgLossPerLoss = tr.lossTradesCount > 0 ? tr.totalLoss / tr.lossTradesCount : 0;
        const profitFactor = tr.totalLoss > 0 ? tr.totalProfit / tr.totalLoss : 'N/A';
        
        console.log(`   Average Profit per Win: ${avgProfitPerWin.toFixed(4)} SOL`);
        console.log(`   Average Loss per Loss: ${avgLossPerLoss.toFixed(4)} SOL`);
        console.log(`   Profit Factor: ${typeof profitFactor === 'number' ? profitFactor.toFixed(2) : profitFactor}`);

        // Sort by trading profit
        const sortedByProfit = this.results.tokens
            .filter(t => t.tradingSimulation)
            .sort((a, b) => b.tradingSimulation.netProfit - a.tradingSimulation.netProfit);

        console.log(`\n🏆 Most Profitable Trades:`);
        sortedByProfit.slice(0, 10).forEach((token, i) => {
            const sim = token.tradingSimulation;
            const gain = token.performanceMetrics.maxGainPercent;
            const roi = ((sim.netProfit / this.INVESTMENT_SIZE) * 100);
            console.log(`   ${i + 1}. ${token.symbol} - ${sim.netProfit >= 0 ? '+' : ''}${sim.netProfit.toFixed(4)} SOL (${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%)`);
            console.log(`      ATH: ${gain.toFixed(2)}% | Received: ${sim.totalReceived.toFixed(4)} SOL | Twitter: ${token.twitterMetrics.likes} likes`);
        });

        console.log(`\n💸 Worst Performing Trades:`);
        sortedByProfit.slice(-5).reverse().forEach((token, i) => {
            const sim = token.tradingSimulation;
            const gain = token.performanceMetrics.maxGainPercent;
            const roi = ((sim.netProfit / this.INVESTMENT_SIZE) * 100);
            console.log(`   ${i + 1}. ${token.symbol} - ${sim.netProfit.toFixed(4)} SOL (${roi.toFixed(1)}%)`);
            console.log(`      ATH: ${gain.toFixed(2)}% | Received: ${sim.totalReceived.toFixed(4)} SOL | Twitter: ${token.twitterMetrics.likes} likes`);
        });

        // Outcome distribution
        const outcomes = {};
        this.results.tokens.forEach(token => {
            if (token.tradingSimulation) {
                const outcome = token.tradingSimulation.outcome;
                outcomes[outcome] = (outcomes[outcome] || 0) + 1;
            }
        });

        console.log(`\n📊 Trading Outcomes Distribution:`);
        Object.entries(outcomes).forEach(([outcome, count]) => {
            const percentage = ((count / this.results.successful) * 100).toFixed(1);
            console.log(`   ${outcome}: ${count} trades (${percentage}%)`);
        });

        // ROI distribution
        const roiRanges = {
            'Losses (-100% to 0%)': 0,
            'Small Gains (0% to 50%)': 0,
            'Good Gains (50% to 100%)': 0,
            'Great Gains (100% to 200%)': 0,
            'Excellent Gains (200%+)': 0
        };

        this.results.tokens.forEach(token => {
            if (token.tradingSimulation) {
                const roi = (token.tradingSimulation.netProfit / this.INVESTMENT_SIZE) * 100;
                if (roi < 0) roiRanges['Losses (-100% to 0%)']++;
                else if (roi < 50) roiRanges['Small Gains (0% to 50%)']++;
                else if (roi < 100) roiRanges['Good Gains (50% to 100%)']++;
                else if (roi < 200) roiRanges['Great Gains (100% to 200%)']++;
                else roiRanges['Excellent Gains (200%+)']++;
            }
        });

        console.log(`\n📈 ROI Distribution:`);
        Object.entries(roiRanges).forEach(([range, count]) => {
            const percentage = ((count / this.results.successful) * 100).toFixed(1);
            console.log(`   ${range}: ${count} trades (${percentage}%)`);
        });

        this.exportResults();
    }

    async exportResults() {
        try {
            const filename = `corrected_ath_trading_analysis_${new Date().toISOString().split('T')[0]}.json`;
            const filepath = path.join(this.scanResultsDir, filename);
            
            const exportData = {
                summary: {
                    ...this.results.tradingResults,
                    analyzed: this.results.analyzed,
                    successful: this.results.successful,
                    failed: this.results.failed,
                    fixedEntryPrice: this.FIXED_ENTRY_PRICE,
                    investmentPerTrade: this.INVESTMENT_SIZE,
                    avgProfitPerWin: this.results.tradingResults.profitableTradesCount > 0 ? 
                        this.results.tradingResults.totalProfit / this.results.tradingResults.profitableTradesCount : 0,
                    avgLossPerLoss: this.results.tradingResults.lossTradesCount > 0 ? 
                        this.results.tradingResults.totalLoss / this.results.tradingResults.lossTradesCount : 0,
                    profitFactor: this.results.tradingResults.totalLoss > 0 ? 
                        this.results.tradingResults.totalProfit / this.results.tradingResults.totalLoss : null
                },
                tradingStrategy: {
                    entryPrice: this.FIXED_ENTRY_PRICE,
                    investmentSize: this.INVESTMENT_SIZE,
                    firstTakeProfitMultiplier: this.FIRST_TAKE_PROFIT_MULTIPLIER,
                    secondTakeProfitMultiplier: this.SECOND_TAKE_PROFIT_MULTIPLIER,
                    firstSellPercentage: this.FIRST_SELL_PERCENTAGE,
                    secondSellPercentage: this.SECOND_SELL_PERCENTAGE,
                    stopLossMultiplier: this.STOP_LOSS_MULTIPLIER,
                    trailingStopPrice: this.TRAILING_STOP_PRICE
                },
                tokens: this.results.tokens.map(token => ({
                    symbol: token.symbol,
                    address: token.address,
                    scanDate: token.scanTimestamp,
                    twitterLikes: token.twitterMetrics.likes,
                    twitterViews: token.twitterMetrics.views,
                    entryPrice: this.FIXED_ENTRY_PRICE,
                    ath: token.ath,
                    maxGainPercent: token.performanceMetrics.maxGainPercent,
                    signalQuality: token.performanceMetrics.signalQuality,
                    totalReceived: token.tradingSimulation.totalReceived,
                    netProfit: token.tradingSimulation.netProfit,
                    roi: (token.tradingSimulation.netProfit / this.INVESTMENT_SIZE) * 100,
                    tradingOutcome: token.tradingSimulation.outcome,
                    tradeDetails: token.tradingSimulation.tradeDetails
                }))
            };
            
            await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
            console.log(`\n💾 Corrected results exported to: ${filename}`);
            
        } catch (error) {
            console.error('❌ Error exporting results:', error.message);
        }
    }
}

// Usage
async function main() {
    console.log('🚀 Enhanced ATH Performance Analysis with CORRECTED Trading Simulation');
    console.log('====================================================================');
    console.log('✅ Fixed calculation: Total received = All sales combined');
    console.log('✅ Net profit = Total received - Initial investment');
    console.log('✅ Moonbag at breakeven contributes to total received\n');
    
    const analyzer = new EnhancedATHAnalyzer();
    await analyzer.analyzeScanResults();
}

// Export for use as module
module.exports = EnhancedATHAnalyzer;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    });
}