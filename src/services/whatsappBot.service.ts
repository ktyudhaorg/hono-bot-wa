import { Message, MessageTypes, MessageMedia } from "whatsapp-web.js";
import { whatsappService } from "./whatsapp.service";
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

  private schedules = new Map<string, NodeJS.Timeout>();
  private autoReplies = new Map<string, string>();
  private templates = new Map<string, string>();

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

      if (this.autoReplies.size > 0) {
        const replied = await this.handleAutoReply(message);
        if (replied) return;
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

    const contact = await message.getContact();
    const senderName = contact.pushname || contact.name || contact.number || message.from;
    const senderNumber = contact.number || contact.id.user || message.from;

    if (commandHandler) {
      log.cmd(`executing command | cmd: ${commandName} | args: [${args.join(", ")}] | from: ${message.from}`);
      try {
        await commandHandler(message, args);
        log.cmd(`command done | cmd: ${commandName}`);

        if (this.whatsappRedirectGroupId) {
          await whatsappService.sendMessage(
            this.whatsappRedirectGroupId,
            `*Command Dijalankan*\n\n` +
            `Dari   : ${senderName}\n` +
            `Nomor  : +${senderNumber}\n` +
            `Command: \`${body.slice(0, 100)}\`\n` +
            `Status : Berhasil`
          );
        }
      } catch (err) {
        log.error(`command error | cmd: ${commandName} | from: ${message.from} | error:`, err);
        await message.reply("Terjadi kesalahan saat menjalankan perintah.");

        if (this.whatsappRedirectGroupId) {
          await whatsappService.sendMessage(
            this.whatsappRedirectGroupId,
            `*Command Gagal*\n\n` +
            `Dari   : ${senderName}\n` +
            `Nomor  : +${senderNumber}\n` +
            `Command: \`${body.slice(0, 100)}\`\n` +
            `Error  : ${String(err).slice(0, 200)}`
          );
        }
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
        `*Broadcast Dimulai*\n\n` +
        `Target : *${targetLabel}*\n` +
        `Pesan  : "${broadcastMsg.slice(0, 60)}${broadcastMsg.length > 60 ? "..." : ""}"`
      );

      const { success, failed } = await whatsappService.broadcast(targets, broadcastMsg);

      await message.reply(
        `*Broadcast Selesai*\n\n` +
        `Berhasil: *${success.length}*\n` +
        `Gagal   : *${failed.length}*\n\n` +
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
        `*Status Bot*\n\n` +
        `Ready       : ${status.isReady ? "Ya" : "Tidak"}\n` +
        `Authenticated: ${status.isAuthenticated ? "Ya" : "Tidak"}\n` +
        `Nomor Bot   : ${whatsappService.botNumber ?? "-"}\n\n` +
        `Uptime      : ${hours}j ${minutes}m ${seconds}d\n` +
        `Memory      : ${mbUsed} / ${mbTotal} MB\n` +
        `Node.js     : ${process.version}`
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
            `*Info Group*\n\n` +
            `Nama      : ${chat.name}\n` +
            `ID        : ${chat.id._serialized}\n` +
            `Members   : ${chat.participants?.length ?? "-"}\n` +
            `Deskripsi : ${chat.description || "-"}\n` +
            `Only Admin: ${chat.groupMetadata?.announce ? "Ya" : "Tidak"}\n` +
            `Dibuat    : ${chat.groupMetadata?.creation
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
          const number = target.replace(/\D/g, "");
          const chatId = `${number}@c.us`;

          log.bot(`info: resolving contact | chatId: ${chatId}`);

          try {
            // Cara 1: getChatById → lebih reliable dari getContactById
            const chat = await whatsappService.getChatById(chatId);
            contact = await (chat as any).getContact();
            log.bot(`info: contact resolved via getChatById | name: ${contact?.pushname}`);
          } catch {
            // Cara 2: fallback getContactById
            log.warn(`info: getChatById failed, trying getContactById | chatId: ${chatId}`);
            contact = await whatsappService.getContactById(chatId);
          }

        } else {
          contact = await message.getContact();
        }

        if (!contact) {
          await message.reply(`Kontak tidak ditemukan.`);
          return;
        }

        log.bot(`info: contact found | number: ${contact.number} | pushname: ${contact.pushname}`);

        // isWAContact bisa jadi property bukan method, tergantung versi
        let isRegistered: any = "-";
        try {
          if (typeof contact.isWAContact === "function") {
            isRegistered = await contact.isWAContact();
          } else if (typeof contact.isWAContact === "boolean") {
            isRegistered = contact.isWAContact;
          }
        } catch {
          isRegistered = "-";
        }

        const isBusiness = contact.isBusiness ?? false;
        const isBlocked = contact.isBlocked ?? false;
        const about = contact.statusMute ?? null; // profile bio jika ada

        await message.reply(
          `*Info Kontak*\n\n` +
          `Nama      : ${contact.pushname || contact.name || "-"}\n` +
          `Nomor     : +${contact.number || target}\n` +
          `ID        : ${contact.id?._serialized ?? `${target}@c.us`}\n` +
          `Di WA     : ${isRegistered === true ? "Ya" : isRegistered === false ? "Tidak" : "-"}\n` +
          `Bisnis    : ${isBusiness ? "Ya" : "Tidak"}\n` +
          `Diblokir  : ${isBlocked ? "Ya" : "Tidak"}`
        );

      } catch (err) {
        log.error(`info contact failed | target: ${target} | error:`, err);

        // Fallback: tampilkan info minimal dari nomor saja
        if (target) {
          const number = target.replace(/\D/g, "");
          await message.reply(
            `*Info Kontak* _(terbatas)_\n\n` +
            `Nomor : +${number}\n` +
            `ID    : ${number}@c.us\n\n` +
            `Data lengkap tidak tersedia.\n` +
            `Kontak mungkin belum pernah chat dengan bot._`
          );
        } else {
          await message.reply(`Gagal ambil info kontak.`);
        }
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

    this.commands.set("add", async (message, args) => {
      log.cmd(`add | from: ${message.from} | args: [${args.join(", ")}]`);

      if (args.length < 2) {
        await message.reply(
          "*Usage:*\n`!add [groupId] [nomor1,nomor2]`\n\n" +
          "*Contoh:*\n`!add 1234567890@g.us 6281234,6285678`"
        );
        return;
      }

      const groupId = args[0].trim();
      const numbers = args[1].split(",").map(n => this.toContactId(n.trim())).filter(Boolean);

      if (!groupId.endsWith("@g.us")) {
        await message.reply("Group ID harus diakhiri `@g.us`.");
        return;
      }

      if (numbers.length === 0) {
        await message.reply("Tidak ada nomor valid.");
        return;
      }

      try {
        const { chat } = await this.ensureBotIsAdmin(groupId);

        log.bot(`add: adding ${numbers.length} member(s) to ${groupId}`);
        const result = await chat.addParticipants(numbers);

        // result: { [id]: { code, message } }
        const success: string[] = [];
        const failed: string[] = [];

        for (const [id, res] of Object.entries(result as any)) {
          const code = (res as any)?.code ?? (res as any)?.status;
          if (code === 200 || code === "200") success.push(id);
          else failed.push(`${id} (code: ${code})`);
        }

        await message.reply(
          `*Tambah Member Selesai*\n\n` +
          `Group   : ${chat.name}\n` +
          `Berhasil: *${success.length}*\n` +
          `Gagal   : *${failed.length}*\n\n` +
          (failed.length > 0 ? `*Gagal:*\n${failed.map(f => `• ${f}`).join("\n")}` : "🎉 Semua berhasil!")
        );

      } catch (err: any) {
        log.error(`add failed | group: ${groupId} | error:`, err);
        await message.reply(`Gagal tambah member.\n_${err.message}_`);
      }

      log.cmd(`add done | group: ${groupId}`);
    });

    this.commands.set("kick", async (message, args) => {
      log.cmd(`kick | from: ${message.from} | args: [${args.join(", ")}]`);

      if (args.length < 2) {
        await message.reply(
          "*Usage:*\n`!kick [groupId] [nomor1,nomor2]`\n\n" +
          "*Contoh:*\n`!kick 1234567890@g.us 6281234,6285678`"
        );
        return;
      }

      const groupId = args[0].trim();
      const numbers = args[1].split(",").map(n => this.toContactId(n.trim())).filter(Boolean);

      if (!groupId.endsWith("@g.us")) {
        await message.reply("Group ID harus diakhiri `@g.us`.");
        return;
      }

      try {
        const { chat, botId } = await this.ensureBotIsAdmin(groupId);

        // Cegah kick diri sendiri
        const filtered = numbers.filter(n => n !== botId);
        if (filtered.length === 0) {
          await message.reply("Tidak bisa kick bot itu sendiri.");
          return;
        }

        // Cegah kick sesama admin
        const adminIds = chat.participants
          ?.filter((p: any) => p.isAdmin || p.isSuperAdmin)
          .map((p: any) => p.id._serialized) ?? [];

        const toKick = filtered.filter(n => !adminIds.includes(n));
        const skippedAdmin = filtered.filter(n => adminIds.includes(n));

        if (toKick.length === 0) {
          await message.reply("Semua target adalah admin, tidak bisa di-kick.");
          return;
        }

        log.bot(`kick: removing ${toKick.length} member(s) from ${groupId}`);
        await chat.removeParticipants(toKick);

        await message.reply(
          `*Kick Member Selesai*\n\n` +
          `Group    : ${chat.name}\n` +
          `Di-kick  : *${toKick.length}*\n` +
          (skippedAdmin.length > 0
            ? `Skip admin: ${skippedAdmin.map(n => `• ${n}`).join("\n")}`
            : "")
        );

      } catch (err: any) {
        log.error(`kick failed | group: ${groupId} | error:`, err);
        await message.reply(`Gagal kick member.\n_${err.message}_`);
      }

      log.cmd(`kick done | group: ${groupId}`);
    });

    this.commands.set("promote", async (message, args) => {
      log.cmd(`promote | from: ${message.from} | args: [${args.join(", ")}]`);

      if (args.length < 2) {
        await message.reply(
          "*Usage:*\n`!promote [groupId] [nomor1,nomor2]`\n\n" +
          "*Contoh:*\n`!promote 1234567890@g.us 6281234`"
        );
        return;
      }

      const groupId = args[0].trim();
      const numbers = args[1].split(",").map(n => this.toContactId(n.trim())).filter(Boolean);

      if (!groupId.endsWith("@g.us")) {
        await message.reply("Group ID harus diakhiri `@g.us`.");
        return;
      }

      try {
        const { chat } = await this.ensureBotIsAdmin(groupId);

        // Cek apakah target adalah member group
        const memberIds = chat.participants?.map((p: any) => p.id._serialized) ?? [];
        const valid = numbers.filter(n => memberIds.includes(n));
        const invalid = numbers.filter(n => !memberIds.includes(n));

        if (valid.length === 0) {
          await message.reply("Tidak ada target yang merupakan member group.");
          return;
        }

        log.bot(`promote: promoting ${valid.length} member(s) in ${groupId}`);
        await chat.promoteParticipants(valid);

        await message.reply(
          `*Promote Admin Selesai*\n\n` +
          `Group     : ${chat.name}\n` +
          `Dipromote : *${valid.length}*\n` +
          (invalid.length > 0
            ? `Bukan member:\n${invalid.map(n => `• ${n}`).join("\n")}`
            : "Semua berhasil!")
        );

      } catch (err: any) {
        log.error(`promote failed | group: ${groupId} | error:`, err);
        await message.reply(`Gagal promote member.\n_${err.message}_`);
      }

      log.cmd(`promote done | group: ${groupId}`);
    });

    this.commands.set("demote", async (message, args) => {
      log.cmd(`demote | from: ${message.from} | args: [${args.join(", ")}]`);

      if (args.length < 2) {
        await message.reply(
          "*Usage:*\n`!demote [groupId] [nomor1,nomor2]`\n\n" +
          "*Contoh:*\n`!demote 1234567890@g.us 6281234`"
        );
        return;
      }

      const groupId = args[0].trim();
      const numbers = args[1].split(",").map(n => this.toContactId(n.trim())).filter(Boolean);

      if (!groupId.endsWith("@g.us")) {
        await message.reply("Group ID harus diakhiri `@g.us`.");
        return;
      }

      try {
        const { chat, botId } = await this.ensureBotIsAdmin(groupId);

        // Cegah demote diri sendiri
        const filtered = numbers.filter(n => n !== botId);
        if (filtered.length === 0) {
          await message.reply("Tidak bisa demote bot itu sendiri.");
          return;
        }

        // Pastikan target adalah admin
        const adminIds = chat.participants
          ?.filter((p: any) => p.isAdmin || p.isSuperAdmin)
          .map((p: any) => p.id._serialized) ?? [];

        const todemote = filtered.filter(n => adminIds.includes(n));
        const notAdmin = filtered.filter(n => !adminIds.includes(n));
        const superAdmins = filtered.filter(n =>
          chat.participants?.find((p: any) => p.id._serialized === n)?.isSuperAdmin
        );

        if (todemote.length === 0) {
          await message.reply("Tidak ada target yang merupakan admin.");
          return;
        }

        if (superAdmins.length > 0) {
          await message.reply(
            `⚠ *Tidak bisa demote super admin:*\n` +
            `${superAdmins.map(n => `• ${n}`).join("\n")}`
          );
          return;
        }

        log.bot(`demote: demoting ${todemote.length} admin(s) in ${groupId}`);
        await chat.demoteParticipants(todemote);

        await message.reply(
          `*Demote Admin Selesai*\n\n` +
          `Group    : ${chat.name}\n` +
          `Di-demote: *${todemote.length}*\n` +
          (notAdmin.length > 0
            ? `Bukan admin:\n${notAdmin.map(n => `• ${n}`).join("\n")}`
            : "Semua berhasil!")
        );

      } catch (err: any) {
        log.error(`demote failed | group: ${groupId} | error:`, err);
        await message.reply(`Gagal demote admin.\n_${err.message}_`);
      }

      log.cmd(`demote done | group: ${groupId}`);
    });

    this.commands.set("schedule", async (message, args) => {
      log.cmd(`schedule | from: ${message.from} | args: [${args.join(", ")}]`);

      const sub = args[0]?.toLowerCase();

      // ── List ─────────────────────────────────────────────────────────
      if (sub === "list") {
        if (this.schedules.size === 0) {
          await message.reply("📭 Tidak ada jadwal aktif.");
          return;
        }
        const lines = Array.from(this.schedules.keys()).map((id, i) => `${i + 1}. \`${id}\``);
        await message.reply(`*Jadwal Aktif (${this.schedules.size})*\n\n${lines.join("\n")}`);
        return;
      }

      // ── Cancel ───────────────────────────────────────────────────────
      if (sub === "cancel") {
        const id = args[1]?.trim();
        if (!id) { await message.reply("Usage: `!schedule cancel [id]`"); return; }

        const timeout = this.schedules.get(id);
        if (!timeout) { await message.reply(`Jadwal \`${id}\` tidak ditemukan.`); return; }

        clearTimeout(timeout);
        this.schedules.delete(id);
        await message.reply(`Jadwal \`${id}\` dibatalkan.`);
        log.bot(`schedule cancelled | id: ${id}`);
        return;
      }

      // ── Add ──────────────────────────────────────────────────────────
      if (sub === "add") {
        // !schedule add [id] [target] [waktu] [pesan...]
        if (args.length < 5) {
          await message.reply(
            "*Usage:*\n\n" +
            "• Waktu spesifik (HH:MM):\n" +
            "  `!schedule add myid 6281234@c.us 14:30 Halo!`\n\n" +
            "• Delay relatif:\n" +
            "  `!schedule add myid 6281234@c.us 30m Halo!`\n" +
            "  `!schedule add myid 6281234@c.us 2h Halo!`\n" +
            "  `!schedule add myid 6281234@c.us 1d Halo!`\n\n" +
            "• Lihat jadwal: `!schedule list`\n" +
            "• Batalkan    : `!schedule cancel [id]`"
          );
          return;
        }

        const id = args[1].trim();
        const target = args[2].trim();
        const timeArg = args[3].trim();
        const text = args.slice(4).join(" ");

        if (this.schedules.has(id)) {
          await message.reply(`ID \`${id}\` sudah ada. Gunakan ID lain atau cancel dulu.`);
          return;
        }

        // Parse waktu
        let delayMs = 0;
        const delayMatch = timeArg.match(/^(\d+)(m|h|d)$/i);

        if (delayMatch) {
          // Delay relatif: 30m, 2h, 1d
          const val = parseInt(delayMatch[1]);
          const unit = delayMatch[2].toLowerCase();
          delayMs = unit === "m" ? val * 60_000
            : unit === "h" ? val * 3_600_000
              : val * 86_400_000;
        } else if (/^\d{2}:\d{2}$/.test(timeArg)) {
          // Waktu spesifik: 14:30
          const [hh, mm] = timeArg.split(":").map(Number);
          const now = new Date();
          const target_ = new Date(now);
          target_.setHours(hh, mm, 0, 0);
          if (target_ <= now) target_.setDate(target_.getDate() + 1); // besok
          delayMs = target_.getTime() - now.getTime();
        } else {
          await message.reply("Format waktu tidak valid.\nGunakan `HH:MM` atau `30m` / `2h` / `1d`.");
          return;
        }

        const sendAt = new Date(Date.now() + delayMs);
        const label = sendAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

        const timeout = setTimeout(async () => {
          try {
            await whatsappService.sendMessage(target, text);
            log.send(`schedule fired | id: ${id} | to: ${target}`);
            this.schedules.delete(id);

            if (this.whatsappRedirectGroupId) {
              await whatsappService.sendMessage(
                this.whatsappRedirectGroupId,
                `*Pesan Terjadwal Terkirim*\n\n` +
                `ID    : ${id}\n` +
                `Ke    : ${target}\n` +
                `Pesan : ${text.slice(0, 100)}`
              );
            }
          } catch (err: any) {
            log.error(`schedule fire failed | id: ${id} | target: ${target}`, {
              message: err?.message ?? String(err),
              stack: err?.stack ?? "-",
              name: err?.name ?? "-",
            });
          }
        }, delayMs);

        this.schedules.set(id, timeout);

        await message.reply(
          `*Jadwal Dibuat*\n\n` +
          `ID    : ${id}\n` +
          `Ke    : ${target}\n` +
          `Waktu : ${label} WIB\n` +
          `Pesan : ${text.slice(0, 80)}`
        );

        log.cmd(`schedule set | id: ${id} | target: ${target} | delay: ${delayMs}ms`);
        return;
      }

      await message.reply(
        "*Sub-command:*\n" +
        "• `!schedule add [id] [target] [waktu] [pesan]`\n" +
        "• `!schedule list`\n" +
        "• `!schedule cancel [id]`"
      );
    });

    // Usage:
    //   !autoreply add [keyword] | [balasan]
    //   !autoreply list
    //   !autoreply delete [keyword]
    //   !autoreply clear
    // ─────────────────────────────────────────────────────────────────────────
    this.commands.set("autoreply", async (message, args) => {
      log.cmd(`autoreply | from: ${message.from} | args: [${args.join(", ")}]`);

      const sub = args[0]?.toLowerCase();

      // ── List ─────────────────────────────────────────────────────────
      if (sub === "list") {
        if (this.autoReplies.size === 0) {
          await message.reply("📭 Tidak ada auto reply aktif.");
          return;
        }
        const lines = Array.from(this.autoReplies.entries()).map(
          ([kw, rep], i) => `*${i + 1}. "${kw}"*\n↩ ${rep.slice(0, 60)}${rep.length > 60 ? "..." : ""}`
        );
        await message.reply(`*Auto Reply (${this.autoReplies.size})*\n\n${lines.join("\n\n")}`);
        return;
      }

      // ── Delete ───────────────────────────────────────────────────────
      if (sub === "delete") {
        const keyword = args.slice(1).join(" ").trim();
        if (!keyword) { await message.reply("Usage: `!autoreply delete [keyword]`"); return; }

        if (!this.autoReplies.has(keyword)) {
          await message.reply(`Keyword "${keyword}" tidak ditemukan.`);
          return;
        }
        this.autoReplies.delete(keyword);
        await message.reply(`Auto reply "${keyword}" dihapus.`);
        return;
      }

      // ── Clear ────────────────────────────────────────────────────────
      if (sub === "clear") {
        this.autoReplies.clear();
        await message.reply("Semua auto reply dihapus.");
        return;
      }

      // ── Add ──────────────────────────────────────────────────────────
      if (sub === "add") {
        const fullText = args.slice(1).join(" ");
        const sepIdx = fullText.indexOf("|");

        if (sepIdx === -1) {
          await message.reply(
            "*Usage:*\n`!autoreply add [keyword] | [balasan]`\n\n" +
            "*Contoh:*\n`!autoreply add halo | Halo juga! Ada yang bisa dibantu?`\n" +
            "`!autoreply add jam buka | Kami buka Senin-Jumat 09.00-17.00 WIB`"
          );
          return;
        }

        const keyword = fullText.slice(0, sepIdx).trim().toLowerCase();
        const reply = fullText.slice(sepIdx + 1).trim();

        if (!keyword || !reply) {
          await message.reply("Keyword dan balasan tidak boleh kosong.");
          return;
        }

        this.autoReplies.set(keyword, reply);
        await message.reply(
          `*Auto Reply Ditambahkan*\n\n` +
          `Keyword : "${keyword}"\n` +
          `Balasan : ${reply.slice(0, 100)}`
        );

        log.bot(`autoreply added | keyword: "${keyword}"`);
        return;
      }

      await message.reply(
        "*Sub-command:*\n" +
        "• `!autoreply add [keyword] | [balasan]`\n" +
        "• `!autoreply list`\n" +
        "• `!autoreply delete [keyword]`\n" +
        "• `!autoreply clear`"
      );
    });

    this.commands.set("template", async (message, args) => {
      log.cmd(`template | from: ${message.from} | args: [${args.join(", ")}]`);

      const sub = args[0]?.toLowerCase();

      // ── List ─────────────────────────────────────────────────────────
      if (sub === "list") {
        if (this.templates.size === 0) {
          await message.reply("Tidak ada template tersimpan.");
          return;
        }
        const lines = Array.from(this.templates.keys()).map(
          (name, i) => `${i + 1}. \`${name}\``
        );
        await message.reply(`*Template (${this.templates.size})*\n\n${lines.join("\n")}`);
        return;
      }

      // ── Show ─────────────────────────────────────────────────────────
      if (sub === "show") {
        const name = args[1]?.trim();
        if (!name) { await message.reply("Usage: `!template show [nama]`"); return; }

        const content = this.templates.get(name);
        if (!content) { await message.reply(`Template \`${name}\` tidak ditemukan.`); return; }

        await message.reply(`*Template: ${name}*\n\n${content}`);
        return;
      }

      // ── Delete ───────────────────────────────────────────────────────
      if (sub === "delete") {
        const name = args[1]?.trim();
        if (!name) { await message.reply("Usage: `!template delete [nama]`"); return; }

        if (!this.templates.has(name)) {
          await message.reply(`Template \`${name}\` tidak ditemukan.`);
          return;
        }
        this.templates.delete(name);
        await message.reply(`Template \`${name}\` dihapus.`);
        return;
      }

      // ── Send ─────────────────────────────────────────────────────────
      if (sub === "send") {
        // !template send [nama] [target1,target2,...]
        if (args.length < 3) {
          await message.reply("Usage: `!template send [nama] [target1,target2]`");
          return;
        }

        const name = args[1].trim();
        const content = this.templates.get(name);

        if (!content) { await message.reply(`Template \`${name}\` tidak ditemukan.`); return; }

        const targets = args[2].split(",").map(t => t.trim()).filter(Boolean);

        await message.reply(`Mengirim template \`${name}\` ke *${targets.length}* target...`);

        const { success, failed } = await whatsappService.broadcast(targets, content);

        await message.reply(
          `*Template Terkirim*\n\n` +
          `Template : \`${name}\`\n` +
          `Berhasil : *${success.length}*\n` +
          `Gagal    : *${failed.length}*`
        );

        log.cmd(`template send done | name: ${name} | success: ${success.length} | failed: ${failed.length}`);
        return;
      }

      // ── Add ──────────────────────────────────────────────────────────
      if (sub === "add") {
        const fullText = args.slice(1).join(" ");
        const sepIdx = fullText.indexOf("|");

        if (sepIdx === -1) {
          await message.reply(
            "*Usage:*\n`!template add [nama] | [isi pesan]`\n\n" +
            "*Contoh:*\n" +
            "`!template add promo | 🎉 Promo hari ini diskon 50%! Buruan order!`\n" +
            "`!template add welcome | Halo! Selamat datang, ada yang bisa kami bantu?`"
          );
          return;
        }

        const name = fullText.slice(0, sepIdx).trim().toLowerCase();
        const content = fullText.slice(sepIdx + 1).trim();

        if (!name || !content) {
          await message.reply("Nama dan isi template tidak boleh kosong.");
          return;
        }

        this.templates.set(name, content);
        await message.reply(
          `*Template Disimpan*\n\n` +
          `Nama  : \`${name}\`\n` +
          `Isi   : ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}\n\n` +
          `Kirim dengan: \`!template send ${name} [target]\``
        );

        log.bot(`template added | name: "${name}"`);
        return;
      }

      await message.reply(
        "*Sub-command:*\n" +
        "• `!template add [nama] | [isi]`\n" +
        "• `!template list`\n" +
        "• `!template show [nama]`\n" +
        "• `!template send [nama] [target1,target2]`\n" +
        "• `!template delete [nama]`"
      );
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
  private async handleAutoReply(message: Message): Promise<boolean> {
    if (!message.body || message.from.endsWith("@g.us") || message.isStatus) return false;

    const body = message.body.toLowerCase().trim();

    for (const [keyword, reply] of this.autoReplies.entries()) {
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

  private async ensureBotIsAdmin(groupId: string): Promise<{ chat: any; botId: string }> {
    const chat = await whatsappService.getChatById(groupId) as any;

    if (!chat.isGroup) throw new Error("Bukan group chat.");

    const botId = `${whatsappService.botNumber}@c.us`;
    const botPart = chat.participants?.find((p: any) => p.id._serialized === botId);

    if (!botPart) throw new Error("Bot bukan anggota group ini.");
    if (!botPart.isAdmin) throw new Error("Bot bukan admin di group ini.");

    return { chat, botId };
  }

  private toContactId(raw: string): string {
    if (raw.endsWith("@c.us")) return raw;
    return `${raw.replace(/\D/g, "")}@c.us`;
  }
}
