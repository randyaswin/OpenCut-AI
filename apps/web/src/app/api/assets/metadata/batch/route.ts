import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assetMetadata, detectedObjects, sceneDescriptions, transcripts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export async function POST(req: Request) {
	try {
		const body = await req.json();
		const { assetIds } = body;

		if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
			return NextResponse.json({ error: "Missing or invalid assetIds array" }, { status: 400 });
		}

		// Fetch metadata for all given assets
		const metadataRecords = await db
			.select()
			.from(assetMetadata)
			.where(inArray(assetMetadata.assetId, assetIds));

		// Fetch transcripts for all given assets
		const transcriptRecords = await db
			.select()
			.from(transcripts)
			.where(inArray(transcripts.assetId, assetIds));

		// Fetch detected objects
		const objects = await db
			.select()
			.from(detectedObjects)
			.where(inArray(detectedObjects.assetId, assetIds));

		// Fetch scene descriptions
		const scenes = await db
			.select()
			.from(sceneDescriptions)
			.where(inArray(sceneDescriptions.assetId, assetIds));

		// Group by assetId
		const result: Record<string, any> = {};
		for (const id of assetIds) {
			result[id] = {
				metadata: null,
				transcripts: [],
				objects: [],
				scenes: [],
			};
		}

		for (const m of metadataRecords) {
			if (result[m.assetId]) {
				result[m.assetId].metadata = m;
			}
		}

		for (const t of transcriptRecords) {
			if (result[t.assetId]) {
				result[t.assetId].transcripts.push(t);
			}
		}

		for (const o of objects) {
			if (result[o.assetId]) {
				result[o.assetId].objects.push(o);
			}
		}

		for (const s of scenes) {
			if (result[s.assetId]) {
				result[s.assetId].scenes.push(s);
			}
		}

		return NextResponse.json(result);
	} catch (error) {
		console.error("Error fetching batch asset metadata:", error);
		return NextResponse.json(
			{ error: "Failed to fetch batch asset metadata" },
			{ status: 500 }
		);
	}
}
