import { Message } from "whatsapp-web.js";
import { whatsappService } from "@/services/whatsapp";
import { safeBody } from "@/helpers/general";
import { log } from "@/helpers/logger";

export async function handleGroupReply(
    message: Message,
    replyMap: Map<string, string>
): Promise<void> {
    if (!message.hasQuotedMsg) {
        log.bot("group message has no quoted msg, skip");
        return;
    }

    const quoted = await message.getQuotedMessage();
    const targetSender = replyMap.get(quoted.id._serialized);

    if (!targetSender) {
        log.warn(`reply target not found in replyMap | quotedId: ${quoted.id._serialized}`);
        return;
    }

    const overrideMatch = message.body?.match(/^->\s*(\d+)/);
    let finalTarget = targetSender;

    if (overrideMatch) {
        const overrideNumber = overrideMatch[1].replace(/\D/g, "");
        finalTarget = `${overrideNumber}@c.us`;
        log.bot(`reply override | original: ${targetSender} → override: ${finalTarget}`);
    }

    const body = message.body?.replace(/^->\s*\d+\s*/, "").trim();
    log.send(`sending reply | to: ${finalTarget} | hasMedia: ${message.hasMedia} | body: "${body?.slice(0, 50) ?? "-"}"`);

    if (message.hasMedia) {
        const media = await message.downloadMedia();
        if (!media?.data || !media?.mimetype) {
            log.warn(`group reply media invalid | to: ${finalTarget}`);
            return;
        }
        await whatsappService.sendMessage(finalTarget, media, {
            caption: body ? safeBody(body) : undefined,
        });
        log.send(`media reply sent | to: ${finalTarget}`);
        return;
    }

    await whatsappService.sendMessage(finalTarget, safeBody(body));
    log.send(`text reply sent | to: ${finalTarget}`);
}