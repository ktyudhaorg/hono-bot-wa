import { log } from "@/helpers/logger";

const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL;

export interface WebhookPayload {
    from: string;
    senderName: string;
    senderNumber: string;
    body: string | null;
    type: string;
    timestamp: number;
    mediaBase64?: string;
    mimetype?: string;
}

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!WEBHOOK_URL) return;

    try {
        const res = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        log.bot(`webhook sent | status: ${res.status} | to: ${WEBHOOK_URL}`);
    } catch (err) {
        log.error("webhook failed:", err);
    }
}