import { Message, MessageTypes, MessageMedia } from "whatsapp-web.js";
import { log, safeBody, safeString, compressImage, compressVideo, buildSenderHeader, sendHeaderMessage } from "@/helpers";
import { whatsappService } from "@/services/whatsapp";
import { sendWebhook } from "@/services/whatsapp/webhook/index.service";
import { telegramMessageService } from "@/services/telegram/telegram.message.service";
import { telegramService } from "@/services/telegram/telegram.service";

const MAX_SIZE_VIDEO = 16; // MB
const TELEGRAM_REDIRECT_CHAT_ID = process.env.TELEGRAM_REDIRECT_CHAT_ID;

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
    const senderNumber = contact.id.user || contact.number || senderId;
    const type = message.type as string;

    log.bot(`forwarding to group | from: ${senderName} (${senderNumber}) | type: ${type}`);

    if (type === MessageTypes.LOCATION || type === "live_location") {
        log.bot(`handling location forward | type: ${type} | from: ${senderId}`);
        await handleForwardLocation(message, senderId, senderName, senderNumber, type, redirectGroupId, replyMap, undefined, "incoming");
        return;
    }

    if (message.hasMedia) {
        log.media(`handling media forward | type: ${type} | from: ${senderId}`);
        const media = await handleForwardMedia(message, senderId, senderName, senderNumber, redirectGroupId, replyMap);

        /** SEND TELEGRAM */
        await forwardToTelegram({ message, senderName, senderNumber, media: media ?? undefined, direction: "incoming" });

        return;
    }

    const textMessage =
        `*Pesan Masuk*\n\n` +
        `*Dari*: ${senderName}\n` +
        `*Nomor*: +${senderNumber}\n\n` +
        `*Pesan*:\n${safeBody(message.body)}`;

    log.send(`sending text to group | to: ${redirectGroupId} | from: ${senderId}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, safeString(textMessage));
    /** SEND TELEGRAM */
    await forwardToTelegram({ message, senderName, senderNumber, direction: "incoming" });

    /** WEBHOOK */
    fireWebhook(sentMessage.id._serialized, senderNumber, senderName, message);

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
    liveLocationMap?: Map<string, { lastUpdate: number; groupMessageId: string }>,
    direction: "incoming" | "outgoing" = "incoming"
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

        /** SEND TELEGRAM */
        await forwardToTelegram({ message, senderName, senderNumber, direction });
        return;
    }

    log.send(`sending location to group | from: ${senderId} | isLive: ${isLive}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, safeString(text));
    replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);

    await forwardToTelegram({ message, senderName, senderNumber, direction });

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
): Promise<{ data: string; mimetype: string; filename?: string | null } | null> {
    const type = message.type;
    log.media(`start | from: ${senderId} | type: ${type}`);

    const media = await message.downloadMedia();
    log.media(`downloadMedia done | hasData: ${!!media?.data} | mimetype: ${media?.mimetype ?? "-"}`);

    if (!media?.data || !media?.mimetype) {
        log.warn(`media invalid, skip | from: ${senderId} | type: ${type}`);
        return media;
    }

    let sendMedia = media;

    if (type === "sticker") {
        log.media(`forwarding sticker | from: ${senderId}`);
        await sendHeaderMessage(redirectGroupId, senderName, senderNumber, "sticker");
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, { sendMediaAsSticker: true });
        log.send(`sticker sent | id: ${sentMessage.id._serialized} | to: ${redirectGroupId}`);
        replyMap.set(sentMessage.id._serialized, senderId);

        fireWebhook(sentMessage.id._serialized, senderNumber, senderName, message, media);
        return media;
    }

    if (type === "audio" || type === "ptt") {
        log.media(`forwarding audio | type: ${type} | from: ${senderId}`);
        await sendHeaderMessage(redirectGroupId, senderName, senderNumber, type);
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, { sendAudioAsVoice: type === "ptt" });
        log.send(`audio sent | type: ${type} | id: ${sentMessage.id._serialized}`);
        replyMap.set(sentMessage.id._serialized, senderId);

        fireWebhook(sentMessage.id._serialized, senderNumber, senderName, message, media);
        return media;
    }

    if (type === "document") {
        log.media(`forwarding document | from: ${senderId}`);
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, {
            sendMediaAsDocument: true,
            caption: buildSenderHeader(senderName, senderNumber, "document"),
        });
        log.send(`document sent | id: ${sentMessage.id._serialized}`);
        replyMap.set(sentMessage.id._serialized, senderId);

        fireWebhook(sentMessage.id._serialized, senderNumber, senderName, message, media);
        return media;
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
        return null;
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

    replyMap.set(sentMessage.id._serialized, senderId);
    log.send(`media sent | type: ${type} | id: ${sentMessage.id._serialized}`);

    /** WEBHOOK */
    fireWebhook(sentMessage.id._serialized, senderNumber, senderName, message, sendMedia);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);

    return media;
}

