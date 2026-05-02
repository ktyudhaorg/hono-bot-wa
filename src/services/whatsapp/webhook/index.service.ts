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
    filename?: string;
}

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!WEBHOOK_URL) return;

    const body: Record<string, any> = {
        from: payload.from,
        name: payload.senderName,
        content_type: payload.type,
        message: payload.body ?? "",
    };

    if (payload.mediaBase64 && payload.mimetype) {
        body.media = {
            data: payload.mediaBase64,
            mimetype: payload.mimetype,
            filename: payload.filename ?? null,
        };
    }

    try {
        const res = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        log.bot(`webhook sent | status: ${res.status} | to: ${WEBHOOK_URL}`);
    } catch (err) {
        log.error("webhook failed:", err);
    }
}