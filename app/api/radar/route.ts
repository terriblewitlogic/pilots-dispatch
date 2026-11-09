import { areaRequest } from "@/lib/intel-fetch";
export const POST = (request: Request) => areaRequest(request, "radar");
