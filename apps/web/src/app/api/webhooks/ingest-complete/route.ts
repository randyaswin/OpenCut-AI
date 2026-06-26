import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
	assetMetadata,
	transcripts,
	detectedObjects,
	sceneDescriptions,
} from "@/lib/db/schema";

export async function POST(req: Request) {
	try {
		const data = await req.json();

		const { asset_id, metadata, normalized_url, thumbnail_url, status, transcripts: transcriptData, objects, scenes } = data;

		if (!asset_id) {
			return NextResponse.json({ error: "Missing asset_id" }, { status: 400 });
		}

		// Insert or update asset metadata
		await db
			.insert(assetMetadata)
			.values({
				id: crypto.randomUUID(),
				assetId: asset_id,
				metadata: metadata,
				normalizedUrl: normalized_url,
				thumbnailUrl: thumbnail_url,
				status: status || "completed",
			})
			.onConflictDoUpdate({
				target: assetMetadata.assetId,
				set: { metadata, normalizedUrl: normalized_url, thumbnailUrl: thumbnail_url, status: status || "completed", updatedAt: new Date() },
			});

		// Insert transcript if available
		if (transcriptData && transcriptData.segments) {
			await db.insert(transcripts).values({
				id: crypto.randomUUID(),
				assetId: asset_id,
				language: transcriptData.language,
				segments: transcriptData.segments,
			});
		}

		// Insert detected objects
		if (objects && Array.isArray(objects)) {
			for (const obj of objects) {
				await db.insert(detectedObjects).values({
					id: crypto.randomUUID(),
					assetId: asset_id,
					timestamp: new Date(obj.timestamp),
					timeOffset: obj.time_offset,
					label: obj.label,
					confidence: obj.confidence,
					boundingBox: obj.bounding_box,
				});
			}
		}

		// Insert scene descriptions
		if (scenes && Array.isArray(scenes)) {
			for (const scene of scenes) {
				await db.insert(sceneDescriptions).values({
					id: crypto.randomUUID(),
					assetId: asset_id,
					timeStart: scene.time_start,
					timeEnd: scene.time_end,
					description: scene.description,
					tags: scene.tags,
				});
			}
		}

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Webhook processing failed:", error);
		return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
	}
}
