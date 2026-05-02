# 🧠 Amygdalé — Financial Dashboard & Risk Control

> *"Finance is tied to impulse control and economic survival; Amygdalé is the center of that control."*

**Amygdalé** (from the Greek *amygdalē*, meaning amygdala) is a personal financial dashboard built on a **Local-First** and **Security-First** philosophy. It centralizes portfolio tracking, risk metrics, and market data entirely in your browser, enabling clear, emotion-free financial decisions without relying on external accounts or cloud databases.

🔗 **Live Demo:** https://amygdale.netlify.app  
📦 **Repository:** https://github.com/Neymors/Amygdale

---

## ✨ Core Features

| Feature | Description |
|---------|-------------|
| **Multi-Asset Tracking** | Real-time prices for Argentine bonds (BYMA), local/global stocks (Yahoo Finance), and crypto (CoinGecko) |
| **MEP Dollar Conversion** | Automatic ARS → USD conversion using live MEP rates via `dolarapi.com` |
| **Portfolio Metrics** | Total value, P&L, weighted daily change, best performer, allocation %, and holding period |
| **Interactive Charts** | Donut chart for asset distribution + line chart for historical performance vs. benchmark (1M, 6M, YTD, 1Y) |
| **Daily Snapshots** | Automatic `localStorage` history saving for accurate long-term tracking |
| **Local Encryption** | AES-256-GCM via Web Crypto API with user-defined passphrase (PBKDF2, 200k iterations) |
| **Backup & Restore** | One-click JSON export/import for positions + historical data |
| **Smart Auto-Refresh** | 7-minute price updates, paused when Buenos Aires markets are closed |
| **Precision Formatting** | Strict 2-decimal enforcement across all values + PER calculation safeguards against division-by-zero artifacts |

---

## 🛠️ Tech Stack & Architecture

| Layer | Technology |
|-------|------------|
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| **Charts** | Chart.js 4.x (CDN) |
| **Security** | Web Crypto API (AES-GCM / PBKDF2) |
| **Persistence** | `localStorage` (positions, cache, history, encryption keys) |
| **Hosting** | Netlify (static SPA + serverless proxy for CORS) |
| **APIs** | BYMA Open Data, Yahoo Finance v8, CoinGecko, DolarApi |

**Architecture Highlights:**
- 100% client-side execution. Zero backend dependencies.
- TTL-based price caching (5 min) to minimize API calls.
- Modular state management (`State` object) with predictable render cycles.
- Graceful fallbacks for offline states, failed fetches, or empty portfolios.

---

## 🔐 Privacy & Security

- **Local-First Focus:** All data remains in your browser. No accounts, no telemetry, no cloud sync.
- **Client-Side Encryption:** Your passphrase never leaves your device. Keys are derived locally using PBKDF2.
- **Export/Import Control:** Full ownership of your data via JSON backups. You decide when and where to store it.
- **Market-Aware Refresh:** Auto-updates respect Buenos Aires trading hours to avoid unnecessary requests or stale data.

> ⚠️ **Note:** If encryption is enabled and the passphrase is lost, the portfolio cannot be recovered. This is an intentional design choice for maximum privacy.

---

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/Neymors/Amygdale.git
cd Amygdale

# Run locally (requires CORS proxy for APIs)
npx serve .
# or use Live Server in VS Code
```

**Production Deployment:**  
Connect the repository to Netlify. The included `netlify.toml` handles:
- SPA routing fallback
- `/api/proxy` → Netlify Function mapping
- Security headers & CORS configuration

---

## 📜 License & Philosophy

This project is open for personal use and learning. If you plan to use it commercially or as a base for another product, please reach out first.

*"Control is not restriction; it's freedom."*  
                                                **Built with ❤️ in Mar del Plata, Argentina 🇦🇷**