export async function handleForwardOutgoingToGroup(
    message: Message,
    redirectGroupId: string,
    replyMap: Map<string, string>
): Promise<void> {
    if (!message.body && !message.hasMedia && !message.location) {
        log.bot(`skip empty/system message | to: ${message.to} | type: ${message.type}`);
        return;
    }

    const recipientId = message.to;
    const contact = await whatsappService.getContactById(recipientId);

    const recipientName = contact.pushname || contact.name || contact.number || recipientId;
    const recipientNumber = contact.id.user || contact.number || recipientId;
    const type = message.type as string;

    log.bot(`forwarding outgoing to group | to: ${recipientName} (${recipientNumber}) | type: ${type}`);

    if (type === MessageTypes.LOCATION || type === "live_location") {
        await handleForwardLocation(message, recipientId, recipientName, recipientNumber, type, redirectGroupId, replyMap, undefined, "outgoing");
        return;
    }

    if (message.hasMedia) {
        const media = await handleForwardOutgoingMedia(message, recipientId, recipientName, recipientNumber, redirectGroupId, replyMap);
        /** SEND TELEGRAM */
        await forwardToTelegram({ message, senderName: recipientName, senderNumber: recipientNumber, media: media ?? undefined, direction: "outgoing" });

        return;
    }

    const textMessage =
        `*Pesan Keluar*\n\n` +
        `*Ke*: ${recipientName}\n` +
        `*Nomor*: +${recipientNumber}\n\n` +
        `*Pesan*:\n${message.body}`;

    log.send(`sending outgoing text to group | to: ${redirectGroupId} | recipient: ${recipientId}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, safeString(textMessage));

    /** SEND TELEGRAM */
    await forwardToTelegram({ message, senderName: recipientName, senderNumber: recipientNumber, direction: "outgoing" });

    /** WEBHOOK */
    fireWebhook(sentMessage.id._serialized, recipientNumber, recipientName, message);

    replyMap.set(sentMessage.id._serialized, recipientId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${recipientId}`);
}

