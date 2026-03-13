import { Hono } from "hono";
import coreRoutes from "@/core/routes.core";
import createApp from "@/core/app.core";
import whatsappInitialize from "@/core/whatsapp.core";
import telegramInitialize from "@/core/telegram.core";
import "dotenv/config";

const app = new Hono();


// HTTP server jalan duluan, tidak nunggu bot
coreRoutes(app);
createApp(app);

// Bot jalan parallel — tidak saling blocking
Promise.all([
    whatsappInitialize(),
    telegramInitialize(),
]).catch((err) => {
    console.error("Bot initialization error:", err);
});
