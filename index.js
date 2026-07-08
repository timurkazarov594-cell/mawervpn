const http = require("http");
const axios = require("axios");
const { Telegraf, Markup } = require("telegraf");

const {
  BOT_TOKEN,
  PROVISION_API_URL,
  PROVISION_SECRET,
  PORT
} = process.env;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
if (!PROVISION_API_URL) throw new Error("PROVISION_API_URL is missing");
if (!PROVISION_SECRET) throw new Error("PROVISION_SECRET is missing");

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("MAWER Telegram bot is running");
}).listen(PORT || 10000, () => {
  console.log("Health server listening on port", PORT || 10000);
});

const bot = new Telegraf(BOT_TOKEN);

function mainMenu() {
  return Markup.keyboard([
    ["🛒 Купить VPN"],
    ["🔑 Мой ключ"],
    ["💬 Поддержка"]
  ]).resize();
}

function tariffMenu() {
  return Markup.keyboard([
    ["1 месяц — 299 ₽"],
    ["3 месяца — 699 ₽"],
    ["6 месяцев — 1 299 ₽"],
    ["◀ Назад"]
  ]).resize();
}

async function getUserLink(telegramUserId) {
  const url = ${PROVISION_API_URL}?secret=${encodeURIComponent(PROVISION_SECRET)}&tg=${encodeURIComponent(telegramUserId)};

  const res = await axios.get(url, { timeout: 20000 });

  if (!res.data  !res.data.ok  !res.data.link) {
    console.error("PROVISION API ERROR", res.status, res.data);
    throw new Error("Provision API failed");
  }

  return res.data.link;
}

bot.start(async (ctx) => {
  await ctx.reply(
    "🛡 MAWER VPN\nЗащищённый VPN за 1 минуту\n\nВыберите действие:",
    mainMenu()
  );
});

bot.hears("🛒 Купить VPN", async (ctx) => {
  await ctx.reply("🛒 Тарифы MAWER VPN\n\nВыберите тариф:", tariffMenu());
});

bot.hears(["1 месяц — 299 ₽", "3 месяца — 699 ₽", "6 месяцев — 1 299 ₽"], async (ctx) => {
  await ctx.reply("⏳ Создаём ваш личный VPN-доступ...");

  try {
    const link = await getUserLink(ctx.from.id);

    await ctx.reply(
      ✅ Подписка активирована\n\nВаш личный ключ для Happ:\n\n${link}\n\nИнструкция:\n1. Скопируйте ссылку\n2. Откройте Happ\n3. Нажмите +\n4. Вставьте ссылку\n5. Включите VPN,
      mainMenu()
    );
  } catch (e) {
    console.error("CREATE ACCESS ERROR", e.message, e.stack);
    await ctx.reply(
      "❌ Не удалось создать доступ. Попробуйте позже или напишите в поддержку.",
      mainMenu()
    );
  }
});

bot.hears("🔑 Мой ключ", async (ctx) => {
  await ctx.reply("⏳ Получаем ваш ключ...");

  try {
    const link = await getUserLink(ctx.from.id);

    await ctx.reply(
      🔑 Ваш личный ключ для Happ:\n\n${link},
      mainMenu()
    );
  } catch (e) {
    console.error("MY KEY ERROR", e.message, e.stack);
    await ctx.reply(
      "❌ У вас пока нет активного доступа. Нажмите Купить VPN.",
      mainMenu()
    );
  }
});

bot.hears("💬 Поддержка", async (ctx) => {
  await ctx.reply("💬 По всем вопросам: facemax1@mail.ru", mainMenu());
});

bot.hears("◀ Назад", async (ctx) => {
  await ctx.reply("Главное меню:", mainMenu());
});

bot.catch((err) => {
  console.error("BOT ERROR", err);
});

bot.launch({ dropPendingUpdates: true }).then(() => {
  console.log("MAWER bot launched");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
