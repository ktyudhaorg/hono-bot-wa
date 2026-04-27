import {
  Client,
  LocalAuth,
  Message,
  MessageMedia,
  GroupChat,
} from "whatsapp-web.js";
import fs from "fs";
import * as qrcode from "qrcode-terminal";
import { log } from "@/helpers/logger";

function cleanChromiumLock() {
  const base = "/app/.wwebjs_auth/session";

  try {
    fs.rmSync(`${base}/SingletonLock`, { force: true });
    fs.rmSync(`${base}/SingletonSocket`, { force: true });
    fs.rmSync(`${base}/SingletonCookie`, { force: true });
    fs.rmSync(`${base}/lockfile`, { force: true });
  } catch {}
}

export class WhatsAppService {
  private client: Client;
  private isReady: boolean = false;
  private isInitializing: boolean = false;
  public botNumber: string | null = null;

  private messageHandlers: ((message: Message) => Promise<void>)[] = [];
  private processedMessages: Set<string> = new Set();

  constructor() {
    this.client = this.createClient();
    this.initializeEvents();
    log.bot("WhatsAppService initialized");
  }

  private createClient(): Client {
    cleanChromiumLock();

    log.bot("creating new WhatsApp client...");
    return new Client({
      authStrategy: new LocalAuth({
        dataPath: "/app/.wwebjs_auth",
      }),
      puppeteer: {
        headless: true,
        // MacOS
        // executablePath: "/opt/homebrew/bin/chromium",
        // Linux
        // executablePath: "/usr/bin/chromium",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--disable-extensions",
          "--single-process",
        ],
      },
    });
  }

  private initializeEvents(): void {
    this.client.on("qr", (qr: string) => {
      log.bot("QR Code received, scan dengan WhatsApp Anda:");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", () => {
      this.isReady = true;
      this.isInitializing = false;
      this.botNumber = this.client.info.wid.user;
      log.bot(`client ready | nomor: ${this.botNumber}`);
    });

    this.client.on("authenticated", () => {
      log.bot("authenticated successfully");
    });

    this.client.on("auth_failure", (msg: string) => {
      log.error(`authentication failed | reason: ${msg}`);
      this.isReady = false;
      this.isInitializing = false;
    });

    this.client.on("disconnected", async (reason: string) => {
      if (this.isInitializing) return;
      this.isReady = false;
      this.isInitializing = true;
      log.warn(`client disconnected | reason: ${reason}`);

      try {
        await this.client.destroy();
        log.bot("client destroyed, reinitializing...");
      } catch (err) {
        log.warn("error saat destroy client:", err);
      }

      this.client = this.createClient();
      this.initializeEvents();

      try {
        await this.client.initialize();
        log.bot("client reinitialized successfully");
      } catch (err) {
        log.error("gagal reinitialize client:", err);
        this.isInitializing = false;
      }
    });

    this.client.on("message", async (message: Message) => {
      const msgId = message.id._serialized;
      const from = message.from;
      const type = message.type;

      if (this.processedMessages.has(msgId)) {
        log.bot(`skip duplicate | id: ${msgId}`);
        return;
      }

      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 60_000);

      log.bot(
        `message received | from: ${from} | type: ${type} | id: ${msgId}`,
      );

      for (const handler of this.messageHandlers) {
        try {
          await handler(message);
        } catch (err) {
          log.error(
            `handler error | from: ${from} | id: ${msgId} | error:`,
            err,
          );
        }
      }
    });
  }

  public async initialize(): Promise<void> {
    if (this.isInitializing || this.isReady) {
      log.bot(
        `initialize skipped | isInitializing: ${this.isInitializing} | isReady: ${this.isReady}`,
      );
      return;
    }
    this.isInitializing = true;
    log.bot("initializing client...");
    try {
      await this.client.initialize();
    } catch (error) {
      this.isInitializing = false;
      log.error("initialize failed:", error);
      throw error;
    }
  }

  public async reset(): Promise<void> {
    try {
      await this.client.destroy();
    } catch (err) {
      log.warn(
        "client destroy failed, continuing reset:",
        (err as Error).message,
      );
    }

    this.isReady = false;
    this.isInitializing = false;
    this.client = this.createClient();
    this.initializeEvents();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  public onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandlers.push(handler);
    log.bot(
      `handler registered | total handlers: ${this.messageHandlers.length}`,
    );
  }

  public async sendMessage(
    to: string,
    content: any,
    options?: any,
  ): Promise<any> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");
    try {
      const rawNumber = to.replace(/@c\.us$/, "").replace(/@lid$/, "");
      const numberId = await this.client.getNumberId(rawNumber);

      if (!numberId) {
        throw new Error(`Nomor ${to} tidak terdaftar di WhatsApp`);
      }

      const resolvedId = numberId._serialized;
      log.send(`sendMessage | to: ${resolvedId}`);
      return this.client.sendMessage(resolvedId, content, options);
    } catch (err: any) {
      // Fallback group
      if (to.endsWith("@g.us")) {
        return this.client.sendMessage(to, content, options);
      }

      // Fallback @lid → kirim langsung, biar WA yang resolve
      if (to.endsWith("@lid")) {
        log.warn(`getNumberId failed for @lid, sending directly | to: ${to}`);
        return this.client.sendMessage(to, content, options);
      }

      throw err;
    }
  }

  public async sendChatMessage(to: string, message: string): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");

    try {
      const chatId = await this.toWhatsAppId(to);
      await this.client.sendMessage(chatId, message);
      log.send(
        `chat message sent | to: ${chatId} | length: ${message.length} chars`,
      );
    } catch (error) {
      log.error(`sendChatMessage failed | to: ${to} | error:`, error);
      throw error;
    }
  }

  public async sendMessageGlobal(to: string, message: string): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");
    this.validateWhatsAppId(to);

    try {
      await this.client.sendMessage(to, message);
      log.send(
        `global message sent | to: ${to} | length: ${message.length} chars`,
      );
    } catch (error) {
      log.error(`sendMessageGlobal failed | to: ${to} | error:`, error);
      throw error;
    }
  }

  public async sendMediaGlobal(
    to: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");
    this.validateWhatsAppId(to);

    try {
      const chatId = await this.toWhatsAppId(to);
      const media = MessageMedia.fromFilePath(filePath);
      await this.client.sendMessage(chatId, media, { caption });

      log.send(
        `global media sent | to: ${chatId} | file: ${filePath} | caption: ${caption ?? "-"}`,
      );

      fs.unlink(filePath, (err) => {
        if (err)
          log.error(`failed delete tmp file | path: ${filePath} | error:`, err);
        else log.media(`tmp file deleted | path: ${filePath}`);
      });
    } catch (error) {
      log.error(
        `sendMediaGlobal failed | to: ${to} | file: ${filePath} | error:`,
        error,
      );
      throw error;
    }
  }

  public async sendMedia(
    to: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");

    log.media(`fetching media | url: ${mediaUrl}`);
    const chatId = await this.toWhatsAppId(to);
    const media = await MessageMedia.fromUrl(mediaUrl);
    await this.client.sendMessage(chatId, media, { caption });
    log.send(`media sent | to: ${chatId} | caption: ${caption ?? "-"}`);
  }

  public async sendMediaWithUrl(
    to: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");

    try {
      log.media(`fetching media from url | url: ${mediaUrl}`);
      const chatId = await this.toWhatsAppId(to);
      const media = await MessageMedia.fromUrl(mediaUrl);
      await this.client.sendMessage(chatId, media, { caption });
      log.send(
        `media with url sent | to: ${chatId} | caption: ${caption ?? "-"}`,
      );
    } catch (error) {
      log.error(
        `sendMediaWithUrl failed | to: ${to} | url: ${mediaUrl} | error:`,
        error,
      );
      throw error;
    }
  }

  public async sendMediaToGroup(
    groupId: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");

    try {
      log.media(
        `fetching media for group | group: ${groupId} | url: ${mediaUrl}`,
      );
      const chatId = await this.toWhatsAppId(groupId, true);
      const media = await MessageMedia.fromUrl(mediaUrl);
      await this.client.sendMessage(chatId, media, { caption });
      log.send(
        `media sent to group | group: ${groupId} | caption: ${caption ?? "-"}`,
      );
    } catch (error) {
      log.error(
        `sendMediaToGroup failed | group: ${groupId} | url: ${mediaUrl} | error:`,
        error,
      );
      throw error;
    }
  }

  public async sendMessageToGroup(
    groupId: string,
    message: string,
  ): Promise<void> {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");

    try {
      const chatId = await this.toWhatsAppId(groupId, true);
      await this.client.sendMessage(chatId, message);
      log.send(
        `message sent to group | group: ${groupId} | length: ${message.length} chars`,
      );
    } catch (error) {
      log.error(
        `sendMessageToGroup failed | group: ${groupId} | error:`,
        error,
      );
      throw error;
    }
  }

  public async getChats(): Promise<any[]> {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");
    log.bot("fetching chats...");
    const chats = await this.client.getChats();
    log.bot(`chats fetched | total: ${chats.length}`);
    return chats;
  }

  public async getGroups(): Promise<any[]> {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");
    log.bot("fetching groups...");
    const chats = await this.client.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => {
        const groupChat = chat as GroupChat;
        return {
          id: groupChat.id._serialized,
          name: groupChat.name,
          participants: groupChat.participants.length,
        };
      });
    log.bot(`groups fetched | total: ${groups.length}`);
    return groups;
  }

  public async getChatMessages(to: string, limit: number = 10) {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");
    log.bot(`fetching chat messages | to: ${to} | limit: ${limit}`);
    const chatId = await this.toWhatsAppId(to);
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });
    log.bot(`chat messages fetched | total: ${messages.length}`);
    return messages.map((msg) => ({
      id: msg.id._serialized,
      from: msg.from,
      body: msg.body,
      timestamp: msg.timestamp,
      isFromMe: msg.fromMe,
      type: msg.type,
    }));
  }

  public async getGroupMessages(groupId: string, limit: number = 10) {
    if (!this.isReady) throw new Error("WhatsApp client is not ready");
    log.bot(`fetching group messages | group: ${groupId} | limit: ${limit}`);
    const chatId = await this.toWhatsAppId(groupId, true);
    const chat = await this.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });
    log.bot(`group messages fetched | total: ${messages.length}`);
    return messages.map((msg) => ({
      id: msg.id._serialized,
      from: msg.from,
      body: msg.body,
      timestamp: msg.timestamp,
      isFromMe: msg.fromMe,
      type: msg.type,
    }));
  }

  public async broadcast(
    targets: string[], // bisa mix: nomor, @c.us, @g.us, atau "all-contacts", "all-groups", "all"
    message: string,
    options?: {
      delayMs?: number;
      caption?: string;
      filePath?: string; // jika ada media
    },
  ): Promise<{ success: string[]; failed: string[] }> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");

    const delay = options?.delayMs ?? 3000;
    const success: string[] = [];
    const failed: string[] = [];

    // ── Resolve targets
    let resolvedTargets: string[] = [];

    const needAllContacts =
      targets.includes("all") || targets.includes("all-contacts");
    const needAllGroups =
      targets.includes("all") || targets.includes("all-groups");

    if (needAllContacts || needAllGroups) {
      const chats = await this.client.getChats();

      if (needAllContacts) {
        const contacts = chats
          .filter((c) => !c.isGroup && c.id._serialized.endsWith("@c.us"))
          .map((c) => c.id._serialized);
        resolvedTargets.push(...contacts);
      }

      if (needAllGroups) {
        const groups = chats
          .filter((c) => c.isGroup)
          .map((c) => c.id._serialized);
        resolvedTargets.push(...groups);
      }
    }

    // Tambahkan target manual (selain keyword "all*")
    const manualTargets = targets.filter(
      (t) => !["all", "all-contacts", "all-groups"].includes(t),
    );

    for (const t of manualTargets) {
      if (t.endsWith("@c.us") || t.endsWith("@g.us")) {
        resolvedTargets.push(t);
      } else {
        // Anggap nomor biasa → personal chat
        resolvedTargets.push(`${t.replace(/\D/g, "")}@c.us`);
      }
    }

    // Deduplicate
    resolvedTargets = [...new Set(resolvedTargets)];
    log.send(`broadcast start | total targets: ${resolvedTargets.length}`);

    // ── Media atau text?
    const media = options?.filePath
      ? MessageMedia.fromFilePath(options.filePath)
      : null;

    // ── Send loop
    for (const chatId of resolvedTargets) {
      try {
        if (media) {
          await this.client.sendMessage(chatId, media, {
            caption: options?.caption ?? message,
          });
        } else {
          await this.client.sendMessage(chatId, message);
        }

        log.send(`broadcast ok | to: ${chatId}`);
        success.push(chatId);
      } catch (err) {
        log.error(`broadcast failed | to: ${chatId} | error:`, err);
        failed.push(chatId);
      }

      await new Promise((res) => setTimeout(res, delay + Math.random() * 1000));
    }

    log.send(
      `broadcast done | success: ${success.length} | failed: ${failed.length}`,
    );
    return { success, failed };
  }

  public async getChatById(chatId: string): Promise<any> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");
    return this.client.getChatById(chatId);
  }

  public async getContactById(contactId: string): Promise<any> {
    if (!this.isReady) throw new Error("WhatsApp client: not ready");
    return this.client.getContactById(contactId);
  }

  public getStatus(): { isReady: boolean; isAuthenticated: boolean } {
    const status = {
      isReady: this.isReady,
      isAuthenticated: this.client.info !== undefined,
    };
    log.bot(
      `status check | isReady: ${status.isReady} | isAuthenticated: ${status.isAuthenticated}`,
    );
    return status;
  }

  public async logout(): Promise<void> {
    log.bot("logging out...");
    await this.client.logout();
    this.isReady = false;
    log.bot("logged out successfully");
  }

  public async destroy(): Promise<void> {
    log.bot("destroying client...");
    await this.client.destroy();
    this.isReady = false;
    log.bot("client destroyed");
  }

  private async toWhatsAppId(target: string, isGroup = false): Promise<string> {
    const extGroup = "@g.us";
    const extChat = "@c.us";

    if (target.endsWith(extGroup)) return target;
    if (isGroup) return `${target}${extGroup}`;
    const rawNumber = target.replace(extChat, "");

    try {
      const numberId = await this.client.getNumberId(rawNumber);
      if (numberId) return numberId._serialized;
    } catch {
      log.warn(
        `getNumberId failed | number: ${rawNumber}, fallback ke format manual`,
      );
    }

    return `${rawNumber}${extChat}`;
  }

  private validateWhatsAppId(target: string) {
    if (!/@(c|g)\.us$/.test(target)) {
      log.error(`invalid WhatsApp ID | target: ${target}`);
      throw new Error("Invalid WhatsApp ID: must end with @c.us or @g.us");
    }
  }
}

export const whatsappService = new WhatsAppService();
