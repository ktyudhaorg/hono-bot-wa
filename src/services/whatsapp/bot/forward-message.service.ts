import { Message, MessageTypes, MessageMedia } from "whatsapp-web.js";
import { whatsappService } from "@/services/whatsapp";
import { compressImage, compressVideo } from "@/helpers/media";
import { safeBody, safeString } from "@/helpers/general";
import { log } from "@/helpers/logger";
import { buildSenderHeader, sendHeaderMessage } from "@/helpers/whatsapp";
import { sendWebhook } from "@/services/whatsapp/webhook/index.service";

const MAX_SIZE_VIDEO = 16; // MB

export async function handleForwardToGroup(
    message: Message,
    redirectGroupId: string,
    replyMap: Map<string, string>
): Promise<void> {
    if (!message.body && !message.hasMedia && !message.location) {
        log.bot(`skip empty/system message | from: ${message.from} | type: ${message.type}`);
        return;
    }

    const senderId = message.from;
    const contact = await message.getContact();
    const senderName = contact.pushname || contact.name || contact.number || senderId;
    const senderNumber = contact.number || contact.id.user || senderId;
    const type = message.type as string;

    log.bot(`forwarding to group | from: ${senderName} (${senderNumber}) | type: ${type}`);

    if (type === MessageTypes.LOCATION || type === "live_location") {
        log.bot(`handling location forward | type: ${type} | from: ${senderId}`);
        await handleForwardLocation(message, senderId, senderName, senderNumber, type, redirectGroupId, replyMap);
        return;
    }

    if (message.hasMedia) {
        log.media(`handling media forward | type: ${type} | from: ${senderId}`);
        await handleForwardMedia(message, senderId, senderName, senderNumber, redirectGroupId, replyMap);
        return;
    }

    const textMessage =
        `*Pesan Masuk*\n\n` +
        `*Dari*: ${senderName}\n` +
        `*Nomor*: +${senderNumber}\n\n` +
        `*Pesan*:\n${safeBody(message.body)}`;

    log.send(`sending text to group | to: ${redirectGroupId} | from: ${senderId}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, safeString(textMessage));

    /** WEBHOOK */
    sendWebhook({
        from: senderId,
        senderName,
        senderNumber,
        body: message.body ?? null,
        type,
        timestamp: message.timestamp,
    }).catch(err => log.error("webhook failed:", err));

    replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);
}

async function handleForwardLocation(
    message: Message,
    senderId: string,
    senderName: string,
    senderNumber: string,
    type: string,
    redirectGroupId: string,
    replyMap: Map<string, string>,
    liveLocationMap?: Map<string, { lastUpdate: number; groupMessageId: string }>
): Promise<void> {
    const loc = message.location;
    if (!loc) {
        log.warn(`location object null | from: ${senderId}`);
        return;
    }

    const isLive = type === "live_location";
    const now = Date.now();
    const mapsUrl = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;

    log.bot(`location forward | from: ${senderId} | isLive: ${isLive} | lat: ${loc.latitude} | lng: ${loc.longitude}`);

    const text =
        `*${isLive ? "LIVE LOCATION" : "LOCATION"}*\n\n` +
        `*Dari*: ${senderName}\n` +
        `*Nomor*: +${senderNumber}\n\n` +
        `Lat: ${loc.latitude}\nLng: ${loc.longitude}\n` +
        ((loc as any).accuracy ? `Accuracy: ${(loc as any).accuracy} m\n` : "") +
        ((loc as any).address ? `Address: ${(loc as any).address}\n` : "") +
        `\n${mapsUrl}`;

    const existing = liveLocationMap?.get(senderId);
    if (isLive && existing) {
        log.bot(`live location update | from: ${senderId} | lastUpdate: ${existing.lastUpdate}`);
        await whatsappService.sendMessage(redirectGroupId, safeString(`*Update Lokasi*\n\n${text}`));
        existing.lastUpdate = now;
        return;
    }

    log.send(`sending location to group | from: ${senderId} | isLive: ${isLive}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, safeString(text));
    replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);

    if (isLive && liveLocationMap) {
        liveLocationMap.set(senderId, { lastUpdate: now, groupMessageId: sentMessage.id._serialized });
        log.bot(`liveLocationMap set | senderId: ${senderId}`);
    }
}

