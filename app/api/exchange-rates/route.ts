import { NextResponse } from "next/server";

const FALLBACK = {
  usdPerKrw: 0.00072,
  jpyPerKrw: 0.108,
  date: "reference estimate",
  source: "fallback",
  isFallback: true,
};

export async function GET() {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=KRW&to=USD,JPY", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4500),
    });

    if (!response.ok) throw new Error(`rate provider ${response.status}`);
    const data = await response.json() as { date?: string; rates?: { USD?: number; JPY?: number } };
    const usdPerKrw = Number(data.rates?.USD);
    const jpyPerKrw = Number(data.rates?.JPY);

    if (!Number.isFinite(usdPerKrw) || !Number.isFinite(jpyPerKrw)) throw new Error("invalid rate response");

    return NextResponse.json({
      usdPerKrw,
      jpyPerKrw,
      date: data.date ?? "latest",
      source: "Frankfurter / reference market rate",
      isFallback: false,
    });
  } catch {
    return NextResponse.json(FALLBACK);
  }
}
