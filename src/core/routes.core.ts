import { Hono } from "hono";
import whatsappRouter from "@/routes/whatsapp.routes";
import publicRoutes from "@/routes/public.routes";
import telegramRoutes from "@/routes/telegram.routes";

const routes: { path: string; router: Hono }[] = [
  { path: "/whatsapp", router: whatsappRouter },
  { path: "/public", router: publicRoutes },
  { path: "/telegram", router: telegramRoutes },
];

export default function coreRoutes(app: Hono) {
  const api = app;

  routes.forEach(({ path, router }) => api.route(path, router));

  app.route("/api", api);
}
