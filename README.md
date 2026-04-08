# Hero Siege Companion

A desktop companion app for [Hero Siege](https://store.steampowered.com/app/269210/Hero_Siege/). Browse quests, items, runewords, runes, track live game stats, and organize your progression with custom presets — all in a compact always-on-top window.

## Prerequisites

**Npcap is required** for live stats (gold, XP, items, satanic zones). Install it before running the app:

- [Npcap downloads page](https://npcap.com/#download) | [Direct link](https://npcap.com/dist/npcap-1.77.exe)

> This app passively reads network packets between the game and its server to display stats. It does not modify any game data. Use at your own discretion — the author is not responsible for any issues that may arise from its use.

## How to use

1. Install [Npcap](https://npcap.com/#download)
2. Download `HeroSiegeCompanion.exe` from the [latest release](https://github.com/kevinbarfleur/hero-siege-companion/releases)
3. Run it — the app starts as a small always-on-top window
4. Launch Hero Siege and play. Stats update in real time

## Features

### Quest & Item Database
- Browse all quests, items, runewords and runes from the game
- Data fetched from [hero-siege-helper.vercel.app](https://hero-siege-helper.vercel.app/) and cached locally for offline use
- Search and filter items by rarity, type, element, stat/affix, level
- Runewords with full rune details and compatible item types

### Presets
- Create custom presets to organize your quest progression
- Pin quests from the database — add a single quest or an entire questline
- Arrange quests in categories with drag ordering
- Add personal notes (rich text) between quests
- Multiple presets with import/export as JSON

### Live Stats
- **Character** — name, level, difficulty, kill counts
- **Gold** — total, earned this session, per hour
- **XP** — total, earned this session, per hour
- **Items** — drops by rarity (Angelic, Unholy, Heroic, Satanic) with Magic Find count
- **Satanic Zone** — current zone name with buff names and full effect descriptions
- **Session** — duration and mail notification
- Pin any stat to the pill mode overlay

### Pill Mode
- Collapse the app to a small pill overlay
- Pinned stats displayed directly on the pill (satanic zone with buffs, gold, XP...)
- Click to expand back to full app, auto-collapse when mouse leaves
- Configurable anchor corner (top-left, top-right, bottom-left, bottom-right)

## Limitations

- Gold picked up from mailbox is counted as earned
- XP can be slightly off when leveling up
- Items moved between inventories are counted as picked up
- Satanic zone data updates when the server broadcasts it (~every 2-5 minutes)

## Credits

- Game data provided by [hero-siege-helper.vercel.app](https://hero-siege-helper.vercel.app/) — huge thanks to the maintainers
- Live stats system inspired by [Hero Siege Stats](https://github.com/GuilhermeFaga/hero-siege-stats) by Guilherme Faga
- Built with [pywebview](https://pywebview.flowrl.com/) and [Scapy](https://scapy.net/)

## For developers

### Requirements
- Python 3.11+
- [Npcap](https://npcap.com/#download)

### Running from source
```bash
git clone git@github.com:kevinbarfleur/hero-siege-companion.git
cd hero-siege-companion
python -m venv .venv
.venv\Scripts\activate
pip install pywebview beautifulsoup4 requests scapy psutil
python hero-siege-quests.py
```

### Building
```bash
pip install pyinstaller
pyinstaller HeroSiegeQuests.spec
```
The executable will be in the `dist/` folder.
