import { Hono } from "hono";
import { hmacMiddleware } from "@/middlewares/hmac.middleware";
import { telegramController } from "@/controllers/telegram.controller";

const telegramRoutes = new Hono();

telegramRoutes.post("/webhook", (c) => telegramController.webhook(c));

// HMAC Middleware — sama seperti WA
telegramRoutes.use("*", hmacMiddleware);
telegramRoutes.get("/status", (c) => telegramController.getStatus(c));

// Send — support text, media file, media url, personal & group
telegramRoutes.post("/send", (c) => telegramController.sendMessage(c));
telegramRoutes.post("/broadcast", (c) => telegramController.broadcast(c));

// Webhook management
telegramRoutes.post("/set-webhook", (c) => telegramController.setWebhook(c));
telegramRoutes.post("/delete-webhook", (c) => telegramController.deleteWebhook(c));

export default telegramRoutes;