async function handleForwardMedia(
    message: Message,
    senderId: string,
    senderName: string,
    senderNumber: string,
    redirectGroupId: string,
    replyMap: Map<string, string>
): Promise<void> {
    const type = message.type;
    log.media(`start | from: ${senderId} | type: ${type}`);

    const media = await message.downloadMedia();
    log.media(`downloadMedia done | hasData: ${!!media?.data} | mimetype: ${media?.mimetype ?? "-"}`);

    if (!media?.data || !media?.mimetype) {
        log.warn(`media invalid, skip | from: ${senderId} | type: ${type}`);
        return;
    }

    /** WEBHOOK */
    sendWebhook({
        from: senderId,
        senderName,
        senderNumber,
        body: message.body ?? null,
        type,
        timestamp: message.timestamp,
        mediaBase64: media.data,
        mimetype: media.mimetype,
    }).catch(err => log.error("webhook failed:", err));

    let sendMedia = media;

    if (type === "sticker") {
        log.media(`forwarding sticker | from: ${senderId}`);
        await sendHeaderMessage(redirectGroupId, senderName, senderNumber, "sticker");
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, { sendMediaAsSticker: true });
        log.send(`sticker sent | id: ${sentMessage.id._serialized} | to: ${redirectGroupId}`);
        replyMap.set(sentMessage.id._serialized, senderId);
        return;
    }

    if (type === "audio" || type === "ptt") {
        log.media(`forwarding audio | type: ${type} | from: ${senderId}`);
        await sendHeaderMessage(redirectGroupId, senderName, senderNumber, type);
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, { sendAudioAsVoice: type === "ptt" });
        log.send(`audio sent | type: ${type} | id: ${sentMessage.id._serialized}`);
        replyMap.set(sentMessage.id._serialized, senderId);
        return;
    }

    if (type === "document") {
        log.media(`forwarding document | from: ${senderId}`);
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, {
            sendMediaAsDocument: true,
            caption: buildSenderHeader(senderName, senderNumber, "document"),
        });
        log.send(`document sent | id: ${sentMessage.id._serialized}`);
        replyMap.set(sentMessage.id._serialized, senderId);
        return;
    }

    if (type === "image") {
        log.media(`compressing image | from: ${senderId}`);
        const compressed = await compressImage(media.data);
        log.media(`image compressed | original: ${media.data.length} | compressed: ${compressed.length}`);
        sendMedia = new MessageMedia("image/jpeg", compressed, "image.jpg");
    }

    if (type === "video") {
        const sizeMB = Buffer.from(media.data, "base64").length / 1024 / 1024;
        log.media(`video size: ${sizeMB.toFixed(2)} MB | limit: ${MAX_SIZE_VIDEO} MB | from: ${senderId}`);

        if (sizeMB <= MAX_SIZE_VIDEO) {
            log.media("compressing video...");
            const compressed = await compressVideo(media.data);
            log.media(`video compressed | original: ${media.data.length} | compressed: ${compressed.length}`);
            sendMedia = new MessageMedia("video/mp4", compressed, "video.mp4");
        } else {
            log.warn(`video too large, skip compress | size: ${sizeMB.toFixed(2)} MB | from: ${senderId}`);
        }
    }

    if (!sendMedia?.data || !sendMedia?.mimetype) {
        log.warn(`sendMedia invalid after processing, skip | from: ${senderId} | type: ${type}`);
        return;
    }

    const bodyText =
        typeof message.body === "string" && message.body.length < 300 ? message.body : "";

    const caption =
        `*Pesan Media*\n\n` +
        `*Dari*: ${senderName}\n` +
        `*Nomor*: +${senderNumber}\n\n` +
        `*Tipe*: ${type.toUpperCase()}\n\n` +
        (bodyText ? `*Caption*:\n${safeBody(bodyText)}` : "");

    log.send(`sending media to group | type: ${type} | from: ${senderId} | to: ${redirectGroupId}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, sendMedia, {
        caption: safeString(caption),
        sendMediaAsDocument: type === "video",
    });

    log.send(`media sent | type: ${type} | id: ${sentMessage.id._serialized}`);
    replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);
}