async function handleForwardOutgoingMedia(
    message: Message,
    recipientId: string,
    recipientName: string,
    recipientNumber: string,
    redirectGroupId: string,
    replyMap: Map<string, string>
): Promise<{ data: string; mimetype: string; filename?: string | null } | null> {
    const type = message.type;
    log.media(`outgoing media | to: ${recipientId} | type: ${type}`);

    const media = await message.downloadMedia();
    if (!media?.data || !media?.mimetype) {
        log.warn(`media invalid, skip | to: ${recipientId} | type: ${type}`);
        return media;
    }

    let sendMedia = media;

    if (type === "sticker") {
        await sendHeaderMessage(redirectGroupId, recipientName, recipientNumber, "sticker");
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, { sendMediaAsSticker: true });
        replyMap.set(sentMessage.id._serialized, recipientId);
        fireWebhook(sentMessage.id._serialized, recipientNumber, recipientName, message, media);
        return media;
    }

    if (type === "audio" || type === "ptt") {
        await sendHeaderMessage(redirectGroupId, recipientName, recipientNumber, type);
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, { sendAudioAsVoice: type === "ptt" });
        replyMap.set(sentMessage.id._serialized, recipientId);
        fireWebhook(sentMessage.id._serialized, recipientNumber, recipientName, message, media);
        return media;
    }

    if (type === "document") {
        const sentMessage = await whatsappService.sendMessage(redirectGroupId, media, {
            sendMediaAsDocument: true,
            caption: buildSenderHeader(recipientName, recipientNumber, "document"),
        });
        replyMap.set(sentMessage.id._serialized, recipientId);
        fireWebhook(sentMessage.id._serialized, recipientNumber, recipientName, message, media);
        return media;
    }

    if (type === "image") {
        const compressed = await compressImage(media.data);
        sendMedia = new MessageMedia("image/jpeg", compressed, "image.jpg");
    }

    if (type === "video") {
        const sizeMB = Buffer.from(media.data, "base64").length / 1024 / 1024;
        if (sizeMB <= MAX_SIZE_VIDEO) {
            const compressed = await compressVideo(media.data);
            sendMedia = new MessageMedia("video/mp4", compressed, "video.mp4");
        } else {
            log.warn(`video too large, skip compress | size: ${sizeMB.toFixed(2)} MB | to: ${recipientId}`);
        }
    }

    if (!sendMedia?.data || !sendMedia?.mimetype) {
        log.warn(`sendMedia invalid after processing | to: ${recipientId} | type: ${type}`);
        return null;
    }

    const bodyText = typeof message.body === "string" && message.body.length < 300 ? message.body : "";
    const caption =
        `*Pesan Media Keluar*\n\n` +
        `*Ke*: ${recipientName}\n` +
        `*Nomor*: +${recipientNumber}\n\n` +
        `*Tipe*: ${type.toUpperCase()}\n\n` +
        (bodyText ? `*Caption*:\n${safeBody(bodyText)}` : "");

    log.send(`sending outgoing media to group | type: ${type} | to: ${redirectGroupId}`);
    const sentMessage = await whatsappService.sendMessage(redirectGroupId, sendMedia, {
        caption: safeString(caption),
        sendMediaAsDocument: type === "video",
    });

    replyMap.set(sentMessage.id._serialized, recipientId);
    fireWebhook(sentMessage.id._serialized, recipientNumber, recipientName, message, sendMedia);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${recipientId}`);

    return media;
}

export async function forwardToTelegram(params: {
    message: Message;
    senderName: string;
    senderNumber: string;
    direction?: "incoming" | "outgoing";
    media?: { data: string; mimetype: string; filename?: string | null };
}): Promise<void> {
    if (!TELEGRAM_REDIRECT_CHAT_ID) return;

    const { message, senderName, senderNumber, direction = "incoming", media } = params;

    const arrow = direction === "incoming" ? "📩" : "📤";
    const label = direction === "incoming" ? "Pesan Masuk" : "Pesan Keluar";

    const header =
        `${arrow} *${label}*\n` +
        `*Dari*: ${senderName}\n` +
        `*Nomor*: +${senderNumber}`;

    try {
        // location
        if (message.location) {
            const { latitude, longitude, description } = message.location;
            await telegramService.bot.sendLocation(
                TELEGRAM_REDIRECT_CHAT_ID,
                parseFloat(latitude),
                parseFloat(longitude)
            );
            await telegramMessageService.send({
                to: TELEGRAM_REDIRECT_CHAT_ID,
                message: `${header}\nMengirim lokasi${description ? `\n${description}` : ""}`,
            });
            return;
        }

        // media
        const mediaData = media ?? (message.hasMedia ? await message.downloadMedia() : null);
        if (mediaData) {
            const buffer = Buffer.from(mediaData.data, "base64");
            const ext = mediaData.mimetype.split("/")[1]?.split(";")[0] ?? "bin";
            await telegramMessageService.sendWithBuffer({
                to: TELEGRAM_REDIRECT_CHAT_ID,
                fileBuffer: buffer,
                fileName: mediaData.filename ?? `file.${ext}`,
                fileType: mediaData.mimetype,
                caption: `${header}\n${message.body ? `\n${message.body}` : ""}`.trim(),
            });
            return;
        }

        // teks biasa
        await telegramMessageService.send({
            to: TELEGRAM_REDIRECT_CHAT_ID,
            message: `${header}\n\n${message.body || "(no text)"}`,
        });

    } catch (err) {
        log.error(`forwardToTelegram failed | from: ${senderNumber}`, err);
    }
}


/** PRIVATE WEBHOOK */
function fireWebhook(
    sentMessageId: string,
    number: string,
    name: string,
    message: Message,
    media?: { data: string; mimetype: string; filename?: string | null },
): void {
    sendWebhook({
        id: sentMessageId,
        number: number,
        name: name,
        body: message.body ?? null,
        type: message.type,
        timestamp: message.timestamp,
        isFromMe: message.fromMe,
        ...(media && {
            mediaBase64: media.data,
            mimetype: media.mimetype,
            filename: media.filename ?? undefined,
        }),
    }).catch(err => log.error("webhook failed:", err));
}