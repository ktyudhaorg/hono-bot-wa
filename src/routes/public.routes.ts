import { Hono } from "hono";
import { publicController } from "../controllers/public.controller";

const publicRoutes = new Hono();

// Send Message Group / Chat
publicRoutes.post("/send-message-global", (c) =>
    publicController.sendMessageGlobal(c)
);

export default publicRoutes;