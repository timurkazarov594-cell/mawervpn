const http = require("http");
const axios = require("axios");
const { Telegraf, Markup } = require("telegraf");
const { v4: uuidv4 } = require("uuid");

const {
  BOT_TOKEN,
  XUI_BASE_URL,
  XUI_USERNAME,
  XUI_PASSWORD,
  XUI_INBOUND_ID,
  XUI_PUBLIC_HOST,
  XUI_PUBLIC_PORT,
  PORT
} = process.env;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
if (!XUI_BASE_URL) throw new Error("XUI_BASE_URL is missing");
if (!XUI_USERNAME) throw new Error("XUI_USERNAME is missing");
if (!XUI_PASSWORD) throw new Error("XUI_PASSWORD is missing");
if (!XUI_INBOUND_ID) throw new Error("XUI_INBOUND_ID is missing");

const baseUrl = XUI_BASE_URL.replace(/\/$/, "");
const inboundId = Number(XUI_INBOUND_ID);

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("MAWER Telegram bot is running");
}).listen(PORT || 10000, () => {
  console.log("Health server listening on port", PORT || 10000);
});

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

function randomSubId() {
  return Math.random().toString(36).slice(2, 12);
}

async function xuiLogin() {
  const client = axios.create({
    baseURL: baseUrl,
    timeout: 15000,
    validateStatus: () => true
  });

  const body = new URLSearchParams();
  body.append("username", XUI_USERNAME);
  body.append("password", XUI_PASSWORD);

  const res = await client.post("/login", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  const setCookie = res.headers["set-cookie"];
  if (!setCookie || !setCookie.length) {
    console.error("XUI LOGIN ERROR", res.status, res.data);
    throw new Error("XUI login failed");
  }

  const cookie = setCookie.map(x => x.split(";")[0]).join("; ");
  client.defaults.headers.Cookie = cookie;
  return client;
}

async function getInbound(client) {
  const res = await client.get(`/panel/api/inbounds/get/${inboundId}`);
  if (res.status !== 200 || !res.data || res.data.success === false) {
    console.error("XUI GET INBOUND ERROR", res.status, res.data);
    throw new Error("XUI get inbound failed");
  }

  const inbound = res.data.obj || res.data;
  if (!inbound) {
    console.error("XUI GET INBOUND EMPTY", res.data);
    throw new Error("Inbound empty");
  }

  return inbound;
}

function parseJsonMaybe(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getClients(inbound) {
  const settings = parseJsonMaybe(inbound.settings, {});
  return Array.isArray(settings.clients) ? settings.clients : [];
}

async function addClient(client, telegramUserId) {
  const email = `tg-${telegramUserId}`;
  const uuid = uuidv4();
  const expiryTime = Date.now() + 30 * 24 * 60 * 60 * 1000;

  const payload = {
    id: inboundId,
    settings: JSON.stringify({
      clients: [
        {
          id: uuid,
          email,
          enable: true,
          flow: "xtls-rprx-vision",
          limitIp: 1,
          totalGB: 0,
          expiryTime,
          tgId: "",
          subId: randomSubId(),
          comment: `Telegram user ${telegramUserId}`,
          reset: 0
        }
      ]
    })
  };

  const res = await client.post("/panel/api/inbounds/addClient", payload, {
    headers: { "Content-Type": "application/json" }
  });

  if (res.status !== 200 || !res.data || res.data.success === false) {
    console.error("XUI ADD CLIENT ERROR", res.status, res.data);
    throw new Error("XUI add client failed");
  }

  return { email, uuid };
}

function buildVlessLink(inbound, userClient) {
  const stream = parseJsonMaybe(inbound.streamSettings, {});
  const reality = stream.realitySettings || {};
  const clients = getClients(inbound);

  const c = userClient || clients.find(x => x.email);
  if (!c || !c.id) {
    console.error("XUI LINK BUILD ERROR no client", clients);
    throw new Error("No client");
  }

  const host = XUI_PUBLIC_HOST || "195.133.81.102";
  const port = XUI_PUBLIC_PORT || inbound.port || 443;

  const serverName =
    (reality.serverNames && reality.serverNames[0]) ||
    reality.serverName ||
    "www.cloudflare.com";

  const publicKey = reality.publicKey || "";
  const shortId =
    (reality.shortIds && reality.shortIds[0]) ||
    reality.shortId ||
    "";

  const params = new URLSearchParams();
  params.set("type", stream.network || "tcp");

  if (stream.security === "reality" || publicKey) {
    params.set("security", "reality");
    params.set("pbk", publicKey);
    params.set("fp", "chrome");
    params.set("sni", serverName);
    if (shortId) params.set("sid", shortId);
    params.set("spx", "/");
    if (c.flow) params.set("flow", c.flow);
  } else if (stream.security === "tls") {
    params.set("security", "tls");
    params.set("sni", serverName);
  } else {
    params.set("security", "none");
  }

  return `vless://${c.id}@${host}:${port}?${params.toString()}#MAWER%20VPN`;
}

async function getOrCreateUserLink(telegramUserId) {
  const email = `tg-${telegramUserId}`;
  const client = await xuiLogin();

  let inbound = await getInbound(client);
  let clients = getClients(inbound);
  let existing = clients.find(x => x.email === email);

  if (!existing) {
    await addClient(client, telegramUserId);

    inbound = await getInbound(client);
    clients = getClients(inbound);
    existing = clients.find(x => x.email === email);

    if (!existing) {
      console.error("XUI CLIENT NOT FOUND AFTER ADD", email, clients);
      throw new Error("Client not found after add");
    }
  }

  return buildVlessLink(inbound, existing);
}

const bot = new Telegraf(BOT_TOKEN);

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
    const link = await getOrCreateUserLink(ctx.from.id);
    await ctx.reply(
      `✅ Подписка активирована\n\nВаш личный ключ для Happ:\n\n${link}\n\nИнструкция:\n1. Скопируйте ссылку\n2. Откройте Happ\n3. Нажмите +\n4. Вставьте ссылку\n5. Включите VPN`,
      mainMenu()
    );
  } catch (e) {
    console.error("CREATE ACCESS ERROR", e.message, e.stack);
    await ctx.reply("❌ Не удалось создать доступ. Попробуйте позже или напишите в поддержку.", mainMenu());
  }
});

bot.hears("🔑 Мой ключ", async (ctx) => {
  await ctx.reply("⏳ Получаем ваш ключ...");

  try {
    const link = await getOrCreateUserLink(ctx.from.id);
    await ctx.reply(
      `🔑 Ваш личный ключ для Happ:\n\n${link}`,
      mainMenu()
    );
  } catch (e) {
    console.error("MY KEY ERROR", e.message, e.stack);
    await ctx.reply("❌ У вас пока нет активного доступа. Нажмите Купить VPN.", mainMenu());
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
