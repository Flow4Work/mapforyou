import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase";

const ALLOWED_BODY_HASHES = new Set([
  "8018f243cdf3fd0799d928080c69f108bdb8bac79f16a7ab16cc7c06b9311cd9",
  "d847d9c0eccd86e3a903fba570a0f321ef64bce72026aa65dbfb2723d2f15dd5",
  "6000b4c2ace395edc8f76aeaa159d1fb990279a9e34e6e1e74276c90ce290b49",
  "f3100573b37e634f492b8b96cd0423a2a8c2fe3f577a2dd587de99da63ce6b12",
  "59a65def972bc426155e7556309e658a5b13ed961a5b56cc7b4c38f847ce168f",
  "25b5b7902d56b1a820be0bf23d6a2416f5d44f6cfe0f79564a8a7f4a51fb98f2",
  "18ba33d3abfe1195d6877913ae773f4f8799cfd77cb5f9ac177384dddf06919d",
  "a74228018fee5c3c7cd55c74fc439eb6281c634f523ab8c08b555ded90ad6f41",
  "18a3fc6cf620000ba9ee629a3b55a7c3208afc90b107919d43527ed7c8049b66",
  "8820cf824e6ea9c9ac563656f69594d5823a2de9ea4395b50d64ee490f9cd3a7",
  "255c5472e3e894ab5211f57b5204fbde367d40e15444715bd113f2d7b909baf6",
  "582ab46c87ba8cbd4d1cbe69f6d0e3d75e1ed0d4ff1967f5303704f83f571582",
  "71b8d3d1df3c423b982df36062c084521e17e25f0357eab6be1bceaa62ad8bfb",
  "a1dabdc73f4c3ffdb04432202815ce9f565d8ebc12ff6efdf2e6f52f61320cef",
  "f232890146af407bfe1872eacf9ee321e73c405a51bf1dff72b8f06d1d3ce067",
  "882bf08cdd995fedcfdfaa23cb58b1137d880dfe8fb56e02e7d6fc6fe12279ef",
]);

type ImportRow = {
  management_no: string;
  business_name: string;
  business_type?: string | null;
  road_address?: string | null;
  detailed_status?: string | null;
  hygiene_type?: string | null;
  phone?: string | null;
  parcel_address?: string | null;
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (!ALLOWED_BODY_HASHES.has(bodyHash)) {
    return NextResponse.json({ error: "Payload not allowed" }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  let body: { rows?: ImportRow[] };
  try {
    body = JSON.parse(rawBody) as { rows?: ImportRow[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) {
    return NextResponse.json({ error: "rows must contain 1-500 items" }, { status: 400 });
  }

  const normalized = rows.map((row) => ({
    management_no: String(row.management_no ?? "").trim(),
    business_name: String(row.business_name ?? "").trim(),
    business_type: row.business_type ? String(row.business_type).trim() : null,
    road_address: row.road_address ? String(row.road_address).trim() : null,
    detailed_status: row.detailed_status ? String(row.detailed_status).trim() : null,
    hygiene_type: row.hygiene_type ? String(row.hygiene_type).trim() : null,
    phone: row.phone ? String(row.phone).trim() : null,
    parcel_address: row.parcel_address ? String(row.parcel_address).trim() : null,
    imported_at: new Date().toISOString(),
  }));

  if (normalized.some((row) => !row.management_no || !row.business_name)) {
    return NextResponse.json({ error: "management_no and business_name are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("mapo_general_restaurant_verification")
    .upsert(normalized, { onConflict: "management_no" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: normalized.length });
}
