const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PROVISION_API_URL = process.env.PROVISION_API_URL;
const PROVISION_SECRET = process.env.PROVISION_SECRET;
const PAYMENT_PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN || "";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
if (!PROVISION_API_URL) throw new Error("PROVISION_API_URL is missing");
if (!PROVISION_SECRET) throw new Error("PROVISION_SECRET is missing");

const bot = new Telegraf(BOT_TOKEN);

function mainMenu() {
  return Markup.keyboard([
    ["🛒 Купить VPN"],
    ["🔑 Мой ключ"],
    ["💬 Поддержка"]
  ]).resize();
}

function tariffsMenu() {
  return Markup.keyboard([
    ["1 месяц — 299 ₽"],
    ["3 месяца — 699 ₽"],
    ["6 месяцев — 1 299 ₽"],
    ["⬅️ Назад"]
  ]).resize();
}

const tariffs = {
  "1 месяц — 299 ₽": {
    title: "MAWER VPN — 1 месяц",
    description: "Доступ к MAWER VPN на 1 месяц",
    payload: "mawer_1_month",
    amount: 29900
  },
  "3 месяца — 699 ₽": {
    title: "MAWER VPN — 3 месяца",
    description: "Доступ к MAWER VPN на 3 месяца",
    payload: "mawer_3_months",
    amount: 69900
  },
  "6 месяцев — 1 299 ₽": {
    title: "MAWER VPN — 6 месяцев",
    description: "Доступ к MAWER VPN на 6 месяцев",
    payload: "mawer_6_months",
    amount: 129900
  }
};

async function getWireGuardConfig(tgId) {
  const res = await axios.get(PROVISION_API_URL, {
    params: {
      secret: PROVISION_SECRET,
      tg: String(tgId)
    },
    timeout: 15000
  });

  const data = res.data;

  if (!data || !data.ok) {
    throw new Error(data?.error || "Provision API error");
  }

  const config = data.link || data.config || "";

  if (!config.includes("[Interface]") || !config.includes("[Peer]")) {
    throw new Error("API вернул не WireGuard-конфиг");
  }

  return config.trim() + "\n";
}

async function sendWireGuardFile(ctx) {
  const tgId = ctx.from.id;

  await ctx.reply("⏳ Создаём ваш VPN-файл...");

  const config = await getWireGuardConfig(tgId);

  const filePath = path.join(os.tmpdir(), `MAWER-${tgId}.conf`);
  fs.writeFileSync(filePath, config, "utf8");

  await ctx.replyWithDocument(
    {
      source: filePath,
      filename: "MAWER.conf"
    },
    {
      caption:
        "🔑 Ваш личный VPN-файл MAWER.conf\n\n" +
        "Инструкция:\n" +
        "1. Скачайте приложение WireGuard\n" +
        "2. Нажмите на файл MAWER.conf\n" +
        "3. Выберите «Открыть в WireGuard»\n" +
        "4. Нажмите «Добавить туннель»\n" +
        "5. Включите VPN"
    }
  );

  await ctx.reply(
    "✅ Готово. Если файл не открывается сразу, сохраните его в «Файлы» и импортируйте вручную в WireGuard.",
    mainMenu()
  );

  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
}

bot.start(async (ctx) => {
  await ctx.reply(
    "👋 Добро пожаловать в MAWER VPN.\n\n" +
    "После оплаты бот выдаст вам файл MAWER.conf для приложения WireGuard.",
    mainMenu()
  );
});

bot.hears("⬅️ Назад", async (ctx) => {
  await ctx.reply("Главное меню:", mainMenu());
});

bot.hears("🛒 Купить VPN", async (ctx) => {
  await ctx.reply("Выберите тариф:", tariffsMenu());
});

bot.hears(Object.keys(tariffs), async (ctx) => {
  const tariff = tariffs[ctx.message.text];

  if (!PAYMENT_PROVIDER_TOKEN) {
    await ctx.reply(
      "⚠️ Оплата ещё не подключена в переменных Render.\n\n" +
      "Для теста нажмите «🔑 Мой ключ», чтобы получить VPN-файл.",
      mainMenu()
    );
    return;
  }

  await ctx.replyWithInvoice({
    title: tariff.title,
    description: tariff.description,
    payload: tariff.payload,
    provider_token: PAYMENT_PROVIDER_TOKEN,
    currency: "RUB",
    prices: [
      {
        label: tariff.title,
        amount: tariff.amount
      }
    ],
    need_email: false,
    need_phone_number: false,
    need_shipping_address: false,
    is_flexible: false
  });
});

bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on("successful_payment", async (ctx) => {
  try {
    await ctx.reply("✅ Оплата прошла.");
    await sendWireGuardFile(ctx);
  } catch (e) {
    console.error("SEND WG FILE AFTER PAYMENT ERROR:", e.message, e.stack);
    await ctx.reply(
      "✅ Оплата прошла, но файл не создался автоматически. Напишите в поддержку, мы выдадим доступ вручную.",
      mainMenu()
    );
  }
});

bot.hears("🔑 Мой ключ", async (ctx) => {
  try {
    await sendWireGuardFile(ctx);
  } catch (e) {
    console.error("SEND WG FILE ERROR:", e.message, e.stack);
    await ctx.reply(
      "❌ Не получилось создать VPN-файл. Напишите в поддержку.",
      mainMenu()
    );
  }
});

bot.hears("💬 Поддержка", async (ctx) => {
  await ctx.reply(
    "💬 Поддержка MAWER VPN:\n\n" +
    "Напишите сюда, если VPN не подключается или файл не открывается.",
    mainMenu()
  );
});

bot.catch((err, ctx) => {
  console.error("BOT ERROR:", err.message, err.stack);
});

async function startBot() {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    console.log("MAWER VPN bot started");
  } catch (err) {
    console.error("BOT LAUNCH ERROR:", err.message, err.stack);
    process.exit(1);
  }
}

startBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
