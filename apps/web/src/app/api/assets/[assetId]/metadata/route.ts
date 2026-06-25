import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assetMetadata, transcripts, detectedObjects, sceneDescriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ assetId: string }> }
) {
	try {
		const { assetId } = await params;

		if (!assetId) {
			return NextResponse.json({ error: "Missing assetId" }, { status: 400 });
		}

		// Fetch all metadata for the asset
		const [metadata] = await db
			.select()
			.from(assetMetadata)
			.where(eq(assetMetadata.assetId, assetId));

		if (!metadata) {
			return NextResponse.json(null);
		}

		// Fetch transcripts
		const assetTranscripts = await db
			.select()
			.from(transcripts)
			.where(eq(transcripts.assetId, assetId));

		// Fetch objects
		const objects = await db
			.select()
			.from(detectedObjects)
			.where(eq(detectedObjects.assetId, assetId));

		// Fetch scenes
		const scenes = await db
			.select()
			.from(sceneDescriptions)
			.where(eq(sceneDescriptions.assetId, assetId));

		return NextResponse.json({
			metadata: metadata.metadata,
			status: metadata.status,
			normalizedUrl: metadata.normalizedUrl,
			thumbnailUrl: metadata.thumbnailUrl,
			transcripts: assetTranscripts,
			objects,
			scenes,
		});
	} catch (error) {
		console.error("Error fetching asset metadata:", error);
		return NextResponse.json(
			{ error: "Failed to fetch asset metadata" },
			{ status: 500 }
		);
	}
}

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ assetId: string }> }
) {
	try {
		const { assetId } = await params;
		if (!assetId) {
			return NextResponse.json({ error: "Missing assetId" }, { status: 400 });
		}
		
		const body = await req.json();

		await db
			.insert(assetMetadata)
			.values({
				id: crypto.randomUUID(),
				assetId: assetId,
				status: body.status || "pending",
			})
			.onConflictDoUpdate({
				target: assetMetadata.assetId,
				set: { status: body.status || "pending", updatedAt: new Date() },
			});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error updating asset metadata status:", error);
		return NextResponse.json(
			{ error: "Failed to update asset metadata status" },
			{ status: 500 }
		);
	}
}
