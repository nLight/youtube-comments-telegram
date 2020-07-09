const { Telegraf } = require("telegraf");
const i18n = require("i18n");
const sqlite3 = require("sqlite3");
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

const missingEnv = ["PORT", "BOT_TOKEN", "WEBHOOK_URL"].filter(
  (e) => !process.env[e]
);

const { PORT, BOT_TOKEN, NODE_ENV, WEBHOOK_URL } = process.env;

if (missingEnv.length > 0) {
  console.error("Missing ENV var:", missingEnv.join(", "));
  process.exit(1);
}

const db = new sqlite3.Database(__dirname + "/database");

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
    db.run(
      "INSERT INTO youtube_channels (channel_id, telegram_chat_id) VALUES (?, ?)",
      [matches[1], ctx.chat.id],
      (err) => {
        if (!err) return ctx.reply("Канал добавлен!");
        else ctx.reply("Что-то пошло не так :(");
      }
    );
  } else if (ctx.message.text === "каналы") {
    db.all(
      "SELECT * FROM youtube_channels WHERE telegram_chat_id = ?",
      [ctx.chat.id],
      (err, rows) => {
        if (err) return ctx.reply("Канал добавлен!");

        ctx.replyWithMarkdown(
          `Каналы подключенные к этому чату:
${rows.map((row) => `- ${row["channel_id"]}`).join("\n")}`,
          { disable_web_page_preview: true }
        );
      }
    );
  } else {
    ctx.replyWithMarkdown(`Я не понял команду. Попробуй:
    - добавь [адрес канала]
    - каналы
    `);
  }
});

bot.telegram.setWebhook(WEBHOOK_URL).catch((err) => console.log(err));
bot.startWebhook(BOT_TOKEN, null, parseInt(PORT, 10), "localhost");
