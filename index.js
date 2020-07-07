const { google } = require("googleapis");
const Telegram = require("telegraf/telegram");
const i18n = require("i18n");
const sqlite3 = require("sqlite3");
const lodash = require("lodash");
const Sentry = require("@sentry/node");

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

const missingEnv = [
  "BOT_TOKEN",
  "GOOGLE_API_KEY",
  "YOUTUBE_CHANNEL_ID",
  "TELEGRAM_CHAT_ID",
].filter((e) => !process.env[e]);

const {
  BOT_TOKEN,
  GOOGLE_API_KEY,
  YOUTUBE_CHANNEL_ID,
  TELEGRAM_CHAT_ID,
} = process.env;

if (missingEnv.length > 0) {
  console.error("Missing ENV var:", missingEnv.join(", "));
  process.exit(1);
}

const db = new sqlite3.Database(__dirname + "/database");

db.serialize(function () {
  db.run(
    "CREATE TABLE IF NOT EXISTS comments (channel_id TEXT, comment_id TEXT PRIMARY KEY, timestamp INTEGER) WITHOUT ROWID"
  );
});

const telegram = new Telegram(BOT_TOKEN, {}, false);

const seenComments = new Promise((resolve, reject) => {
  db.all(
    "SELECT * FROM comments WHERE channel_id = ? ORDER BY timestamp DESC LIMIT 5",
    YOUTUBE_CHANNEL_ID,
    (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map((row) => row.comment_id));
    }
  );
});

const latestComments = google
  .youtube({ version: "v3", auth: GOOGLE_API_KEY || "" })
  .commentThreads.list({
    part: ["snippet"],
    allThreadsRelatedToChannelId: YOUTUBE_CHANNEL_ID,
    moderationStatus: "published",
    maxResults: 100,
  })
  .then(({ data }) => data.items);

const newComments = Promise.all([seenComments, latestComments]).then(
  takeNewComments
);

const videoTitles = newComments
  .then(fetchVideos)
  .then((videos) =>
    videos.reduce(
      (acc, curr) => Object.assign(acc, { [curr.id]: curr.snippet.title }),
      {}
    )
  );

Promise.all([newComments, videoTitles])
  .then(notify)
  .then((response) => console.log(response))
  .catch((err) => console.error(err));

// ======================================================================

function takeNewComments([seenComments, latestComments]) {
  const seenCommentsSet = new Set(seenComments);
  const newComments = lodash.takeWhile(
    latestComments,
    ({ snippet }) => !seenCommentsSet.has(snippet.topLevelComment.id)
  );

  if (newComments.length > 0) {
    const stmt = db.prepare("INSERT INTO comments VALUES (?, ?, ?)");
    newComments.forEach(({ snippet }) => {
      stmt.run(YOUTUBE_CHANNEL_ID, snippet.topLevelComment.id, Date.now());
    });
    stmt.finalize();
  }

  return newComments;
}

function fetchVideos(comments) {
  const videoIds = comments.map(
    ({ snippet }) => snippet.topLevelComment.snippet.videoId
  );

  return videoIds.length === 0
    ? Promise.resolve([])
    : google
        .youtube({ version: "v3", auth: GOOGLE_API_KEY || "" })
        .videos.list({ part: ["snippet"], id: lodash.uniq(videoIds) })
        .then(({ data }) => data.items);
}

function notify([comments, videoTitles]) {
  if (comments.length === 0) {
    return telegram.sendMessage(TELEGRAM_CHAT_ID, i18n.__("No new comments"), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  const options = {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  const promises = comments.map(({ snippet: { topLevelComment } }, i) => {
    const message = i18n.__("newCommentMessage", {
      commentId: topLevelComment.id,
      videoTitle: videoTitles[topLevelComment.snippet.videoId],
      ...topLevelComment.snippet,
    });

    return new Promise((resolve, reject) => {
      // Telegram API Rate Limiting workaround. 1 message per second
      setTimeout(
        () =>
          telegram
            .sendMessage(TELEGRAM_CHAT_ID, message, options)
            .then(resolve)
            .catch(reject),
        i * 1000
      );
    });
  });

  return Promise.all(promises);
}
