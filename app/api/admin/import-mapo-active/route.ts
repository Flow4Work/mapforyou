import { createHash } from "crypto";
import { gunzipSync } from "zlib";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ALLOWED_GZIP_HASHES = new Set([
  "2f783ff84c9f8312ed8b090e51c5c18354f8944a3aa76193b0ae749b9e27f9bf",
  "7b146facf1cb2e693f5382ee4d567c77d818fd43542c7b2c1e90f94873569f42",
  "dce81210b302ffe1420ef7b19ba6165b36be483be8e27f34af3be0ff2890bcb9",
  "c99d0967f3808ef03e2b7d5bf30459e444cbc9a3d5b9f97384b693bac3ba6b33",
  "b4363674b63d4e1ddc02b48796318d1b0e6d2b909251f69f18ca0f45854b540e",
  "4fe6ae7eb4edb5684e70c450a48006f39f0cd5434d38fc2df3fbda2162077436",
  "7414a2a14368237154772bdb6f1546056bb1362963094ad5b10157e702a903c0",
  "76e54b1eef1be3de64be37690e17111cdc8176350ed7701f07624202bd01d3ec",
  "4396fb0f28bb7792cc3b7640d9a962efbeeb86ed2529680c239f9e9870b6a0f8",
  "e9fb8aa990da31325bf1a708fbc717e6fbe4b7d06c1dba4e09b1a3398741de46",
  "ab9a7e3250b7dca531518faa78647e59b15187961343c1ab8e4ee0186ab2f842",
  "b19b2d52c65407c86807e5d9ee9baa4648a241cd402cf07e0fb7ec3202a9f93a",
  "fdf80a2acba7bda1c741a59307e3b3ef8dbeb27a00debc171d8f958f7204636f",
  "3701fdda79b3eeaa0ebf005cf2aa8e39839b99aa98c3fdef64f9888c41c7bade",
  "ccc7c4b901d5478ac7e65dfbace58b383de4870da7aaa88b74f84af3ff8dc74d",
  "cccf4159808ec7d71f627440bbeee4b5233b4935912be731ba5eb20aca7d5fb0",
  "bf1af9b5aaa3a115ba6d041067c28cde93d479548409086ec5820a4959f5be6c",
  "6ff3ea5ae35c5b327fe1dabba54de7d320fefe24690bfe4cb6cded2cc167a5d8",
  "d940dcedb1c915a1699c391c2d208e0cda795c0aa9833b39ebc31ad64eadbddf",
  "f38228d3995175d070c02798a131a69ddfa2bcaf10cc9faf664bcf255be29389",
  "d7439abd697cf8e0071f6aef1c99b3eb6bfb55800d2117fbf84dbcf73db9d7d6",
  "3590b22f3114577d0b73ba8d9417397d9de587802036c35fc82083f4d006bd21",
  "bea51f4f8cc42aec49edd16ab61f6fcdc14b7110d7eebe6540d1a065e037638b",
  "25e5c0bf5c96f0652d5e6cd273fcb4d16d97b20c83e083205bc334b99ee76afa",
  "f58158a336cd6318333bd5e0fb8fc692bfdb190a40a0718fe0c9eea2009e5115",
  "6e9bbc0aa03b4e2c51ef69c9426240e4f70b4b079650b8d1287d0554e69c9ff8",
  "103d5a6f2369c65dd573982f2587a8344799f79807bc0eea5d32154f86589669",
  "e8511fbd2f8184e2f176b95110f708dfe3083c22ebf187a64cab783c80be8c61",
  "3ac50ad0b431b05b4dd9f7dae65630625bb8fe560fa0fbbeee58af46a39b317c",
  "7b3c3a8cd87421f2ea888c9ea8e8df61ef2f33954eb4faa73283a00c3fccebcb",
  "f80a7e47f3f99a8d054fd9c4ef478286d5c582cd21abbf68ec57239b07caeb99",
  "457ca88acfbe63622ed785cdbf754c71cafb86b99ebb6d18a87288f066a61abb",
  "76e74c45f5916c239795b4ccc89a2ef9e87a9e1cac164f6c778e57b36ea1337c",
  "3ec03f323ae549d8edbb19a3da026010c18e382d48028548530ee70eae3a6f8c",
  "4069cec0ad63b437d6650c6e8a6107bcf9f361507d7dbf0463ee89875979be89",
  "060b6bfc04765e1a16766ea9529c8ec8abe11dfdd07a42dcfcc602e87ecb5df9",
  "6746e2e9f0b46f2dd1fde21628819a51fb21166e7587b2785409fa34758b481f",
  "a700457967a198844897f400e395b2aff00db74c6e2cbac24dd17010026aeb6b",
  "6883a95584fde8ff1ea9b6ee148c9dd2cb859eeb7b278b696d1f2660f5939857",
  "0d377caa8626c8aa569e1fc9e918618e4561591e3bf158a3bdbcf553369d8836"
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
    imported_at: new Date().toISOString()
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
