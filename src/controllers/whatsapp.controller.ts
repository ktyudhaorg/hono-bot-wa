import { Context } from "hono";
import path from "path";
import fs from "fs";

import { whatsappService } from "@/services/whatsapp";

export class WhatsAppController {
  public async getStatus(c: Context) {
    try {
      const status = whatsappService.getStatus();
      return c.json({
        success: true,
        data: status,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: "Failed to get status",
        },
        500,
      );
    }
  }

  public async sendMessageGlobal(c: Context) {
    try {
      const { to, message } = await c.req.json();

      if (!to || !message) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: to and message",
          },
          400,
        );
      }

      await whatsappService.sendMessageGlobal(to, message);

      return c.json({
        success: true,
        message: "Message sent successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to send message",
        },
        500,
      );
    }
  }

  public async sendMediaGlobal(c: Context) {
    try {
      const body = await c.req.parseBody();

      const to = body["to"] as string;
      const caption = body["caption"] as string | undefined;
      const file = body["file"] as File;

      if (!to || !file) {
        return c.json({ error: "to & file required" }, 400);
      }

      // VALIDASI SIZE
      if (file.size > 64 * 1024 * 1024) {
        return c.json({ error: "File too large (max 64MB)" }, 400);
      }

      // VALIDASI EXTENSION
      // const ext = path.extname(file.name).toLowerCase();
      // const allowedExt = [
      //   ".pdf",
      //   ".jpg",
      //   ".jpeg",
      //   ".png",
      //   ".webp",
      //   ".docx",
      //   ".xlsx",
      //   ".svg",
      // ];

      // if (!allowedExt.includes(ext)) {
      //   return c.json({ error: "Invalid file type" }, 400);
      // }

      // SIMPAN KE TMP
      const tmpDir = path.join(process.cwd(), "tmp");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = path.join(tmpDir, `${Date.now()}-${file.name}`);

      fs.writeFileSync(filePath, buffer);

      // KIRIM KE WHATSAPP
      await whatsappService.sendMediaGlobal(to, filePath, caption);

      return c.json({
        success: true,
        message: "Message sent successfully",
      });
    } catch (e: any) {
      return c.json(
        {
          success: false,
          error: e.message || "Failed to send message",
        },
        500,
      );
    }
  }

  public async sendMessage(c: Context) {
    try {
      const { to, message } = await c.req.json();

      if (!to || !message) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: to and message",
          },
          400,
        );
      }

      await whatsappService.sendChatMessage(to, message);

      return c.json({
        success: true,
        message: "Message sent successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error || "Failed to send message",
        },
        500,
      );
    }
  }

  public async sendMediaWithUrl(c: Context) {
    try {
      const { to, mediaUrl, caption } = await c.req.json();

      if (!to || !mediaUrl) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: to and mediaUrl",
          },
          400,
        );
      }

      await whatsappService.sendMediaWithUrl(to, mediaUrl, caption);

      return c.json({
        success: true,
        message: "Media sent successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to send media",
        },
        500,
      );
    }
  }

  public async getChats(c: Context) {
    try {
      const chats = await whatsappService.getChats();

      return c.json({
        success: true,
        data: chats,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to get chats",
        },
        500,
      );
    }
  }

  public async sendMessageToGroup(c: Context) {
    try {
      const { groupId, message } = await c.req.json();

      if (!groupId || !message) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: groupId and message",
          },
          400,
        );
      }

      await whatsappService.sendMessageToGroup(groupId, message);

      return c.json({
        success: true,
        message: "Message sent to group successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to send message to group",
        },
        500,
      );
    }
  }

  public async sendMediaToGroup(c: Context) {
    try {
      const { groupId, mediaUrl, caption } = await c.req.json();

      if (!groupId || !mediaUrl) {
        return c.json(
          {
            success: false,
            error: "Missing required fields: groupId and mediaUrl",
          },
          400,
        );
      }

      await whatsappService.sendMediaToGroup(groupId, mediaUrl, caption);

      return c.json({
        success: true,
        message: "Media sent to group successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to send media to group",
        },
        500,
      );
    }
  }

  public async getGroups(c: Context) {
    try {
      const groups = await whatsappService.getGroups();

      return c.json({
        success: true,
        data: groups,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to get groups",
        },
        500,
      );
    }
  }

  public async getGroupMessages(c: Context) {
    try {
      const { groupId, limit } = c.req.query();

      if (!groupId) {
        return c.json(
          {
            success: false,
            error: "Missing required field: groupId",
          },
          400,
        );
      }

      const messages = await whatsappService.getGroupMessages(
        groupId,
        Number(limit) || 10,
      );

      return c.json({
        success: true,
        data: messages,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to get group messages",
        },
        500,
      );
    }
  }

  public async getChatMessages(c: Context) {
    try {
      const { to, limit } = c.req.query();

      if (!to) {
        return c.json(
          {
            success: false,
            error: "Missing required field: to",
          },
          400,
        );
      }

      const messages = await whatsappService.getChatMessages(
        to,
        Number(limit) || 10,
      );

      return c.json({
        success: true,
        data: messages,
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to get chat messages",
        },
        500,
      );
    }
  }

  public async logout(c: Context) {
    try {
      await whatsappService.logout();

      return c.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to logout",
        },
        500,
      );
    }
  }

  public async destroy(c: Context) {
    try {
      await whatsappService.destroy();

      return c.json({
        success: true,
        message: "Client destroyed successfully",
      });
    } catch (error: any) {
      return c.json(
        {
          success: false,
          error: error.message || "Failed to destroy client",
        },
        500,
      );
    }
  }
}

export const whatsappController = new WhatsAppController();
