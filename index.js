const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PROVISION_API_URL = process.env.PROVISION_API_URL;
const PROVISION_SECRET = process.env.PROVISION_SECRET;

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "https://mawervpn.onrender.com";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
if (!PROVISION_API_URL) throw new Error("PROVISION_API_URL is missing");
if (!PROVISION_SECRET) throw new Error("PROVISION_SECRET is missing");
if (!YOOKASSA_SHOP_ID) throw new Error("YOOKASSA_SHOP_ID is missing");
if (!YOOKASSA_SECRET_KEY) throw new Error("YOOKASSA_SECRET_KEY is missing");

const bot = new Telegraf(BOT_TOKEN);

const processedPaymentsFile = path.join(os.tmpdir(), "mawer-yookassa-processed.json");

function loadProcessedPayments() {
  try {
    return JSON.parse(fs.readFileSync(processedPaymentsFile, "utf8"));
  } catch (_) {
    return {};
  }
}

function saveProcessedPayments(data) {
  fs.writeFileSync(processedPaymentsFile, JSON.stringify(data, null, 2));
}

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
    description: "Доступ к MAWER VPN на 30 дней",
    payload: "mawer_30_days",
    amount: 29900,
    days: 30
  },
  "3 месяца — 699 ₽": {
    title: "MAWER VPN — 3 месяца",
    description: "Доступ к MAWER VPN на 90 дней",
    payload: "mawer_90_days",
    amount: 69900,
    days: 90
  },
  "6 месяцев — 1 299 ₽": {
    title: "MAWER VPN — 6 месяцев",
    description: "Доступ к MAWER VPN на 180 дней",
    payload: "mawer_180_days",
    amount: 129900,
    days: 180
  }
};

const tariffsByPayload = Object.fromEntries(
  Object.values(tariffs).map((t) => [t.payload, t])
);

function formatDate(ts) {
  if (!ts) return "";
  return new Date(Number(ts) * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function createYooKassaPayment(tgId, tariff) {
  const baseUrl = WEBHOOK_URL.replace(/\/$/, "");

  const body = {
    amount: {
      value: (tariff.amount / 100).toFixed(2),
      currency: "RUB"
    },
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: `${baseUrl}/payment-success`
    },
    description: tariff.title,
    metadata: {
      tgId: String(tgId),
      days: String(tariff.days),
      payload: tariff.payload,
      product: "mawer_vpn"
    }
  };

  const res = await axios.post(
    "https://api.yookassa.ru/v3/payments",
    body,
    {
      auth: {
        username: YOOKASSA_SHOP_ID,
        password: YOOKASSA_SECRET_KEY
      },
      headers: {
        "Idempotence-Key": crypto.randomUUID(),
        "Content-Type": "application/json"
      },
      timeout: 20000
    }
  );

  return res.data;
}

async function requestWireGuardConfig(tgId, days = null) {
  const params = {
    secret: PROVISION_SECRET,
    tg: String(tgId)
  };

  if (days) params.days = String(days);

  const res = await axios.get(PROVISION_API_URL, {
    params,
    timeout: 15000
  });

  return res.data;
}

async function sendWireGuardFileToChat(chatId, days = null) {
  const data = await requestWireGuardConfig(chatId, days);

  if (!data || !data.ok) {
    throw new Error(data?.error || "Provision API error");
  }

  const config = data.link;

  if (!config.includes("[Interface]") || !config.includes("[Peer]")) {
    throw new Error("API вернул не WireGuard-конфиг");
  }

  const filePath = path.join(os.tmpdir(), `MAWER-${chatId}.conf`);
  fs.writeFileSync(filePath, config.trim() + "\n", "utf8");

  const expiresText = data.expires_at
    ? `\n\n⏳ Действует до: ${formatDate(data.expires_at)}`
    : "";

  await bot.telegram.sendDocument(
    chatId,
    {
      source: filePath,
      filename: "MAWER.conf"
    },
    {
      caption:
        "🔑 Ваш личный VPN-файл MAWER.conf" +
        expiresText +
        "\n\nИнструкция:\n" +
        "1. Скачайте приложение WireGuard\n" +
        "2. Нажмите на файл MAWER.conf\n" +
        "3. Нажмите кнопку «Поделиться»\n" +
        "4. Выберите «Открыть в WireGuard»\n" +
        "5. Нажмите «Добавить туннель»\n" +
        "6. Включите VPN"
    }
  );

  await bot.telegram.sendMessage(chatId, "✅ Готово.", mainMenu());

  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
}

async function sendWireGuardFile(ctx, days = null) {
  await ctx.reply("⏳ Создаём ваш VPN-файл...");
  await sendWireGuardFileToChat(ctx.from.id, days);
}

bot.start(async (ctx) => {
  await ctx.reply(
    "👋 Добро пожаловать в MAWER VPN.\n\n" +
    "Выберите тариф, оплатите подписку и получите личный файл MAWER.conf для WireGuard.",
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
  try {
    const tariff = tariffs[ctx.message.text];

    const payment = await createYooKassaPayment(ctx.from.id, tariff);
    const paymentUrl = payment?.confirmation?.confirmation_url;

    if (!paymentUrl) {
      throw new Error("ЮKassa не вернула ссылку на оплату");
    }

    await ctx.reply(
      `🧾 Тариф: ${tariff.title}\n` +
      `💰 Цена: ${(tariff.amount / 100).toFixed(0)} ₽\n\n` +
      `Нажмите кнопку ниже, чтобы оплатить:`,
      Markup.inlineKeyboard([
        [Markup.button.url("💳 Оплатить через ЮKassa", paymentUrl)]
      ])
    );
  } catch (e) {
    console.error("CREATE PAYMENT ERROR:", e.message, e.stack);
    await ctx.reply(
      "❌ Не получилось создать оплату. Попробуйте позже или напишите в поддержку.",
      mainMenu()
    );
  }
});

bot.hears("🔑 Мой ключ", async (ctx) => {
  try {
    await sendWireGuardFile(ctx, null);
  } catch (e) {
    const msg = e.message || "";

    if (msg.includes("subscription_required") || msg.includes("subscription_expired")) {
      await ctx.reply(
        "⛔ У вас нет активной подписки MAWER VPN.\n\nНажмите «🛒 Купить VPN» и выберите тариф.",
        mainMenu()
      );
      return;
    }

    console.error("MY KEY ERROR:", e.message, e.stack);
    await ctx.reply("❌ Не получилось создать VPN-файл. Напишите в поддержку.", mainMenu());
  }
});

bot.hears("💬 Поддержка", async (ctx) => {
  await ctx.reply(
    "💬 Поддержка MAWER VPN:\n\nЕсли VPN не подключается или файл не открывается — напишите сюда.",
    mainMenu()
  );
});

bot.catch((err) => {
  console.error("BOT ERROR:", err.message, err.stack);
});

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.send("MAWER VPN bot is running");
});

