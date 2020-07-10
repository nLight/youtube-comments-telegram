const { Telegraf } = require("telegraf");
const i18n = require("i18n");
const sqlite3 = require("sqlite3");
const Sentry = require("@sentry/node");
const { drive } = require("googleapis/build/src/apis/drive");

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

const missingEnv = ["PORT", "BOT_TOKEN", "DOMAIN"].filter(
  (e) => !process.env[e]
);

const { PORT, BOT_TOKEN, NODE_ENV, DOMAIN } = process.env;

if (missingEnv.length > 0) {
  console.error("Missing ENV var:", missingEnv.join(", "));
  process.exit(1);
}

const db = new sqlite3.Database("/storage/database");
db.run(
  `CREATE TABLE IF NOT EXISTS comments
  (channel_id TEXT, comment_id TEXT PRIMARY KEY, timestamp INTEGER)
  WITHOUT ROWID`,
  (err) => console.error(err)
);
db.run(
  `CREATE TABLE IF NOT EXISTS youtube_channels
  (channel_id TEXT, telegram_chat_id TEXT,
    locale TEXT DEFAULT "ru", PRIMARY KEY ( channel_id, telegram_chat_id))
    WITHOUT ROWID`,
  (err) => console.error(err)
);

// Main ========================================================================

const bot = new Telegraf(BOT_TOKEN, {
  telegram: {
    webhookReply: NODE_ENV === "production",
  },
});

bot.catch((err) => console.error(err));

bot.on("text", (ctx) => {
  const matches = ctx.message.text.match(/добавь (.*)/);
  if (matches && matches[1]) {
    return new Promise((resolve, reject) => {
      db.run(
        "INSERT INTO youtube_channels (channel_id, telegram_chat_id) VALUES (?, ?)",
        [matches[1], ctx.chat.id],
        (err) => {
          if (err) {
            ctx.reply(`Что-то пошло не так :(\n${err.message}`);
            reject(err.message);
          } else {
            ctx.reply("Канал добавлен!");
            resolve();
          }
        }
      );
    });
  } else if (ctx.message.text === "каналы") {
    return new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM youtube_channels WHERE telegram_chat_id = ?",
        [ctx.chat.id],
        (err, rows) => {
          if (err) {
            ctx.reply(`Что-то пошло не так :(\n${err.message}`);
            reject(err.message);
          } else {
            ctx.replyWithMarkdown(
              `Каналы подключенные к этому чату:
  ${rows.map((row) => `- ${row["channel_id"]}`).join("\n")}`,
              { disable_web_page_preview: true }
            );
            resolve();
          }
        }
      );
    });
  } else {
    ctx.replyWithMarkdown(`Я не понял команду. Попробуй:
- добавь [адрес канала]
- каналы
    `);
  }
});

bot.launch({
  webhook: {
    domain: DOMAIN,
    port: parseInt(PORT, 10),
    cb: (req, res) => console.log(req, res),
  },
});
