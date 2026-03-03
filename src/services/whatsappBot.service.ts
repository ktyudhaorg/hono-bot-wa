import { Message, MessageTypes, MessageMedia } from "whatsapp-web.js";
import { whatsappService } from "./whatsapp.service";
import { generateWaLink } from "@/helpers/generateWaLink";
import { compressImage, compressVideo } from "@/helpers/media";
import { safeBody, safeString } from "@/helpers/general";
import { log } from "@/helpers/logger";

export class WhatsAppBotService {
  private whatsappRedirectGroupId = process.env.WHATSAPP_REDIRECT_GROUP_ID;
  private prefix: string = "!";
  private replyMap = new Map<string, string>();
  private liveLocationMap = new Map<
    string,
    { lastUpdate: number; groupMessageId: string }
  >();
  private maxSizeVideo = 16; // MB

  private commands: Map<
    string,
    (message: Message, args: string[]) => Promise<void>
  > = new Map();

  constructor() {
    this.registerCommands();
    whatsappService.onMessage((message) => this.handleMessage(message));
    log.bot("WhatsAppBotService initialized");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SINGLE ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────
  private async handleMessage(message: Message): Promise<void> {
    const from = message.from;
    const type = message.type;
    const preview = message.body?.slice(0, 50) ?? "-";

    log.bot(`message received | from: ${from} | type: ${type} | body: "${preview}"`);

    try {
      if (from === this.whatsappRedirectGroupId) {
        log.bot(`routing to handleGroupReply | from: ${from}`);
        await this.handleGroupReply(message);
        return;
      }

      const body = safeBody(message.body, "");
      if (body.startsWith(this.prefix)) {
        log.cmd(`routing to handleCommand | body: "${body.slice(0, 30)}"`);
        await this.handleCommand(message, body);
        return;
      }

      if (!from.endsWith("@g.us") && !message.isStatus) {
        log.bot(`routing to handleForwardToGroup | from: ${from}`);
        await this.handleForwardToGroup(message);
        return;
      }

      log.bot(`message skipped | from: ${from} | isGroup: ${from.endsWith("@g.us")} | isStatus: ${message.isStatus}`);
    } catch (err) {
      log.error(`handleMessage error | from: ${from} | type: ${type} | error:`, err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handler 1: Command
  // ─────────────────────────────────────────────────────────────────────────
  private async handleCommand(message: Message, body: string): Promise<void> {
    const [cmd, ...args] = body.slice(this.prefix.length).split(" ");
    const commandName = cmd.toLowerCase();
    const commandHandler = this.commands.get(commandName);

    if (commandHandler) {
      log.cmd(`executing command | cmd: ${commandName} | args: [${args.join(", ")}] | from: ${message.from}`);
      try {
        await commandHandler(message, args);
        log.cmd(`command done | cmd: ${commandName}`);
      } catch (err) {
        log.error(`command error | cmd: ${commandName} | from: ${message.from} | error:`, err);
        await message.reply("Terjadi kesalahan saat menjalankan perintah.");
      }
    } else {
      log.warn(`unknown command | cmd: ${commandName} | from: ${message.from}`);
      await message.reply(
        "Perintah tidak dikenal.\nKetik *!help* untuk daftar perintah.",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handler 2: Forward pesan user → group redirect
  // ─────────────────────────────────────────────────────────────────────────
  private async handleForwardToGroup(message: Message): Promise<void> {
    if (!this.whatsappRedirectGroupId) {
      log.error("WHATSAPP_REDIRECT_GROUP_ID tidak ada di .env!");
      return;
    }

    if (!message.body && !message.hasMedia && !message.location) {
      log.bot(`skip empty/system message | from: ${message.from} | type: ${message.type}`);
      return;
    }

    const senderId = message.from;
    const contact = await message.getContact();
    const senderName = contact.pushname || contact.name || contact.number || senderId;
    const senderNumber = contact.number || contact.id.user || senderId;
    const type = message.type as string;

    log.bot(`forwarding to group | from: ${senderName} (+${senderNumber}) | type: ${type}`);

    if (type === MessageTypes.LOCATION || type === "live_location") {
      log.bot(`handling location forward | type: ${type} | from: ${senderId}`);
      await this.handleForwardLocation(message, senderId, senderName, senderNumber, type);
      return;
    }

    if (message.hasMedia) {
      log.media(`handling media forward | type: ${type} | from: ${senderId}`);
      await this.handleForwardMedia(message, senderId, senderName, senderNumber);
      return;
    }

    const textMessage =
      `*Pesan Masuk*\n\n` +
      `*Dari*: ${senderName}\n` +
      `*Nomor*: +${senderNumber}\n\n` +
      `*Pesan*:\n${safeBody(message.body)}`;

    log.send(`sending text to group | to: ${this.whatsappRedirectGroupId} | from: ${senderId}`);
    const sentMessage = await whatsappService.sendMessage(
      this.whatsappRedirectGroupId,
      safeString(textMessage),
    );

    this.replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handler 3: Reply dari group → kirim balik ke user
  // ─────────────────────────────────────────────────────────────────────────
  private async handleGroupReply(message: Message): Promise<void> {
    if (!message.hasQuotedMsg) {
      log.bot("group message has no quoted msg, skip");
      return;
    }

    const quoted = await message.getQuotedMessage();
    const targetSender = this.replyMap.get(quoted.id._serialized);

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

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-handler: Forward location
  // ─────────────────────────────────────────────────────────────────────────
  private async handleForwardLocation(
    message: Message,
    senderId: string,
    senderName: string,
    senderNumber: string,
    type: string,
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

    const existing = this.liveLocationMap.get(senderId);
    if (isLive && existing) {
      log.bot(`live location update | from: ${senderId} | lastUpdate: ${existing.lastUpdate}`);
      await whatsappService.sendMessage(
        this.whatsappRedirectGroupId!,
        safeString(`*Update Lokasi*\n\n${text}`),
      );
      existing.lastUpdate = now;
      return;
    }

    log.send(`sending location to group | from: ${senderId} | isLive: ${isLive}`);
    const sentMessage = await whatsappService.sendMessage(
      this.whatsappRedirectGroupId!,
      safeString(text),
    );
    this.replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);

    if (isLive) {
      this.liveLocationMap.set(senderId, {
        lastUpdate: now,
        groupMessageId: sentMessage.id._serialized,
      });
      log.bot(`liveLocationMap set | senderId: ${senderId}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-handler: Forward media
  // ─────────────────────────────────────────────────────────────────────────
  private async handleForwardMedia(
    message: Message,
    senderId: string,
    senderName: string,
    senderNumber: string,
  ): Promise<void> {
    const type = message.type;
    log.media(`start | from: ${senderId} | type: ${type}`);

    const media = await message.downloadMedia();
    log.media(`downloadMedia done | hasData: ${!!media?.data} | mimetype: ${media?.mimetype ?? "-"}`);

    if (!media?.data || !media?.mimetype) {
      log.warn(`media invalid, skip | from: ${senderId} | type: ${type}`);
      return;
    }

    let sendMedia = media;

    if (type === "sticker") {
      log.media(`forwarding sticker | from: ${senderId}`);
      await this.sendHeaderMessage(senderName, senderNumber, "sticker");
      const sentMessage = await whatsappService.sendMessage(
        this.whatsappRedirectGroupId!,
        media,
        { sendMediaAsSticker: true }
      );
      log.send(`sticker sent | id: ${sentMessage.id._serialized} | to: ${this.whatsappRedirectGroupId}`);
      this.replyMap.set(sentMessage.id._serialized, senderId);
      return;
    }

    if (type === "audio" || type === "ptt") {
      log.media(`forwarding audio | type: ${type} | from: ${senderId}`);
      await this.sendHeaderMessage(senderName, senderNumber, type);
      const sentMessage = await whatsappService.sendMessage(
        this.whatsappRedirectGroupId!,
        media,
        { sendAudioAsVoice: type === "ptt" }
      );
      log.send(`audio sent | type: ${type} | id: ${sentMessage.id._serialized}`);
      this.replyMap.set(sentMessage.id._serialized, senderId);
      return;
    }

    if (type === "document") {
      log.media(`forwarding document | from: ${senderId}`);
      const sentMessage = await whatsappService.sendMessage(
        this.whatsappRedirectGroupId!,
        media,
        {
          sendMediaAsDocument: true,
          caption: this.buildSenderHeader(senderName, senderNumber, "document"),
        }
      );
      log.send(`document sent | id: ${sentMessage.id._serialized}`);
      this.replyMap.set(sentMessage.id._serialized, senderId);
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
      log.media(`video size: ${sizeMB.toFixed(2)} MB | limit: ${this.maxSizeVideo} MB | from: ${senderId}`);

      if (sizeMB <= this.maxSizeVideo) {
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
      typeof message.body === "string" && message.body.length < 300
        ? message.body
        : "";

    const caption =
      `*Pesan Media*\n\n` +
      `*Dari*: ${senderName}\n` +
      `*Nomor*: +${senderNumber}\n\n` +
      `*Tipe*: ${type.toUpperCase()}\n\n` +
      (bodyText ? `*Caption*:\n${safeBody(bodyText)}` : "");

    log.send(`sending media to group | type: ${type} | from: ${senderId} | to: ${this.whatsappRedirectGroupId}`);
    const sentMessage = await whatsappService.sendMessage(
      this.whatsappRedirectGroupId!,
      sendMedia,
      {
        caption: safeString(caption),
        sendMediaAsDocument: type === "video",
      },
    );

    log.send(`media sent | type: ${type} | id: ${sentMessage.id._serialized}`);
    this.replyMap.set(sentMessage.id._serialized, senderId);
    log.bot(`replyMap set | msgId: ${sentMessage.id._serialized} → ${senderId}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Register Commands
  // ─────────────────────────────────────────────────────────────────────────
  private registerCommands() {
    this.commands.set("ping", async (message) => {
      log.cmd(`ping | from: ${message.from}`);
      await message.reply("pong 🏓");
    });

    this.commands.set("help", async (message) => {
      log.cmd(`help | from: ${message.from}`);
      const helpText = Array.from(this.commands.keys())
        .map((cmd) => `• !${cmd}`)
        .join("\n");
      await message.reply(`WhatsApp Bot Command\n${helpText}`);
    });

    this.commands.set("get-chat", async (message) => {
      log.cmd(`get-chat | from: ${message.from}`);
      const chats = await whatsappService.getChats();
      log.bot(`get-chat | total chats: ${chats.length}`);

      const filtered = chats.filter((c) => c.id?._serialized).slice(0, 10);
      log.bot(`get-chat | filtered: ${filtered.length} chats`);

      const chatLines = await Promise.all(
        filtered.map(async (c, i) => {
          const isGroup = c.id._serialized.endsWith("@g.us");

          if (isGroup) {
            const groupChat = c as any;
            log.bot(`get-chat | group: ${c.name} | id: ${c.id._serialized}`);
            return [
              `*${i + 1}. [Group] ${c.name}*`,
              `id      : ${c.id._serialized}`,
              `members : ${groupChat.participants?.length || "-"}`,
            ].join("\n");
          }

          try {
            const contact = await Promise.race([
              c.getContact(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 3000)
              ),
            ]) as any;

            const name = contact.pushname || contact.name || contact.number || c.id.user;
            const number = contact.number || contact.id.user;

            log.bot(`get-chat | personal: ${name} | number: ${number}`);
            return [
              `*${i + 1}. ${name}*`,
              `number  : +${number}`,
              `id      : ${c.id._serialized}`,
            ].join("\n");
          } catch (err) {
            log.warn(`get-chat | getContact timeout/error | id: ${c.id._serialized} | error: ${err}`);
            return [
              `*${i + 1}. ${c.id.user}*`,
              `number  : +${c.id.user}`,
              `id      : ${c.id._serialized}`,
            ].join("\n");
          }
        })
      );

      await message.reply(`*Daftar Chat*\n\n${chatLines.join("\n\n")}`);
      log.cmd(`get-chat done | returned: ${filtered.length} chats`);
    });

    this.commands.set("list-group", async (message) => {
      log.cmd(`list-group | from: ${message.from}`);

      const groups = await whatsappService.getGroups();

      if (groups.length === 0) {
        await message.reply("Tidak ada group ditemukan.");
        return;
      }

      const lines = groups.map((g, i) =>
        `*${i + 1}. ${g.name}*\n` +
        `id      : ${g.id}\n` +
        `members : ${g.participants}`
      );

      const chunkSize = 10;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        await message.reply(
          `*Daftar Group (${i + 1}-${Math.min(i + chunkSize, lines.length)} dari ${groups.length})*\n\n` +
          chunk.join("\n\n")
        );
      }

      log.cmd(`list-group done | total: ${groups.length}`);
    });

    this.commands.set("send", async (message, args) => {
      log.cmd(`send | from: ${message.from} | args: [${args.join(", ")}]`);

      if (args.length < 2) {
        await message.reply(
          "*Usage:*\n!send [nomor/groupId] [pesan]\n\n" +
          "*Contoh:*\n!send 6281234567890 Halo!\n" +
          "!send 1234567890@g.us Halo group!"
        );
        return;
      }

      const target = args[0];
      const text = args.slice(1).join(" ");
      const to = target.endsWith("@g.us")
        ? target
        : `${target.replace(/\D/g, "")}@c.us`;

      const contact = await message.getContact();
      const senderName = contact.pushname || contact.name || contact.number || message.from;
      const senderNumber = contact.number || contact.id.user || message.from;

      try {
        log.send(`send command | from: ${senderName} (+${senderNumber}) | to: ${to} | length: ${text.length} chars`);
        await whatsappService.sendMessage(to, text);
        log.send(`send command success | to: ${to}`);

        if (this.whatsappRedirectGroupId) {
          const monitorMessage = await whatsappService.sendMessage(
            this.whatsappRedirectGroupId,
            safeString(
              `*Pesan Terkirim*\n\n` +
              `*Dari*: ${senderName}\n` +
              `*Nomor*: +${senderNumber}\n\n` +
              `*Ke*: ${target}\n\n` +
              `*Pesan*:\n${text}`
            )
          );
          this.replyMap.set(monitorMessage.id._serialized, to);
          log.bot(`replyMap set (send monitor) | msgId: ${monitorMessage.id._serialized} → ${to}`);
        }

        await message.reply(`Pesan terkirim ke *${target}*`);
      } catch (err) {
        log.error(`send command failed | to: ${target} | error:`, err);
        await message.reply(`Gagal kirim ke *${target}*`);
      }
    });

    this.commands.set("location", async (message) => {
      log.cmd(`location | from: ${message.from}`);
      let location = message.location;

      if (!location && message.hasQuotedMsg) {
        log.bot("location: checking quoted message...");
        const quoted = await message.getQuotedMessage();
        location = quoted.location;
      }

      if (!location) {
        log.warn(`location: not found | from: ${message.from}`);
        await message.reply(
          "Kirim lokasi atau *reply pesan lokasi* lalu ketik `!location`.",
        );
        return;
      }

      const { latitude, longitude, accuracy, speed, degrees, address } = location as any;
      log.bot(`location found | lat: ${latitude} | lng: ${longitude} | from: ${message.from}`);

      await message.reply(
        `*Location Received*\n\n` +
        `Lat: ${latitude}\nLng: ${longitude}\n` +
        (accuracy ? `Accuracy: ${accuracy} m\n` : "") +
        (speed ? `Speed: ${speed}\n` : "") +
        (degrees ? `Direction: ${degrees}\n` : "") +
        (address ? `\nAddress: ${address}` : ""),
      );
    });

    this.commands.set("whoami", async (message) => {
      log.cmd(`whoami | from: ${message.from}`);
      const contact = await message.getContact();
      log.bot(`whoami | number: ${contact.number} | pushname: ${contact.pushname}`);
      await message.reply(
        `*Debug Info*\n\n` +
        `from: ${message.from}\n` +
        `number: ${contact.number}\n` +
        `pushname: ${contact.pushname}\n` +
        `name: ${contact.name}\n` +
        `id.user: ${contact.id.user}\n` +
        `id._serialized: ${contact.id._serialized}`
      );
    });

    // Usage:
    // !broadcast all | Pesan                          → semua (kontak + group)
    // !broadcast all-contacts | Pesan                 → semua kontak
    // !broadcast all-groups | Pesan                   → semua group
    // !broadcast 628xxx,628yyy,groupId@g.us | Pesan   → target spesifik (mix)

    this.commands.set("broadcast", async (message, args) => {
      log.cmd(`broadcast | from: ${message.from}`);

      const fullText = args.join(" ");
      const separatorIndex = fullText.indexOf("|");

      if (separatorIndex === -1) {
        await message.reply(
          "*Usage:*\n\n" +
          "• Semua (kontak + group):\n  `!broadcast all | Pesan`\n\n" +
          "• Semua kontak:\n  `!broadcast all-contacts | Pesan`\n\n" +
          "• Semua group:\n  `!broadcast all-groups | Pesan`\n\n" +
          "• Target spesifik (mix nomor & group):\n  `!broadcast 628xxx,628yyy,groupId@g.us | Pesan`"
        );
        return;
      }

      const targetsRaw = fullText.slice(0, separatorIndex).trim();
      const broadcastMsg = fullText.slice(separatorIndex + 1).trim();

      if (!targetsRaw || !broadcastMsg) {
        await message.reply("Target dan pesan tidak boleh kosong.");
        return;
      }

      const targets = targetsRaw
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

      // Preview target
      const isAll = targets.includes("all");
      const isAllContacts = targets.includes("all-contacts");
      const isAllGroups = targets.includes("all-groups");

      const targetLabel = isAll
        ? "Semua kontak & group"
        : isAllContacts
          ? "Semua kontak"
          : isAllGroups
            ? "Semua group"
            : `${targets.length} target`;

      await message.reply(
        `⏳ *Broadcast Dimulai*\n\n` +
        `📢 Target : *${targetLabel}*\n` +
        `💬 Pesan  : "${broadcastMsg.slice(0, 60)}${broadcastMsg.length > 60 ? "..." : ""}"`
      );

      const { success, failed } = await whatsappService.broadcast(targets, broadcastMsg);

      await message.reply(
        `✅ *Broadcast Selesai*\n\n` +
        `✔ Berhasil: *${success.length}*\n` +
        `✘ Gagal   : *${failed.length}*\n\n` +
        (failed.length > 0
          ? `*Gagal ke:*\n${failed.map(id => `• ${id}`).join("\n")}`
          : "🎉 Semua berhasil!")
      );

      log.cmd(`broadcast done | success: ${success.length} | failed: ${failed.length}`);
    });

    this.commands.set("status", async (message) => {
      log.cmd(`status | from: ${message.from}`);

      const status = whatsappService.getStatus();
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      const memUsage = process.memoryUsage();
      const mbUsed = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
      const mbTotal = (memUsage.heapTotal / 1024 / 1024).toFixed(1);

      await message.reply(
        `🤖 *Status Bot*\n\n` +
        `🟢 Ready       : ${status.isReady ? "Ya" : "Tidak"}\n` +
        `🔐 Authenticated: ${status.isAuthenticated ? "Ya" : "Tidak"}\n` +
        `📱 Nomor Bot   : ${whatsappService.botNumber ?? "-"}\n\n` +
        `⏱ Uptime      : ${hours}j ${minutes}m ${seconds}d\n` +
        `💾 Memory      : ${mbUsed} / ${mbTotal} MB\n` +
        `📦 Node.js     : ${process.version}`
      );

      log.cmd(`status done | isReady: ${status.isReady}`);
    });

    // Usage:
    //   !info              → info pengirim
    //   !info 6281234      → info kontak by nomor
    //   !info 1234@g.us    → info group by ID
    // ─────────────────────────────────────────────────────────────────────────
    this.commands.set("info", async (message, args) => {
      log.cmd(`info | from: ${message.from} | args: [${args.join(", ")}]`);

      const target = args[0]?.trim();

      // ── Info Group ───────────────────────────────────────────────────
      if (target?.endsWith("@g.us") || (!target && message.from.endsWith("@g.us"))) {
        const groupId = target ?? message.from;

        try {
          const chat = await whatsappService.getChatById(groupId) as any;

          await message.reply(
            `👥 *Info Group*\n\n` +
            `📌 Nama      : ${chat.name}\n` +
            `🆔 ID        : ${chat.id._serialized}\n` +
            `👤 Members   : ${chat.participants?.length ?? "-"}\n` +
            `📝 Deskripsi : ${chat.description || "-"}\n` +
            `🔒 Only Admin: ${chat.groupMetadata?.announce ? "Ya" : "Tidak"}\n` +
            `📅 Dibuat    : ${chat.groupMetadata?.creation
              ? new Date(chat.groupMetadata.creation * 1000).toLocaleString("id-ID")
              : "-"
            }`
          );
        } catch (err) {
          log.error(`info group failed | id: ${groupId} | error:`, err);
          await message.reply(`Gagal ambil info group: ${groupId}`);
        }
        return;
      }

      // ── Info Kontak ──────────────────────────────────────────────────
      try {
        let contact: any;

        if (target) {
          const chatId = `${target.replace(/\D/g, "")}@c.us`;
          contact = await whatsappService.getContactById(chatId);
        } else {
          contact = await message.getContact();
        }

        const isRegistered = await contact.isWAContact?.() ?? "-";
        const isBusiness = contact.isBusiness ?? false;
        const isBlocked = contact.isBlocked ?? false;

        await message.reply(
          `👤 *Info Kontak*\n\n` +
          `📛 Nama      : ${contact.pushname || contact.name || "-"}\n` +
          `📱 Nomor     : +${contact.number}\n` +
          `🆔 ID        : ${contact.id._serialized}\n` +
          `✅ Di WA     : ${isRegistered === true ? "Ya" : isRegistered === false ? "Tidak" : "-"}\n` +
          `💼 Bisnis    : ${isBusiness ? "Ya" : "Tidak"}\n` +
          `🚫 Diblokir  : ${isBlocked ? "Ya" : "Tidak"}`
        );
      } catch (err) {
        log.error(`info contact failed | target: ${target} | error:`, err);
        await message.reply(`❌ Gagal ambil info kontak: ${target ?? message.from}`);
      }

      log.cmd(`info done | target: ${target ?? message.from}`);
    });

    // Usage:
    //   Kirim gambar + caption "!sticker"
    //   Reply gambar/video lalu ketik "!sticker"
    //   !sticker [nama] [author]   → custom metadata
    // ─────────────────────────────────────────────────────────────────────────
    this.commands.set("sticker", async (message, args) => {
      log.cmd(`sticker | from: ${message.from}`);

      const stickerName = args[0] ?? "Bot";
      const stickerAuthor = args[1] ?? "WhatsApp Bot";

      let targetMessage = message;

      // Cek apakah reply ke pesan lain
      if (message.hasQuotedMsg) {
        log.bot("sticker: using quoted message");
        targetMessage = await message.getQuotedMessage();
      }

      // Validasi ada media
      if (!targetMessage.hasMedia) {
        await message.reply(
          "*Tidak ada gambar/video.*\n\n" +
          "*Cara pakai:*\n" +
          "• Kirim gambar + caption `!sticker`\n" +
          "• Reply gambar/video lalu ketik `!sticker`\n" +
          "• `!sticker [nama] [author]` untuk custom"
        );
        return;
      }

      const type = targetMessage.type;
      const isImage = type === "image";
      const isVideo = type === "video";

      if (!isImage && !isVideo) {
        await message.reply(`Tipe *${type}* tidak didukung. Gunakan gambar atau video (max 3 detik).`);
        return;
      }

      try {
        log.media(`sticker: downloading media | type: ${type}`);
        const media = await targetMessage.downloadMedia();

        if (!media?.data) {
          await message.reply("Gagal download media.");
          return;
        }

        log.media(`sticker: sending as sticker | name: ${stickerName} | author: ${stickerAuthor}`);
        await whatsappService.sendMessage(message.from, media, {
          sendMediaAsSticker: true,
          stickerName,
          stickerAuthor,
          stickerCategories: ["🤖"],
        });

        log.cmd(`sticker sent | to: ${message.from} | type: ${type}`);
      } catch (err) {
        log.error(`sticker failed | from: ${message.from} | error:`, err);
        await message.reply("Gagal buat sticker. Coba lagi.");
      }
    });

    log.bot(`commands registered | total: ${this.commands.size} | list: [${Array.from(this.commands.keys()).join(", ")}]`);
  }


  /** HELPER */
  private buildSenderHeader(senderName: string, senderNumber: string, type: string): string {
    return safeString(
      `*Pesan Masuk*\n\n` +
      `*Dari*: ${senderName}\n` +
      `*Nomor*: +${senderNumber}\n\n` +
      `*Tipe*: ${type.toUpperCase()}`
    );
  }

  private async sendHeaderMessage(senderName: string, senderNumber: string, type: string): Promise<void> {
    log.send(`sendHeaderMessage | type: ${type} | to: ${this.whatsappRedirectGroupId}`);
    await whatsappService.sendMessage(
      this.whatsappRedirectGroupId!,
      this.buildSenderHeader(senderName, senderNumber, type),
    );
  }
}
