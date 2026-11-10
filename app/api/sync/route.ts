import { handleSync } from "@/lib/sync-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleSync;
export const POST = handleSync;
export const DELETE = handleSync;
