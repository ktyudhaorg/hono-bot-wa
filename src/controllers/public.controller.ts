import { Context } from "hono";
import { whatsappService } from "@/services/whatsapp";

export class PublicController {
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
}

export const publicController = new PublicController();