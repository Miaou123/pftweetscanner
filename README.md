# ========================================
// 4. README.md
// ========================================

# Twitter Token Bot

Automated Twitter bot for Solana token analysis and posting alerts about suspicious activities like bundle trading, fresh wallet coordination, and team supply manipulation.

## 🚀 Features

- **Real-time Token Discovery**: Automatically discovers new Solana tokens
- **Advanced Analysis**: Detects bundle trading, fresh wallet coordination, team supply concentration
- **Smart Content Generation**: Creates engaging Twitter posts with relevant alerts
- **Rate Limit Management**: Respects Twitter API limits with intelligent scheduling
- **Risk Scoring**: Assigns risk scores to tokens based on multiple factors
- **Database Storage**: Tracks all analyses and posts for performance monitoring

## 📋 Prerequisites

- Node.js 18+
- MongoDB database
- Twitter Developer Account with API v2 access
- Helius API key for Solana data
- Defined API key for transaction data
- GMGN API key for token information

## 🛠️ Installation

1. **Clone or create the project**:
   ```bash
   # If using the setup script:
   node setup.js
   cd twitter-token-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and configuration
   ```

4. **Set up database**:
   ```bash
   npm run setup-db
   ```

## ⚙️ Configuration

Edit your `.env` file with the following required values:

```env
# Twitter API Configuration
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# Solana Configuration
HELIUS_RPC_URL=your_helius_rpc_url_with_api_key

# Database
MONGODB_URI=mongodb://localhost:27017/twitter-token-bot

# Analysis Settings
MIN_MARKET_CAP=10000
MIN_LIQUIDITY=5000
MAX_TOKEN_AGE_HOURS=24
ANALYSIS_INTERVAL_MINUTES=15
```

## 🚀 Usage

**Development mode**:
```bash
npm run dev
```

**Production mode**:
```bash
npm start
```

**Run tests**:
```bash
npm test
```

## 📊 Analysis Types

### Bundle Detection
- Identifies coordinated buying activity
- Detects multiple wallets buying simultaneously
- Calculates percentage of supply acquired through bundles

### Fresh Wallet Analysis
- Finds wallets with minimal transaction history
- Tracks coordinated fresh wallet activity
- Calculates supply concentration in fresh wallets

### Top Holder Analysis
- Analyzes wallet concentration
- Identifies high-value wallets vs fresh addresses
- Calculates supply distribution metrics

## 🐦 Twitter Integration

The bot automatically generates and posts:

- **New Token Alerts**: High-risk tokens with analysis summary
- **Bundle Alerts**: When significant bundle activity is detected
- **Team Supply Alerts**: When fresh wallets control large supply percentages

## 📈 Risk Scoring

Tokens are assigned risk scores (0-100) based on:
- Bundle activity level
- Fresh wallet concentration
- Top holder distribution
- Market cap and liquidity

## 🔧 Customization

### Content Templates
Edit `src/config/twitter.js` to customize tweet templates and hashtags.

### Analysis Parameters
Modify `src/config/index.js` to adjust detection thresholds and analysis criteria.

### Posting Schedule
Configure posting frequency and rate limits in the configuration files.

## 📝 Logging

Logs are stored in the `logs/` directory:
- `combined-*.log`: All application logs
- `error-*.log`: Error logs only

## 🛡️ Safety Features

- **Rate Limiting**: Respects Twitter API limits
- **Error Handling**: Comprehensive error handling and retry logic
- **Data Validation**: Validates all inputs and API responses
- **Graceful Shutdown**: Properly closes connections on exit

## 📊 Monitoring

Check bot status and performance:
- Database stores all analyses and posts
- Logs provide detailed operation information
- Queue status available through internal APIs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## ⚠️ Disclaimer

This bot is for educational and research purposes. Always comply with:
- Twitter's Terms of Service
- API usage guidelines
- Applicable laws and regulations
- Financial advice regulations

## 🆘 Support

For issues and questions:
1. Check the logs in the `logs/` directory
2. Review configuration in `.env` file
3. Ensure all API keys are valid
4. Check database connectivity

## 🔄 Updates

To update the bot:
```bash
git pull origin main
npm install
npm start
```

---

Built with ❤️ for the Solana community