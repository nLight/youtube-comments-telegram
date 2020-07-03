# Send YouTube Comments to Telegram

FOMO is not allowed. Configure the bot to check your YouTube channel periodically and send all the new comments your way. No need to be checking comments compulsively. No need to enable YouTube's native notification.

Be in control.

## Setup

Add something like this to the `cron``

```
0 7 * * * BOT_TOKEN= TELEGRAM_CHAT_ID= GOOGLE_API_KEY= YOUTUBE_CHANNEL_ID= node index.js
```

It stores the comment ids it has sent in an Sqlite3 database and will not send them twice.

### Required ENV variables

```
BOT_TOKEN=
TELEGRAM_CHAT_ID=
GOOGLE_API_KEY=
YOUTUBE_CHANNEL_ID=
```

### Optional ENV variables

```
SENTRY_DSN=
```

## Features

1. **i18n**: русский, english

### Roadmap

1. Reply to comments repying to Telegram messages
2. Treshold. Don't notify about emoji comments
3. Stop list. Don't notify about certain people's messages.
4. Load more comments if the first page is all new.
5. Filters: subscribers / members
6. Track replies
