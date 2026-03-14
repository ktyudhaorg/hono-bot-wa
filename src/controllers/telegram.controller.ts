import { Context } from "hono";
import { telegramService } from "@/services/telegram/telegram.service";
import { telegramMessageService } from "@/services/telegram/telegram.message.service";
import { telegramBroadcastService } from "@/services/telegram/telegram.broadcast.service";

export class TelegramController {
    public async getStatus(c: Context) {
        try {
            const status = telegramService.getStatus();
            return c.json({ success: true, data: status });
        } catch (error: any) {
            return c.json({ success: false, error: "Failed to get status" }, 500);
        }
    }

    public async webhook(c: Context) {
        try {
            const update = await c.req.json();
            await telegramService.processUpdate(update);
            return c.json({ ok: true });
        } catch (error: any) {
            return c.json({ success: false, error: error.message }, 500);
        }
    }

    public async sendMessage(c: Context) {
        try {
            const body = await c.req.parseBody();

            const to = body["to"] as string;
            const message = body["message"] as string | undefined;
            const caption = body["caption"] as string | undefined;
            const file = body["file"] as File | undefined;
            const mediaUrl = body["mediaUrl"] as string | undefined;

            if (!to) {
                return c.json({ success: false, error: "Missing field: to" }, 400);
            }

            if (!message && !file && !mediaUrl) {
                return c.json({ success: false, error: "Missing field: message, file, or mediaUrl" }, 400);
            }

            if (file && file.size > 50 * 1024 * 1024) {
                return c.json({ success: false, error: "File too large (max 50MB)" }, 400);
            }

            await telegramMessageService.send({ to, message, caption, file, mediaUrl });

            return c.json({ success: true, message: "Sent successfully" });
        } catch (error: any) {
            return c.json({ success: false, error: error.message || "Failed to send" }, 500);
        }
    }

    public async broadcast(c: Context) {
        try {
            const body = await c.req.parseBody();

            const targets = body["targets[]"];
            const message = body["message"] as string;
            const delayMs = body["delayMs"] ? Number(body["delayMs"]) : undefined;
            const caption = body["caption"] as string | undefined;
            const mediaUrl = body["mediaUrl"] as string | undefined;

            if (!targets || !message) {
                return c.json({ success: false, error: "Missing required fields: targets and message" }, 400);
            }

            const targetList = (Array.isArray(targets) ? targets : [targets]).filter((t): t is string => typeof t === "string");

            const result = await telegramBroadcastService.broadcast(targetList, message, { delayMs, caption, mediaUrl });
            return c.json({ success: true, data: result });
        } catch (error: any) {
            return c.json({ success: false, error: error.message || "Failed to broadcast" }, 500);
        }
    }

    public async setWebhook(c: Context) {
        try {
            const { url } = await c.req.json();
            await telegramService.setWebhook(url);
            return c.json({ success: true, message: `Webhook set to ${url}` });
        } catch (error: any) {
            return c.json({ success: false, error: error.message }, 500);
        }
    }

    public async deleteWebhook(c: Context) {
        try {
            await telegramService.deleteWebhook();
            return c.json({ success: true, message: "Webhook deleted, fallback to polling" });
        } catch (error: any) {
            return c.json({ success: false, error: error.message }, 500);
        }
    }
}

export const telegramController = new TelegramController();