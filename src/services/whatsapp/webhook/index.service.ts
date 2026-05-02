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


function toContentType(type: string): string {
    if (type === "chat") return "text";
    if (type === "image") return "image";
    if (type === "video") return "video";
    if (type === "audio" || type === "ptt") return "audio";
    if (type === "document") return "document";
    return "file";
}

export async function sendWebhook(payload: WebhookPayload): Promise<void> {
    if (!WEBHOOK_URL) return;

    const body: Record<string, any> = {
        from: payload.from,
        name: payload.senderName,
        content_type: toContentType(payload.type.toLowerCase()),
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

        if (!res.ok) {
            const errorBody = await res.text();
            log.error(`webhook error | status: ${res.status} | body: ${errorBody}`);
            return;
        }

        log.bot(`webhook sent | status: ${res.status} | to: ${WEBHOOK_URL}`);
    } catch (err) {
        log.error("webhook failed:", err);
    }
}