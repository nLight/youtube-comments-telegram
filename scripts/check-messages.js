const { google } = require("googleapis");
const Telegram = require("telegraf/telegram");
const i18n = require("i18n");
const sqlite3 = require("sqlite3");
const lodash = require("lodash");
const Sentry = require("@sentry/node");

// Setup =======================================================================

i18n.configure({
  defaultLocale: "ru",
  locales: ["ru", "en"],
  directory: __dirname + "/locales",
});

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

const missingEnv = ["BOT_TOKEN", "GOOGLE_API_KEY"].filter(
  (e) => !process.env[e]
);

const { BOT_TOKEN, GOOGLE_API_KEY } = process.env;

if (missingEnv.length > 0) {
  console.error("Missing ENV var:", missingEnv.join(", "));
  process.exit(1);
}

// Main ========================================================================

const telegram = new Telegram(BOT_TOKEN, {}, false);
const youtubeApi = google.youtube({
  version: "v3",
  auth: GOOGLE_API_KEY,
});

const db = new sqlite3.Database(__dirname + "/database");
const dbRun = (query, params = []) =>
  new Promise((resolve, reject) => {
    db.run(query, params, (err) => {
      if (err) return reject(err);
      resolve(this);
    });
  });

const dbAll = (query, params = []) =>
  new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

initDatabase()
  .then(() => dbAll("SELECT * FROM youtube_channels"))
  .then((channels) => channels.map(notifyChannel))
  .then(() => console.log("Done"))
  .catch((err) => console.error("error:", err))
  .finally(() => db.close());

// =============================================================================

function initDatabase() {
  return dbRun(
    `
      CREATE TABLE IF NOT EXISTS comments (channel_id TEXT, comment_id TEXT PRIMARY KEY, timestamp INTEGER) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS youtube_channels (channel_id TEXT, telegram_chat_id TEXT, locale TEXT DEFAULT "ru", PRIMARY KEY ( channel_id, telegram_chat_id)) WITHOUT ROWID;
      `
  );
}

function notifyChannel({ channel_id, telegram_chat_id, locale }) {
  const seenComments = dbAll(
    "SELECT * FROM comments WHERE channel_id = ? ORDER BY timestamp DESC LIMIT 5",
    [channel_id]
  ).then((rows) => rows.map((row) => row.comment_id));

  const latestComments = youtubeApi.commentThreads
    .list({
      part: ["snippet"],
      allThreadsRelatedToChannelId: channel_id,
      moderationStatus: "published",
      maxResults: 100,
    })
    .then(({ data }) => data.items);

  const newComments = Promise.all([seenComments, latestComments]).then(
    takeNewComments(channel_id)
  );

  const videoTitles = newComments
    .then(fetchVideos)
    .then((videos) =>
      videos.reduce(
        (acc, curr) => Object.assign(acc, { [curr.id]: curr.snippet.title }),
        {}
      )
    );

  return Promise.all([newComments, videoTitles]).then(
    notify(telegram_chat_id, locale)
  );
}

const takeNewComments = (channelId) => ([seenComments, latestComments]) => {
  const seenCommentsSet = new Set(seenComments);
  const newComments = lodash.takeWhile(
    latestComments,
    ({ snippet }) => !seenCommentsSet.has(snippet.topLevelComment.id)
  );

  if (newComments.length > 0) {
    const stmt = db.prepare("INSERT INTO comments VALUES (?, ?, ?)");
    newComments.forEach(({ snippet }) => {
      stmt.run(channelId, snippet.topLevelComment.id, Date.now());
    });
    stmt.finalize();
  }

  return newComments;
};

function fetchVideos(comments) {
  const videoIds = comments.map(
    ({ snippet }) => snippet.topLevelComment.snippet.videoId
  );

  return videoIds.length === 0
    ? Promise.resolve([])
    : youtubeApi.videos
        .list({ part: ["snippet"], id: lodash.uniq(videoIds) })
        .then(({ data }) => data.items);
}

const notify = (telegramChatId, locale) => ([comments, videoTitles]) => {
  const messageOptions = {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  if (comments.length === 0) {
    return telegram.sendMessage(
      telegramChatId,
      i18n.__({ phrase: "No new comments", locale }),
      messageOptions
    );
  }

  const promises = comments.map(({ snippet: { topLevelComment } }, i) => {
    const message = i18n.__(
      { phrase: "newCommentMessage", locale },
      {
        commentId: topLevelComment.id,
        videoTitle: videoTitles[topLevelComment.snippet.videoId],
        ...topLevelComment.snippet,
      }
    );

    return new Promise((resolve, reject) => {
      // Telegram API Rate Limiting workaround. 1 message per second
      setTimeout(
        () =>
          telegram
            .sendMessage(telegramChatId, message, messageOptions)
            .then(resolve)
            .catch(reject),
        i * 1000
      );
    });
  });

  return Promise.all(promises);
};
