import { Message } from "whatsapp-web.js";
import { log } from "@/helpers/logger";

export async function handleAutoReply(
    message: Message,
    autoReplies: Map<string, string>
): Promise<boolean> {
    if (!message.body || message.from.endsWith("@g.us") || message.isStatus) return false;

    const body = message.body.toLowerCase().trim();

    for (const [keyword, reply] of autoReplies.entries()) {
        const pattern = keyword.toLowerCase();
        const matched = body === pattern || body.includes(pattern);

        if (matched) {
            log.bot(`auto-reply match | keyword: "${keyword}" | from: ${message.from}`);
            await message.reply(reply);
            return true;
        }
    }

    return false;
}