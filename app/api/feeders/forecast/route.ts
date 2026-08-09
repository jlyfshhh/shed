import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone } from "@/lib/date";
import { requireCapability } from "@/lib/household-auth";
import { loadFeederForecast } from "@/lib/feeder-forecast-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const parsedHorizon = Number.parseInt(
      new URL(request.url).searchParams.get("horizon") ?? "60",
      10,
    );
    const horizonDays = Number.isFinite(parsedHorizon) ? parsedHorizon : 60;
    const today = dateInTimeZone();
    const db = await ensureDatabase(today);
    const auth = await requireCapability(request, db, "care.read");
    if (auth.response) return auth.response;
    return Response.json(await loadFeederForecast(db, today, horizonDays));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to forecast feeder needs" },
      { status: 500 },
    );
  }
}
