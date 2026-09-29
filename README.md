# Omarchy Parsi Bot

A small Telegram bot for the Persian Omarchy community.

The bot automatically checks the official Omarchy news feed, translates new posts into Persian with Gemini, and publishes them to the `News` topic in the Omarchy Parsi Telegram group.

## What it does

- Checks the official Omarchy RSS feed every 12 hours.
- Detects new news posts.
- Translates the title and description into natural Persian using Gemini.
- Keeps technical names such as `Omarchy`, `Hyprland`, and `ThePrimeagen` in English.
- Formats Persian posts as RTL for Telegram.
- Falls back to the original English text if Gemini is unavailable.
- Posts the original Omarchy article link.
- Adds a link back to the Omarchy Parsi Telegram community.
- Remembers the latest processed news item so the same post is not sent twice.

## How it works

```text
Omarchy RSS
    ↓
GitHub Actions
    ↓
Check for new posts
    ↓
Gemini translation
    ↓
Telegram News topic
```

The bot runs through GitHub Actions using a scheduled workflow.

The current schedule is:

```text
Every 12 hours
```

The latest processed RSS item is stored in:

```text
state.json
```

GitHub Actions updates this file automatically after a new article is posted.

## Translation fallback

The bot tries multiple Gemini models for translation.

If translation succeeds:

```text
Persian translation
→ RTL Telegram message
```

If Gemini is unavailable:

```text
Original English text
→ LTR Telegram message
```

The original Omarchy article link is included in every post.

## Environment variables

The GitHub Actions workflow requires these repository secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TELEGRAM_TOPIC_ID
GEMINI_API_KEY
```

Never commit API keys or bot tokens directly to the repository.

## Community

Telegram:

https://t.me/OmarchyParsi

Bot:

`@OmarchyParsiBot`

## Tech

- JavaScript
- Node.js
- GitHub Actions
- Telegram Bot API
- Gemini API
- fast-xml-parser

## Purpose

This project currently handles Omarchy news, but `Omarchy Parsi Bot` is intentionally kept general so more community features can be added later.

```

```