app.get("/payment-success", (req, res) => {
  res.send("Оплата принята. Вернитесь в Telegram-бот MAWER VPN — файл придёт автоматически.");
});

app.post("/yookassa-webhook", async (req, res) => {
  try {
    const event = req.body?.event;
    const payment = req.body?.object;

    if (event !== "payment.succeeded" || payment?.status !== "succeeded") {
      res.status(200).json({ ok: true });
      return;
    }

    const paymentId = payment.id;
    const metadata = payment.metadata || {};
    const tgId = metadata.tgId;
    const days = Number(metadata.days || 0);

    if (!tgId || !days) {
      console.error("YOOKASSA WEBHOOK BAD METADATA:", metadata);
      res.status(200).json({ ok: true });
      return;
    }

    const processed = loadProcessedPayments();

    if (processed[paymentId]) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    await bot.telegram.sendMessage(
      tgId,
      `✅ Оплата прошла.\n\nАктивируем подписку на ${days} дней и создаём VPN-файл...`
    );

    await sendWireGuardFileToChat(tgId, days);

    processed[paymentId] = {
      tgId,
      days,
      paid_at: Date.now()
    };

    saveProcessedPayments(processed);

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("YOOKASSA WEBHOOK ERROR:", e.message, e.stack);
    res.status(500).json({ ok: false });
  }
});

const webhookPath = "/telegram-webhook";
app.use(bot.webhookCallback(webhookPath));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupTelegramWebhook() {
  const baseUrl = WEBHOOK_URL.replace(/\/$/, "");
  const fullWebhookUrl = `${baseUrl}${webhookPath}`;

  while (true) {
    try {
      await bot.telegram.setWebhook(fullWebhookUrl, {
        drop_pending_updates: true
      });

      console.log("MAWER VPN Telegram webhook:", fullWebhookUrl);
      break;
    } catch (err) {
      console.error("TELEGRAM WEBHOOK SET ERROR:", err.message);
      console.error("Retrying in 10 seconds...");
      await sleep(10000);
    }
  }
}

app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
  setupTelegramWebhook();
});
