import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ALLOWED_GZIP_HASHES = new Set([
  "ffc44603fd22b3404bb77bf155565c0638bd60d0a58c7be209e93a999e97ab82",
  "17595fd9571eb7cf0efd27711a2128c92af9c4c5b2f1c1f543737c685b0b8995",
  "a1640b6dcc1b24d9ed7d51560c164d6312b4680275a625f735a41c30f34ed347",
  "e8fbc708f4a6a0672f7ec90869e292776b8775a7c61a09e426081584dcf5b0d1",
  "12a84a4be54cb0d40b1c69b50e5db4e3109e372aabc7c73c0622a82da5ae3ed9",
  "e74d50d7b7ac1b4739ba1469419f7f20dfd9a13baa0efd545448c149818c68ba",
  "98b0de15d826f6561c4bd89e37d76cc2626314429d622a0f643535d5260a0dd4",
  "4fad488edd29c7270c7db573aee67c9e3aeb0707a9d6ac0a93dad4205653486b",
  "3968ae8d533061c4f32429c3b65358f163e5e2a6d2bf2316603555dba0903351",
  "3565a295628e12837c74697477b5703f776aff7b41e046b2cf1246147d9ae6fe",
  "e8160a8654e95767d2dd5b70544fea343cbbf8a64b282aa0d39ae77f91b906e0",
  "cfb09b941c7f63c63c1ce48c86477bde5a96e86672406b5f76599716c3e5c35d",
  "9bcc92fd3f6e5d8942dad36efe788de1e626d7fbfd55ba92b2f3aef990f7a959",
  "a5eade6fcea79ee35481c64200043b632f955f0c589741f440d247640d80523d",
  "f595798ff10f2cad2504763f523bd23b97a5288e065cc195c886461c12cbb32f",
  "1cf4e87cf04141c3213d6a5fafeed96b1b190fa37382b98449fbd279b030932c",
  "56b35860f099c1f44c6115f21e47034371068b7953c87c3792255eb720f4ef46",
  "650f14378eeeb61c9b0babbc2e73d4d280506452319482d03e95f7f47bd36abe",
  "0a86dae1e0abeb56b255e71a81f7b914b37ea349163168e6c8d1a3be86c4bc5c",
  "cf1b397b8b30a90bc93fa6d9bbb72441539c1348e0812a277f6293d0121eb026",
  "c9243cb1d3ad9818cf0b72e3ea5f44dd1040f4bbfbbd045a172b8e1580adf5ef",
  "1681769577b3f1b8ce97c941610ef380cf8ae92de540b55d34775e6005c05b14",
  "a690567456d139612a1f475cc71ad2e2a886b952a775b549901fdfaee8f057d0",
  "cbb7646efa54917e1573a17a9bc9a79246c6c72f5c3bd68438428274f96d2ac4",
  "ea680c6b1c6d4b809abca8bcabe54b55df6600ca1b8e8b915f6d99ed6a149a79",
  "b38590ab625d4a70ceb802ac3f6a5c929bd093532cf127432750edfcfeff643b",
  "4df44b1ac706f9ac2e3c78b991597ac666350c0cf6dc3f3333b8d8611ddd9d0c",
  "1d7081ef48e1bdb96211635f479531abbeaa552af472e3b1ab3021cbd13c1d5f",
  "b5d4d5ed0d050993949ae23894ac021795076fee662e02c977220a74a33d762a",
  "b29b5bb13b04c37a5130381918a930d253e1445d31b02479012caa7a0063d61f",
  "b7e9c846aa88a4ba5f51a34a475b056ea8dbd953d4161d1a439418044207ce91",
  "a73f0a3d794ff2a8eb230ebe9dfdb96081adddb6552f81144ef000460a75a14e",
  "250bd90688efac6c4ae3d4b3506423fc07128aaae8effa5b03eb72ff5909df43",
  "13e7dd913650f167fb9bf44ded09853d14dbb71dfcda637d6d41a39464427335",
  "96ff4fb9c7e330bb9d6dc3232c914cc451ec83e0f0e9ccdcf63d56fee0f2c675",
  "8262838331aec676ed0bab21fa7c432a0e6848011f8d6d9d5a005c0298fbb572",
  "5b8e6bee3b69d5655c71725c501ca546356cd0e0331ba4489d4218773dd8326f",
  "4fd29296c9b253cad9e7935992c442cfee19ec22199d995b318e067d9a8d5acc",
  "1b20eaaee162d5f88a08789553c4c6aceb19c3afd1980b98b2847a78194f262a",
  "c6a694a594a727c59668c2ca96a8335c25a78922bca47b125396b476e6e06015",
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

export async function GET(request: NextRequest) {
  const encoded = request.nextUrl.searchParams.get("data");
  if (!encoded) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  let compressed: Buffer;
  try {
    compressed = Buffer.from(encoded, "base64url");
  } catch {
    return NextResponse.json({ error: "Invalid encoding" }, { status: 400 });
  }

  const payloadHash = createHash("sha256").update(compressed).digest("hex");
  if (!ALLOWED_GZIP_HASHES.has(payloadHash)) {
    return NextResponse.json({ error: "Payload not allowed" }, { status: 403 });
  }

  let rows: ImportRow[];
  try {
    rows = JSON.parse(gunzipSync(compressed).toString("utf8")) as ImportRow[];
  } catch {
    return NextResponse.json({ error: "Invalid compressed JSON" }, { status: 400 });
  }

  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    return NextResponse.json({ error: "Invalid row count" }, { status: 400 });
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

  if (normalized.some((row) =>
    !row.management_no.startsWith("3130000-101-") ||
    !row.business_name ||
    row.detailed_status !== "영업"
  )) {
    return NextResponse.json({ error: "Payload validation failed" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const { error } = await supabase
    .from("mapo_general_restaurant_verification")
    .upsert(normalized, { onConflict: "management_no" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: normalized.length, payloadHash });
}
